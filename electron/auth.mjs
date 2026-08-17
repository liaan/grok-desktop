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
let loginStdout = "";
let loginStderr = "";
let loginDeviceAuth = false;

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
 *
 * grok only reads a pasted finish-code from a TTY. Desktop is not a TTY, so
 * submitLoginInput delivers the code to the CLI loopback callback instead.
 *
 * @param {{
 *   deviceAuth?: boolean,
 *   onProgress?: (progress: ReturnType<typeof buildLoginProgress>) => void,
 * }} [opts]
 */
export function startLogin(opts = {}) {
  if (loginProc && !loginProc.killed) {
    return Promise.reject(new Error("Login already in progress"));
  }

  const bin = resolveGrokBinary();
  if (!grokBinaryExists()) {
    return Promise.reject(
      new Error(
        `Grok CLI not found (${bin}). Install Grok Build first, then retry.`,
      ),
    );
  }

  const args = opts.deviceAuth
    ? ["login", "--device-auth"]
    : ["login", "--oauth"];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    loginStdout = "";
    loginStderr = "";
    loginDeviceAuth = Boolean(opts.deviceAuth);

    const proc = spawn(bin, args, {
      env: agentEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    loginProc = proc;

    const emitProgress = () => {
      if (loginProc !== proc) return;
      loginStdout = stdout;
      loginStderr = stderr;
      if (typeof opts.onProgress !== "function") return;
      opts.onProgress(
        buildLoginProgress(stdout, stderr, { deviceAuth: loginDeviceAuth }),
      );
    };

    proc.stdout?.on("data", (c) => {
      stdout += c.toString();
      emitProgress();
    });
    proc.stderr?.on("data", (c) => {
      stderr += c.toString();
      emitProgress();
    });

    proc.on("error", (err) => {
      if (loginProc === proc) loginProc = null;
      reject(
        new Error(
          err?.code === "ENOENT"
            ? `Grok CLI not found (${bin}). Install Grok Build first, then retry.`
            : err.message || String(err),
        ),
      );
    });

    proc.on("exit", (code, signal) => {
      if (loginProc === proc) loginProc = null;
      const status = getAuthStatus();
      const output = summarizeLoginOutput(stdout, stderr);
      if (status.authenticated && !status.expired) {
        resolve({
          ok: true,
          status,
          code,
          output,
        });
        return;
      }
      if (code === 0) {
        resolve({
          ok: status.authenticated,
          status,
          code,
          output,
        });
        return;
      }
      reject(
        new Error(
          output ||
            `Login failed (exit ${code}${signal ? ` signal ${signal}` : ""}). Try again.`,
        ),
      );
    });
  });
}

/**
 * Kill the in-flight login child. The pointer stays until `exit` so a
 * restart cannot be cleared by the previous process.
 */
export function cancelLogin() {
  const proc = loginProc;
  if (!proc || proc.killed) return;
  try {
    proc.stdin?.end();
  } catch {
    /* ignore */
  }
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
}

/**
 * Finish-code from the browser: hit the CLI loopback callback (pipe stdin
 * is not a TTY, so grok will not read it).
 * @param {string} text
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function submitLoginInput(text) {
  const line = String(text || "").trim();
  if (!line) return { ok: false, error: "Code is empty." };
  if (!loginProc || loginProc.killed) {
    return { ok: false, error: "No login in progress." };
  }

  const progress = parseLoginProgress(`${loginStdout}\n${loginStderr}`);
  const finishUrl = buildLoopbackFinishUrl(
    extractLoopbackCallback(progress.urls),
    line,
    progress.url,
  );

  if (finishUrl) {
    const hit = await hitLoopbackCallback(finishUrl);
    if (hit.ok) return { ok: true };
    return {
      ok: false,
      error:
        hit.error ||
        "Could not reach the local login callback. Keep this window open and try again.",
    };
  }

  writeLoginStdin(line);
  return {
    ok: false,
    error:
      "Waiting for the local login callback. Keep this window open and try again in a moment.",
  };
}

/**
 * @param {string} line
 */
