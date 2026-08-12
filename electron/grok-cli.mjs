/**
 * Dedicated grok CLI helpers for Desktop (version + update check/install).
 * Never shell:true. Do not expose a generic "run any args" IPC.
 */
import { spawn } from "node:child_process";
import { agentEnv } from "./auth.mjs";
import {
  buildGrokEnv,
  grokBinaryExists,
  resolveGrokBinary,
} from "./grok-home.mjs";

export { agentEnv, buildGrokEnv, grokBinaryExists, resolveGrokBinary };

/**
 * @param {unknown} err
 */
export function isMissingGrokBinaryError(err) {
  if (!err) return false;
  if (typeof err === "object" && /** @type {{ code?: string }} */ (err).code === "ENOENT") {
    return true;
  }
  const msg = String(
    typeof err === "object" && err && "message" in err
      ? /** @type {{ message?: unknown }} */ (err).message
      : err,
  );
  return /\bENOENT\b/i.test(msg) || /Grok CLI not found/i.test(msg);
}

/**
 * @param {string} [bin]
 */
export function missingGrokBinaryMessage(bin) {
  return bin
    ? `Grok CLI not found (${bin}). Install Grok Build first, then retry.`
    : "Grok CLI not found. Install Grok Build first, then retry.";
}

/**
 * Parse JSON from grok --json stdout (tolerate a log line around the object).
 * @param {string} text
 */
export function parseGrokJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Empty grok output");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Failed to parse grok JSON");
  }
}

/**
 * @param {unknown} data
 * @returns {string | null}
 */
export function versionFromData(data) {
  if (!data || typeof data !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (data);
  const v = o.currentVersion ?? o.version ?? o.grokVersion;
  if (v == null || v === "") return null;
  return String(v);
}

/**
 * @param {unknown} data
 */
export function updateFromData(data) {
  if (!data || typeof data !== "object") {
    return {
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      channel: null,
    };
  }
  const o = /** @type {Record<string, unknown>} */ (data);
  return {
    currentVersion: o.currentVersion == null ? null : String(o.currentVersion),
    latestVersion: o.latestVersion == null ? null : String(o.latestVersion),
    updateAvailable: Boolean(o.updateAvailable),
    channel: o.channel == null ? null : String(o.channel),
  };
}

/**
 * Spawn grok (or a test binary) with an argv array. Never shell:true.
 * @param {string[]} args
 * @param {{
 *   cwd?: string,
 *   timeoutMs?: number,
 *   json?: boolean,
 *   bin?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   data: any,
 *   stdout: string,
 *   stderr: string,
 *   code: number | null,
 *   error: string | null,
 * }>}
 */
export function runGrok(args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const binary = opts.bin || resolveGrokBinary();
  const argv = Array.isArray(args) ? args : [];

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    /** @param {{ ok: boolean, data: any, stdout: string, stderr: string, code: number | null, error: string | null }} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    /** @type {import("node:child_process").ChildProcess | null} */
    let proc = null;
    try {
      proc = spawn(binary, argv, {
        cwd: opts.cwd || process.cwd(),
        env: opts.env || agentEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      const message = err?.message || String(err);
      finish({
        ok: false,
        data: null,
        stdout: "",
        stderr: message,
        code: null,
        error: isMissingGrokBinaryError(err)
          ? missingGrokBinaryMessage(binary)
          : message,
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        proc?.kill();
      } catch {
        /* ignore */
      }
      const error = `grok timed out after ${timeoutMs}ms`;
      finish({
        ok: false,
        data: null,
        stdout,
        stderr: stderr || error,
        code: null,
        error,
      });
    }, timeoutMs);

    proc.stdout?.on("data", (c) => {
      stdout += c.toString();
    });
    proc.stderr?.on("data", (c) => {
      stderr += c.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      const message = err?.message || String(err);
      finish({
        ok: false,
        data: null,
        stdout,
        stderr: stderr || message,
        code: null,
        error: isMissingGrokBinaryError(err)
          ? missingGrokBinaryMessage(binary)
          : message,
      });
    });

    proc.on("exit", (code) => {
      clearTimeout(timer);
      let data = null;
      let parseError = null;
      if (opts.json) {
        try {
          data = parseGrokJson(stdout);
        } catch (e) {
          parseError = e?.message || "Failed to parse grok JSON";
        }
      }
      const ok = code === 0 && (!opts.json || data != null);
      finish({
        ok,
        data,
        stdout,
        stderr,
        code: typeof code === "number" ? code : null,
        error: ok
          ? null
          : parseError || stderr.trim() || `grok exited ${code}`,
      });
    });
  });
}

/**
 * `grok version --json`
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function getGrokVersion(opts = {}) {
  const result = await runGrok(["version", "--json"], {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 15_000,
    json: true,
    bin: opts.bin,
  });
  return {
    ...result,
    version: versionFromData(result.data),
  };
}

/**
 * `grok update --check --json` — never installs.
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function checkGrokUpdate(opts = {}) {
  const result = await runGrok(["update", "--check", "--json"], {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 30_000,
    json: true,
    bin: opts.bin,
  });
  const parsed = updateFromData(result.data);
  return {
    ...result,
    ...parsed,
  };
}

/**
 * `grok update` — install after the user confirms in the UI.
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function installGrokUpdate(opts = {}) {
  return runGrok(["update"], {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 120_000,
    bin: opts.bin,
  });
}

/**
 * Path + version for Settings / AuthGate. Does not run update.
 */
export async function getGrokEngine() {
  const binary = resolveGrokBinary();
  const binaryFound = grokBinaryExists();
  if (!binaryFound) {
    return {
      binary,
      binaryFound: false,
      version: null,
    };
  }
  const result = await getGrokVersion();
  return {
    binary,
    binaryFound: true,
    version: result.version,
    error: result.ok ? undefined : result.error || undefined,
  };
}
