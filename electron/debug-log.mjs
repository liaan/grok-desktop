/**
 * Optional desktop debug log (main process).
 * Enable via Settings or GROK_DESKTOP_DEBUG=1 / true.
 * Writes JSON lines to userData/desktop-debug.log
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** @type {boolean} */
let enabled = false;
/** @type {string | null} */
let logPath = null;
/** Max file size before rotate (bytes) */
const MAX_BYTES = 8 * 1024 * 1024;

function ensurePath() {
  if (logPath) return logPath;
  try {
    // Lazy require so unit tests / node --check can import terminal modules
    // without a full Electron app binding.
    // eslint-disable-next-line global-require
    const { app } = require("electron");
    if (app?.getPath) {
      logPath = path.join(app.getPath("userData"), "desktop-debug.log");
      return logPath;
    }
  } catch {
    /* not in electron */
  }
  logPath = path.join(
    process.env.APPDATA || os.homedir(),
    "grok-desktop",
    "desktop-debug.log",
  );
  return logPath;
}

/**
 * @param {boolean} on
 */
export function setDebugLogging(on) {
  enabled =
    Boolean(on) ||
    /^(1|true|yes|on)$/i.test(String(process.env.GROK_DESKTOP_DEBUG || ""));
  if (enabled) {
    debugLog("debug", "logging enabled", {
      path: ensurePath(),
      env: Boolean(process.env.GROK_DESKTOP_DEBUG),
    });
  }
}

export function isDebugLogging() {
  if (/^(1|true|yes|on)$/i.test(String(process.env.GROK_DESKTOP_DEBUG || ""))) {
    return true;
  }
  return enabled;
}

export function getDebugLogPath() {
  return ensurePath();
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
 * @param {string} scope
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
export function debugLog(scope, message, data) {
  if (!isDebugLogging()) return;
  const file = ensurePath();
  const row = {
    t: new Date().toISOString(),
    scope: String(scope || "app"),
    msg: String(message || ""),
    ...(data && typeof data === "object" ? { data } : {}),
  };
  const line = `${JSON.stringify(row)}\n`;
  try {
    rotateIfNeeded(file);
    fs.appendFileSync(file, line, "utf8");
  } catch (err) {
    try {
      console.warn("[debug-log] write failed:", err?.message || err);
    } catch {
      /* ignore */
    }
  }
  // Also mirror to main console when enabled (DevTools / terminal)
  try {
    console.log(`[desktop-debug][${scope}] ${message}`, data ?? "");
  } catch {
    /* ignore */
  }
}

/**
 * Compact ACP session update for the log (avoid huge tool outputs).
 * @param {any} params
 */
export function summarizeSessionUpdate(params) {
  const update = params?.update ?? params ?? {};
  const kind = update.sessionUpdate || update.session_update || "?";
  /** @type {Record<string, unknown>} */
  const out = { kind };
  if (update.toolCallId || update.tool_call_id) {
    out.toolCallId = update.toolCallId || update.tool_call_id;
  }
  if (update.title) out.title = String(update.title).slice(0, 120);
  if (update.status) out.status = update.status;
  if (update.tool_name || update.toolName) {
    out.toolName = update.tool_name || update.toolName;
  }
  if (update.event_name || update.eventName) {
    out.event = update.event_name || update.eventName;
  }
  if (Array.isArray(update.runs)) {
    out.hooks = update.runs.map((r) => ({
      name: r?.name,
      status: r?.status?.status || r?.status,
      error: r?.status?.error || r?.error,
      ms: r?.status?.elapsed_ms,
    }));
  }
  if (update.rawInput?.command || update.raw_input?.command) {
    out.command = String(
      update.rawInput?.command || update.raw_input?.command || "",
    ).slice(0, 200);
  }
  if (update.task_id || update.taskId) {
    out.taskId = update.task_id || update.taskId;
  }
  if (update.usage) {
    out.usage = {
      in: update.usage.inputTokens,
      out: update.usage.outputTokens,
      total: update.usage.totalTokens,
    };
  }
  if (params?._meta?.totalTokens != null) {
    out.metaTotalTokens = params._meta.totalTokens;
  }
  return out;
}