function writeLoginStdin(line) {
  const stdin = loginProc?.stdin;
  if (!stdin || stdin.destroyed || stdin.writableEnded) return false;
  try {
    stdin.write(`${line}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function hitLoopbackCallback(url) {
  if (!isLoopbackHttpUrl(url)) {
    return { ok: false, error: "Not a local login callback URL." };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: ac.signal,
    });
    if (res.status >= 400) {
      return {
        ok: false,
        error: `Local login callback returned HTTP ${res.status}.`,
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = err?.name === "AbortError"
      ? "Local login callback timed out."
      : err?.message || String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
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

function isLoopbackHost(host) {
  const h = String(host || "").toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
}

/**
 * True when this URL should be shown / opened in a real browser
 * (skip loopback OAuth callbacks).
 * @param {string} url
 */
export function isRemoteLoginUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  try {
    return !isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 */
export function isLoopbackHttpUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" && isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * A URL still growing at the buffer end is incomplete unless it already
 * has the OAuth bits we need (redirect_uri / callback path).
 * @param {string} raw
 * @param {boolean} atEnd
 */
export function isCompleteLoginUrl(raw, atEnd) {
  if (!raw) return false;
  if (!atEnd) return true;
  try {
    const u = new URL(raw);
    if (isLoopbackHost(u.hostname)) {
      return Boolean(u.port) && u.pathname.length > 1;
    }
    if (
      u.searchParams.has("redirect_uri") ||
      u.searchParams.has("state") ||
      u.searchParams.has("code")
    ) {
      return true;
    }
    // Device-login pages have a path and no query; authorize URLs still growing.
    return (
      u.pathname.length > 1 && !/oauth2\/auth|\/authorize\/?$/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Collapse prefix-extensions so a later chunk replaces a truncated URL.
 * @param {string[]} urls
 */
export function mergeUrlPrefixes(urls) {
  /** @type {string[]} */
  const merged = [];
  for (const url of urls) {
    const i = merged.findIndex((p) => url.startsWith(p) || p.startsWith(url));
    if (i < 0) {
      merged.push(url);
      continue;
    }
    if (url.length > merged[i].length) merged[i] = url;
  }
  return merged;
}

/**
 * Loopback redirect the CLI is listening on (`http://127.0.0.1:<port>/callback`).
 * @param {string[]} urls
 */
export function extractLoopbackCallback(urls) {
  const list = Array.isArray(urls) ? urls : [];
  for (const raw of list) {
    try {
      const u = new URL(raw);
      const redirect = u.searchParams.get("redirect_uri");
      if (redirect && isLoopbackHttpUrl(redirect)) {
        return redirect;
      }
      if (isLoopbackHttpUrl(raw) && /callback/i.test(u.pathname)) {
        u.search = "";
        u.hash = "";
        return u.href;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/**
 * Build the GET the CLI loopback server expects from a pasted code or URL.
 * @param {string | null} callbackBase
 * @param {string} pasted
 * @param {string | null} [authorizeUrl]
 */
export function buildLoopbackFinishUrl(callbackBase, pasted, authorizeUrl) {
  const line = String(pasted || "").trim();
  if (!line) return null;

  try {
    const asUrl = new URL(line);
    if (isLoopbackHttpUrl(asUrl.href)) return asUrl.href;
  } catch {
    /* bare code or authorize URL without a valid parse */
  }

  let code = line;
  let state = null;
  try {
    const asUrl = new URL(line);
    if (asUrl.searchParams.get("code")) {
      code = asUrl.searchParams.get("code");
      state = asUrl.searchParams.get("state");
    }
  } catch {
    /* bare code */
  }

  if (!callbackBase || !isLoopbackHttpUrl(callbackBase)) return null;

  if (!state && authorizeUrl) {
    try {
      state = new URL(authorizeUrl).searchParams.get("state");
    } catch {
      /* ignore */
    }
  }

  try {
    const dest = new URL(callbackBase);
    dest.searchParams.set("code", code);
    if (state) dest.searchParams.set("state", state);
    return dest.href;
  } catch {
    return null;
  }
}

/**
 * Pull sign-in URL / device user-code out of CLI stdout+stderr.
 * @param {string} text
 */
export function parseLoginProgress(text) {
  const src = String(text || "");
  /** @type {string[]} */
  const found = [];
  const urlRe = /https?:\/\/[^\s)\]>'"`]+/gi;
  for (const match of src.matchAll(urlRe)) {
    const raw = match[0].replace(/[.,;:]+$/g, "");
    const atEnd = match.index + match[0].length === src.length;
    if (!isCompleteLoginUrl(raw, atEnd)) continue;
    if (!/^https?:\/\//i.test(raw)) continue;
    found.push(raw);
  }
  const urls = mergeUrlPrefixes(found);
  const remotes = urls.filter((u) => isRemoteLoginUrl(u));
  remotes.sort((a, b) => b.length - a.length);
  const url = remotes[0] || urls[0] || null;

  let userCode = null;
  const labeled = src.match(
    /(?:user\s*code|verification\s*code|enter\s+(?:this|the\s+)?code)[:\s]+([A-Z0-9]{4,8}(?:-[A-Z0-9]{3,8})?)/i,
  );
  if (labeled) {
    userCode = labeled[1];
  } else {
    const dashed = src.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
    if (dashed) userCode = dashed[1];
  }

  const needsPaste =
    /paste|copy the code|into grok|authorization code|enter (?:the |this )?code to finish/i.test(
      src,
    );

  return { url, urls, userCode, needsPaste };
}

/**
 * @param {string} stdout
 * @param {string} stderr
 * @param {{ deviceAuth?: boolean }} [extra]
 */
export function buildLoginProgress(stdout, stderr, extra = {}) {
  const parsed = parseLoginProgress(`${stdout}\n${stderr}`);
  const deviceAuth = Boolean(extra.deviceAuth);
  return {
    output: summarizeLoginOutput(stdout, stderr),
    url: parsed.url,
    urls: parsed.urls,
    userCode: parsed.userCode,
    deviceAuth,
    needsPaste: !deviceAuth,
  };
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
