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
    const candidates = [];
    const objStart = trimmed.indexOf("{");
    const objEnd = trimmed.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
      candidates.push({ start: objStart, slice: trimmed.slice(objStart, objEnd + 1) });
    }
    const arrStart = trimmed.indexOf("[");
    const arrEnd = trimmed.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      candidates.push({ start: arrStart, slice: trimmed.slice(arrStart, arrEnd + 1) });
    }
    candidates.sort((a, b) => a.start - b.start);
    for (const c of candidates) {
      try {
        return JSON.parse(c.slice);
      } catch {
        /* try next brace pair */
      }
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

/** Server names: letters, numbers, hyphens, underscores (CLI contract). */
const MCP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MCP_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @param {unknown} name
 * @returns {string}
 */
export function assertMcpName(name) {
  const n = String(name || "").trim();
  if (!n) throw new Error("MCP server name is required");
  if (!MCP_NAME_RE.test(n)) {
    throw new Error(
      "MCP name may only contain letters, numbers, hyphens, and underscores",
    );
  }
  return n;
}

/**
 * @param {unknown} raw
 * @returns {unknown[]}
 */
export function extractMcpServerRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (Array.isArray(o.servers)) return o.servers;
  if (Array.isArray(o.mcpServers)) return o.mcpServers;
  if (Array.isArray(o.mcp_servers)) return o.mcp_servers;
  return [];
}

/**
 * @param {unknown} value
 */
function objectKeysOnly(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(/** @type {Record<string, unknown>} */ (value)).filter(
    Boolean,
  );
}

/**
 * Map one grok mcp list / inspect row. Never copies env or header values.
 * @param {unknown} raw
 * @returns {{
 *   name: string,
 *   transport: string | null,
 *   enabled: boolean | null,
 *   scope: string | null,
 *   command: string | null,
 *   args: string[],
 *   url: string | null,
 *   envKeys: string[],
 *   headerKeys: string[],
 *   source: string | null,
 * }}
 */
export function mapMcpServerRow(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      name: "",
      transport: null,
      enabled: null,
      scope: null,
      command: null,
      args: [],
      url: null,
      envKeys: [],
      headerKeys: [],
      source: null,
    };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const name = String(o.name || o.id || "").trim();
  const url = o.url == null || o.url === "" ? null : String(o.url);
  const command = o.command == null || o.command === "" ? null : String(o.command);
  const declared =
    o.transport == null || o.transport === ""
      ? ""
      : String(o.transport).toLowerCase();
  let transport = null;
  if (declared === "stdio" || declared === "http" || declared === "sse") {
    transport = declared;
  } else if (url) {
    transport = "http";
  } else if (command) {
    transport = "stdio";
  } else if (declared) {
    transport = declared;
  }
  /** @type {boolean | null} */
  let enabled = null;
  if (typeof o.enabled === "boolean") enabled = o.enabled;
  else if (o.enabled === "true" || o.enabled === 1) enabled = true;
  else if (o.enabled === "false" || o.enabled === 0) enabled = false;

  let scope = o.scope == null || o.scope === "" ? null : String(o.scope);
  let source = null;
  if (typeof o.source === "string" && o.source) {
    source = o.source;
  } else if (o.source && typeof o.source === "object") {
    const src = /** @type {Record<string, unknown>} */ (o.source);
    source = src.type != null ? String(src.type) : null;
  }

  const args = Array.isArray(o.args) ? o.args.map((a) => String(a)) : [];

  return {
    name,
    transport,
    enabled,
    scope,
    command,
    args,
    url,
    envKeys: objectKeysOnly(o.env),
    headerKeys: objectKeysOnly(o.headers),
    source,
  };
}

/**
 * @param {unknown} data
 */
export function mcpServersFromData(data) {
  return extractMcpServerRows(data)
    .map(mapMcpServerRow)
    .filter((s) => Boolean(s.name));
}

/**
 * @returns {string[]}
 */
export function mcpListArgv() {
  return ["mcp", "list", "--json"];
}

/**
 * @param {unknown} name
 */
export function mcpEnableArgv(name) {
  return ["mcp", "enable", assertMcpName(name)];
}

/**
 * @param {unknown} name
 */
export function mcpDisableArgv(name) {
  return ["mcp", "disable", assertMcpName(name)];
}

/**
 * @param {unknown} name
 * @param {{ scope?: string }} [opts]
 */
export function mcpRemoveArgv(name, opts = {}) {
  const argv = ["mcp", "remove", assertMcpName(name)];
  if (opts.scope === "user" || opts.scope === "project") {
    argv.push("--scope", opts.scope);
  }
  return argv;
}

/**
 * @param {unknown} [name]
 */
export function mcpDoctorArgv(name) {
  const argv = ["mcp", "doctor"];
  if (name != null && String(name).trim()) {
    argv.push(assertMcpName(name));
  }
  return argv;
}

/**
 * @param {unknown} raw
 * @returns {Array<{ key: string, value: string }>}
 */
function normalizeEnvPairs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    /** @type {Array<{ key: string, value: string }>} */
    const out = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const rec = /** @type {Record<string, unknown>} */ (row);
      const key = String(rec.key ?? rec.name ?? "").trim();
      if (!key) continue;
      out.push({ key, value: rec.value == null ? "" : String(rec.value) });
    }
    return out;
  }
  if (typeof raw === "object") {
    return Object.entries(/** @type {Record<string, unknown>} */ (raw)).map(
      ([key, value]) => ({
        key: String(key),
        value: value == null ? "" : String(value),
      }),
    );
  }
  return [];
}

