/**
 * Grok auth for the desktop shell — reuses the official CLI:
 *   grok login --oauth   (browser OAuth → ~/.grok/auth.json)
 *   grok logout
 *   XAI_API_KEY fallback for this process only
 *
 * Never returns token material to the renderer.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  authJsonPath,
  buildGrokEnv,
  grokBinaryExists,
  grokHomeDir,
  resolveGrokBinary,
} from "./grok-home.mjs";

/** @type {string | null} session-only API key (not written to disk) */
let sessionApiKey = null;

/** @type {import('node:child_process').ChildProcess | null} */
let loginProc = null;

export function setSessionApiKey(key) {
  const trimmed = (key || "").trim();
  sessionApiKey = trimmed || null;
  return Boolean(sessionApiKey);
}

export function clearSessionApiKey() {
  sessionApiKey = null;
}

export function getSessionApiKey() {
  return sessionApiKey;
}

/**
 * Env for agent / login children (includes optional session API key).
 * @param {Record<string, string | undefined>} [extra]
 */
export function agentEnv(extra = {}) {
  /** @type {Record<string, string | undefined>} */
  const more = { ...extra };
  if (sessionApiKey) more.XAI_API_KEY = sessionApiKey;
  return buildGrokEnv(more);
}

/**
 * Read auth status from ~/.grok/auth.json + env. Never expose tokens.
 */
export function getAuthStatus() {
  const hasEnvKey = Boolean(
    sessionApiKey || process.env.XAI_API_KEY || process.env.GROK_CODE_XAI_API_KEY,
  );
  const binary = resolveGrokBinary();
  const binaryOk = grokBinaryExists();
  const authPath = authJsonPath();
  const grokHome = grokHomeDir();

  const base = {
    binary,
    binaryFound: binaryOk,
    grokHome,
    authPath,
    authenticated: false,
    method: null,
    email: null,
    displayName: null,
    expiresAt: null,
    expired: false,
    hasApiKey: hasEnvKey,
    loginInProgress: Boolean(loginProc && !loginProc.killed),
  };

  if (!fs.existsSync(authPath)) {
    if (hasEnvKey) {
      return {
        ...base,
        authenticated: true,
        method: "api_key",
      };
    }
    return base;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const entry = pickAuthEntry(raw);
    if (!entry) {
      if (hasEnvKey) {
        return { ...base, authenticated: true, method: "api_key" };
      }
      return base;
    }

    const expiresAt = entry.expires_at || entry.expiresAt || null;
    let expired = false;
    if (expiresAt) {
      const t = Date.parse(expiresAt);
      if (!Number.isNaN(t)) expired = t < Date.now();
    }

    const email = entry.email || null;
    const displayName =
      [entry.first_name, entry.last_name].filter(Boolean).join(" ").trim() ||
      email;

    // Session token preferred; API key still counts if session expired
    const sessionOk = !expired;
    const authenticated = sessionOk || hasEnvKey;

    return {
      ...base,
      authenticated,
      method: sessionOk
        ? entry.auth_mode || entry.authMode || "oauth"
        : hasEnvKey
          ? "api_key"
          : entry.auth_mode || "oauth",
      email,
      displayName: displayName || null,
      expiresAt,
      expired,
      hasApiKey: hasEnvKey,
    };
  } catch {
    if (hasEnvKey) {
      return { ...base, authenticated: true, method: "api_key" };
    }
    return base;
  }
}

/**
 * @param {unknown} raw
 */
function pickAuthEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  for (const v of Object.values(/** @type {Record<string, unknown>} */ (raw))) {
    if (v && typeof v === "object") {
      const o = /** @type {Record<string, unknown>} */ (v);
      if (
        o.key ||
        o.refresh_token ||
        o.access_token ||
        o.email ||
        o.auth_mode ||
        o.authMode
      ) {
        return o;
      }
    }
  }
  return null;
}

/**
 * Run `grok login` (browser OAuth by default). Waits until the CLI exits.
 * @param {{ deviceAuth?: boolean }} [opts]
 */
export function startLogin(opts = {}) {
  if (loginProc && !loginProc.killed) {
    return Promise.reject(new Error("Login already in progress"));
  }

  const bin = resolveGrokBinary();
  if (!grokBinaryExists() && !bin.includes("grok")) {
    return Promise.reject(
      new Error(
        "Grok CLI not found. Install Grok Build first, then sign in here.",
      ),
    );
  }

  const args = opts.deviceAuth
    ? ["login", "--device-auth"]
    : ["login", "--oauth"];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn(bin, args, {
      env: agentEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });
    loginProc = proc;

    proc.stdout?.on("data", (c) => {
      stdout += c.toString();
    });
    proc.stderr?.on("data", (c) => {
      stderr += c.toString();
    });

    proc.on("error", (err) => {
      loginProc = null;
      reject(
        new Error(
          err?.code === "ENOENT"
            ? "Grok CLI not found on PATH. Install from https://x.ai/cli then retry Sign in."
            : err.message || String(err),
        ),
      );
    });

    proc.on("exit", (code, signal) => {
      loginProc = null;
      const status = getAuthStatus();
      if (status.authenticated && !status.expired) {
        resolve({
          ok: true,
          status,
          code,
          // device-auth may print a URL/code — safe text only
          output: summarizeLoginOutput(stdout, stderr),
        });
        return;
      }
      if (code === 0) {
        // CLI exited cleanly but we still don't see auth — re-read once more
        resolve({
          ok: status.authenticated,
          status,
          code,
          output: summarizeLoginOutput(stdout, stderr),
        });
        return;
      }
      reject(
        new Error(
          summarizeLoginOutput(stdout, stderr) ||
            `Login failed (exit ${code}${signal ? ` signal ${signal}` : ""}). Try again.`,
        ),
      );
    });
  });
}

export function cancelLogin() {
  if (loginProc && !loginProc.killed) {
    try {
      loginProc.kill();
    } catch {
      /* ignore */
    }
  }
  loginProc = null;
}

/**
 * Run `grok logout` to clear ~/.grok/auth.json session.
 */
export function startLogout() {
  cancelLogin();
  clearSessionApiKey();
  const bin = resolveGrokBinary();

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["logout"], {
      env: agentEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    proc.stderr?.on("data", (c) => {
      stderr += c.toString();
    });
    proc.on("error", (err) => {
      // If logout binary fails, still try to clear local session key
      reject(err);
    });
    proc.on("exit", (code) => {
      resolve({
        ok: code === 0,
        code,
        status: getAuthStatus(),
        message: stderr.trim() || (code === 0 ? "Signed out" : `logout exit ${code}`),
      });
    });
  });
}

/**
 * Strip noise; keep URLs and short codes for device auth UI.
 * @param {string} stdout
 * @param {string} stderr
 */
function summarizeLoginOutput(stdout, stderr) {
  const text = `${stdout}\n${stderr}`.trim();
  if (!text) return "";
  // Prefer lines with URLs or "code"
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const interesting = lines.filter(
    (l) =>
      /https?:\/\//i.test(l) ||
      /code/i.test(l) ||
      /login|sign|auth|error|fail/i.test(l),
  );
  const pick = (interesting.length ? interesting : lines).slice(-8);
  // Never pass JWT-looking blobs to the UI
  return pick
    .map((l) => l.replace(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9._-]+/g, "[token]"))
    .join("\n")
    .slice(0, 2000);
}
