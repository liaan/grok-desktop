/**
 * Always-on crash / exit log (main process).
 * Independent of Settings → Debug logging. Writes JSON lines to
 * userData/desktop-crash.log so silent main-process deaths are diagnosable.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** @type {string | null} */
let logPath = null;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINE = 32 * 1024;

const nodeRequire = createRequire(import.meta.url);

function electronApp() {
  try {
    // createRequire works in ESM main; bare `require` is undefined and was
    // silently skipping crashReporter + app quit/GPU handlers.
    return nodeRequire("electron");
  } catch {
    return null;
  }
}

/**
 * @param {unknown} err
 */
export function errorFields(err) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack ? String(err.stack).slice(0, 8000) : null,
      code: "code" in err ? /** @type {{ code?: unknown }} */ (err).code : undefined,
    };
  }
  if (err && typeof err === "object") {
    return { message: String(/** @type {{ message?: unknown }} */ (err).message || err) };
  }
  return { message: String(err) };
}

export function getCrashLogPath() {
  if (logPath) return logPath;
  const electron = electronApp();
  try {
    if (electron?.app?.getPath) {
      logPath = path.join(electron.app.getPath("userData"), "desktop-crash.log");
      return logPath;
    }
  } catch {
    /* not in electron / too early */
  }
  logPath = path.join(
    process.env.APPDATA || os.homedir(),
    "grok-desktop",
    "desktop-crash.log",
  );
  return logPath;
}

export function getCrashDumpsPath() {
  const electron = electronApp();
  try {
    if (electron?.app?.getPath) {
      return electron.app.getPath("crashDumps");
    }
  } catch {
    /* ignore */
  }
  return path.join(path.dirname(getCrashLogPath()), "Crashpad");
}

function rotateIfNeeded(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < MAX_BYTES) return;
    const bak = `${file}.1`;
    try {
      fs.unlinkSync(bak);
    } catch {
      /* ignore */
    }
    fs.renameSync(file, bak);
  } catch {
    /* missing is fine */
  }
}

/**
 * Always write (unlike debugLog). Never throws.
 * @param {string} scope
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 * @param {string} [file]
 */
export function writeCrashLog(scope, message, data, file) {
  const target = file || getCrashLogPath();
  const row = {
    t: new Date().toISOString(),
    pid: process.pid,
    scope: String(scope || "app"),
    msg: String(message || ""),
    ...(data && typeof data === "object" ? { data } : {}),
  };
  let line;
  try {
    line = `${JSON.stringify(row)}\n`;
  } catch {
    line = `${JSON.stringify({
      t: row.t,
      pid: row.pid,
      scope: row.scope,
      msg: row.msg,
      data: { serialize: "failed" },
    })}\n`;
  }
  if (line.length > MAX_LINE) {
    line = `${line.slice(0, MAX_LINE - 2)}…\n`;
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    rotateIfNeeded(target);
    fs.appendFileSync(target, line, "utf8");
  } catch (err) {
    try {
      console.error("[crash-log] write failed:", err?.message || err);
    } catch {
      /* ignore */
    }
  }
}

let installed = false;

/**
 * Local Chromium dumps + process handlers. Call once at main-process boot,
 * before app.whenReady. An `uncaughtException` listener stops Node's default
 * exit so a thrown ACP line cannot silently kill the GUI.
 */
export function installCrashLogging() {
  if (installed) return getCrashLogPath();
  installed = true;
  const electron = electronApp();

  try {
    electron?.crashReporter?.start?.({
      productName: "Grok Desktop",
      uploadToServer: false,
      compress: true,
    });
  } catch (err) {
    writeCrashLog("crashReporter", "start-failed", errorFields(err));
  }

  writeCrashLog("app", "crash-logging-installed", {
    version: electron?.app?.getVersion?.() || null,
    packaged: Boolean(electron?.app?.isPackaged),
    platform: process.platform,
    electron: process.versions?.electron || null,
    dumps: getCrashDumpsPath(),
  });

  process.on("uncaughtException", (err) => {
    writeCrashLog("uncaughtException", err?.message || String(err), errorFields(err));
    try {
      console.error("[crash] uncaughtException", err);
    } catch {
      /* ignore */
    }
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    writeCrashLog("unhandledRejection", err.message, errorFields(reason));
    try {
      console.error("[crash] unhandledRejection", reason);
    } catch {
      /* ignore */
    }
  });

  const app = electron?.app;
  if (!app?.on) return getCrashLogPath();

  app.on("render-process-gone", (_event, wc, details) => {
    let url = null;
    try {
      url = wc?.getURL?.() || null;
    } catch {
      /* ignore */
    }
    writeCrashLog("render-process-gone", details?.reason || "gone", {
      reason: details?.reason,
      exitCode: details?.exitCode,
      killed: details?.killed,
      url,
    });
  });

  app.on("child-process-gone", (_event, details) => {
    writeCrashLog("child-process-gone", details?.reason || "gone", {
      type: details?.type,
      reason: details?.reason,
      exitCode: details?.exitCode,
      name: details?.name,
      serviceName: details?.serviceName,
    });
  });

  app.on("gpu-info-update", () => {
    /* ignore — noisy */
  });

  app.on("window-all-closed", () => {
    writeCrashLog("app", "window-all-closed", {});
  });

  app.on("before-quit", () => {
    writeCrashLog("app", "before-quit", {});
  });

  app.on("will-quit", () => {
    writeCrashLog("app", "will-quit", {});
  });

  app.on("quit", (_e, exitCode) => {
    writeCrashLog("app", "quit", { exitCode });
  });

  return getCrashLogPath();
}