/**
 * @param {unknown} raw
 * @returns {Array<{ name: string, value: string }>}
 */
function normalizeHeaderPairs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    /** @type {Array<{ name: string, value: string }>} */
    const out = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const rec = /** @type {Record<string, unknown>} */ (row);
      const name = String(rec.name ?? rec.key ?? "").trim();
      if (!name) continue;
      out.push({ name, value: rec.value == null ? "" : String(rec.value) });
    }
    return out;
  }
  if (typeof raw === "object") {
    return Object.entries(/** @type {Record<string, unknown>} */ (raw)).map(
      ([name, value]) => ({
        name: String(name),
        value: value == null ? "" : String(value),
      }),
    );
  }
  return [];
}

/**
 * Build `grok mcp add` argv. Never shell:true; secrets stay in dedicated flags.
 * stdio: `mcp add [--scope project] [-e KEY=val ...] name -- cmd [args...]`
 * http:  `mcp add --transport http [--scope project] [--header "N: V"] name url`
 *
 * @param {{
 *   name?: unknown,
 *   transport?: unknown,
 *   command?: unknown,
 *   args?: unknown,
 *   url?: unknown,
 *   env?: unknown,
 *   headers?: unknown,
 *   scope?: unknown,
 * }} spec
 * @returns {string[]}
 */
export function mcpAddArgv(spec = {}) {
  const name = assertMcpName(spec.name);
  const transport = String(spec.transport || "stdio").toLowerCase();
  if (transport !== "stdio" && transport !== "http" && transport !== "sse") {
    throw new Error(`Unsupported MCP transport: ${transport}`);
  }
  const scope = spec.scope === "project" ? "project" : "user";
  /** @type {string[]} */
  const argv = ["mcp", "add"];
  if (transport === "http" || transport === "sse") {
    argv.push("--transport", transport);
  }
  if (scope === "project") argv.push("--scope", "project");

  for (const pair of normalizeEnvPairs(spec.env)) {
    if (!MCP_ENV_KEY_RE.test(pair.key)) {
      throw new Error(`Invalid env key: ${pair.key}`);
    }
    argv.push("-e", `${pair.key}=${pair.value}`);
  }
  for (const pair of normalizeHeaderPairs(spec.headers)) {
    if (!pair.name || /[\r\n]/.test(pair.name)) {
      throw new Error("Invalid header name");
    }
    argv.push("--header", `${pair.name}: ${pair.value}`);
  }

  argv.push(name);

  if (transport === "http" || transport === "sse") {
    const url = String(spec.url || "").trim();
    if (!url) throw new Error("HTTP MCP server requires a URL");
    argv.push(url);
    return argv;
  }

  const command = String(spec.command || "").trim();
  if (!command) throw new Error("stdio MCP server requires a command");
  if (/\s/.test(command)) {
    throw new Error("stdio command must be a single argv token (put flags in args)");
  }
  const extra = Array.isArray(spec.args)
    ? spec.args.map((a) => String(a))
    : String(spec.args || "").trim()
      ? String(spec.args).trim().split(/\s+/)
      : [];
  argv.push("--", command, ...extra);
  return argv;
}

/**
 * `grok mcp list --json`. Falls back to `grok inspect --json` mcpServers
 * when list is empty or unparseable (older CLI / plugin-only servers).
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function listMcpServers(opts = {}) {
  const runOpts = {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 20_000,
    json: true,
    bin: opts.bin,
  };
  const listed = await runGrok(mcpListArgv(), runOpts);
  let servers = listed.ok ? mcpServersFromData(listed.data) : [];
  if (servers.length > 0) {
    return {
      ...listed,
      ok: true,
      servers,
      source: "list",
    };
  }

  const inspected = await runGrok(["inspect", "--json"], runOpts);
  if (inspected.ok) {
    const fromInspect = mcpServersFromData(
      inspected.data?.mcpServers ?? inspected.data,
    );
    if (fromInspect.length > 0 || listed.ok) {
      return {
        ...inspected,
        ok: true,
        servers: fromInspect,
        source: "inspect",
        error: null,
      };
    }
  }

  if (!listed.ok) {
    return {
      ...listed,
      servers: [],
      source: "list",
    };
  }
  return {
    ...listed,
    ok: true,
    servers: [],
    source: "list",
  };
}

/**
 * @param {Parameters<typeof mcpAddArgv>[0]} spec
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function addMcpServer(spec, opts = {}) {
  const argv = mcpAddArgv(spec);
  return runGrok(argv, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 30_000,
    bin: opts.bin,
  });
}

/**
 * @param {unknown} name
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function enableMcpServer(name, opts = {}) {
  return runGrok(mcpEnableArgv(name), {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 20_000,
    bin: opts.bin,
  });
}

/**
 * @param {unknown} name
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function disableMcpServer(name, opts = {}) {
  return runGrok(mcpDisableArgv(name), {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 20_000,
    bin: opts.bin,
  });
}

/**
 * @param {unknown} name
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string, scope?: string }} [opts]
 */
export async function removeMcpServer(name, opts = {}) {
  return runGrok(mcpRemoveArgv(name, { scope: opts.scope }), {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 20_000,
    bin: opts.bin,
  });
}

/**
 * `grok mcp doctor [name]` — human stdout for the Settings Test action.
 * @param {unknown} [name]
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function doctorMcp(name, opts = {}) {
  return runGrok(mcpDoctorArgv(name), {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 60_000,
    bin: opts.bin,
  });
}
