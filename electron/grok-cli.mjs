/**
 * Dedicated grok CLI helpers for Desktop (version + update check/install).
 * Never shell:true. Do not expose a generic "run any args" IPC.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentEnv } from "./auth.mjs";
import {
  buildGrokEnv,
  grokBinaryExists,
  grokHomeDir,
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
 *   signedIn: boolean,
 *   liveStatus: string | null,
 *   authRequired: boolean,
 *   liveToolCount: number | null,
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
      signedIn: false,
      liveStatus: null,
      authRequired: false,
      liveToolCount: null,
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
    signedIn: false,
    liveStatus: null,
    authRequired: false,
    liveToolCount: null,
  };
}

/**
 * OAuth handshake failures from `grok mcp doctor` (non-interactive — no browser).
 * @param {unknown} text
 */
export function mcpTextNeedsAuth(text) {
  return /oauth authorization required|no stored tokens|authenticate in tui|authorization required, when send initialize|re-authenticate in tui|stored credentials unusable/i.test(
    String(text || ""),
  );
}

/**
 * Server names that have an OAuth token on disk. Keys are `name:url`.
 * Never copies token values.
 * @param {unknown} raw
 * @returns {Set<string>}
 */
export function mcpCredentialServerNames(raw) {
  /** @type {Set<string>} */
  const names = new Set();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return names;
  for (const key of Object.keys(/** @type {Record<string, unknown>} */ (raw))) {
    const trimmed = String(key || "").trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    names.add(colon > 0 ? trimmed.slice(0, colon) : trimmed);
  }
  return names;
}

/**
 * Drop OAuth entries for one MCP server. Keys are `name:url` (or bare name).
 * Never copies token values.
 * @param {unknown} raw
 * @param {string} serverName
 * @returns {{ next: Record<string, unknown> | null, removed: number }}
 */
export function stripMcpCredentialKeys(raw, serverName) {
  const name = String(serverName || "").trim();
  if (!name) return { next: null, removed: 0 };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { next: {}, removed: 0 };
  }
  /** @type {Record<string, unknown>} */
  const next = {};
  let removed = 0;
  for (const key of Object.keys(/** @type {Record<string, unknown>} */ (raw))) {
    if (key === name || key.startsWith(`${name}:`)) {
      removed += 1;
      continue;
    }
    next[key] = /** @type {Record<string, unknown>} */ (raw)[key];
  }
  return { next, removed };
}

/**
 * Remove stored MCP OAuth tokens for `name` from ~/.grok/mcp_credentials.json.
 * Does not edit config.toml. Live agent still needs Restart to drop in-memory tokens.
 * @param {string} serverName
 * @param {{ home?: string }} [opts]
 * @returns {{ ok: boolean, removed: number, error?: string | null }}
 */
export function logoutMcpServer(serverName, opts = {}) {
  const name = String(serverName || "").trim();
  if (!name) {
    return { ok: false, removed: 0, error: "MCP server name is required" };
  }
  const file = path.join(opts.home || grokHomeDir(), "mcp_credentials.json");
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err && typeof err === "object" && /** @type {{ code?: string }} */ (err).code === "ENOENT") {
      return { ok: true, removed: 0, error: null };
    }
    return {
      ok: false,
      removed: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const { next, removed } = stripMcpCredentialKeys(raw, name);
  if (!removed) return { ok: true, removed: 0, error: null };
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmp, file);
    return { ok: true, removed, error: null };
  } catch (err) {
    return {
      ok: false,
      removed: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * @param {string} [home]
 * @returns {Set<string>}
 */
export function readMcpCredentialServerNames(home = grokHomeDir()) {
  try {
    const file = path.join(home, "mcp_credentials.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return mcpCredentialServerNames(raw);
  } catch {
    return new Set();
  }
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
  const argv = ["mcp", "doctor", "--json"];
  if (name != null && String(name).trim()) {
    argv.push(assertMcpName(name));
  }
  return argv;
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function doctorSourceLabel(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const o = /** @type {Record<string, unknown>} */ (raw);
    if (o.type === "plugin" && o.plugin_name) {
      return `plugin: ${String(o.plugin_name)}`;
    }
    if (o.path) return String(o.path);
    if (o.type) return String(o.type);
  }
  return null;
}

/**
 * Tool names from a doctor server row. Never copies descriptions or schemas.
 * @param {Record<string, unknown>} server
 * @returns {string[]}
 */
function doctorToolNames(server) {
  const buckets = [
    server.tools,
    server.tool_names,
    server.toolNames,
    server.discovered_tools,
    server.discoveredTools,
  ];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const raw of buckets) {
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      let name = "";
      if (typeof item === "string") name = item.trim();
      else if (item && typeof item === "object") {
        const rec = /** @type {Record<string, unknown>} */ (item);
        name = String(rec.name ?? rec.id ?? rec.tool ?? "").trim();
      }
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {{ label: string, passed: boolean, detail: string | null }}
 */
function mapDoctorCheck(raw) {
  if (!raw || typeof raw !== "object") {
    return { label: "", passed: false, detail: null };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const label = String(o.label ?? o.name ?? o.check ?? "").trim();
  const passed = o.passed === true || o.ok === true || o.status === "ok";
  const detail =
    o.detail == null || o.detail === "" ? null : String(o.detail);
  return { label, passed, detail };
}

/**
 * @param {string} label
 * @param {string | null} detail
 * @returns {number | null}
 */
function toolCountFromCheck(label, detail) {
  const text = `${label} ${detail || ""}`;
  const match = text.match(/(\d+)\s+tools?\s+discovered/i);
  if (match) return Number(match[1]);
  return null;
}

/**
 * Comma / newline tool lists sometimes land in the "N tools discovered" detail.
 * @param {string | null} detail
 * @returns {string[]}
 */
function toolNamesFromDetail(detail) {
  if (!detail) return [];
  if (!/[,;\n]/.test(detail)) return [];
  return detail
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z0-9][A-Za-z0-9_./:-]*$/.test(part));
}

/**
 * Map one `grok mcp doctor --json` server. No env/header values.
 * @param {unknown} raw
 */
export function mapMcpDoctorServer(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      name: "",
      transport: null,
      target: null,
      source: null,
      healthy: false,
      checks: [],
      tools: [],
      toolCount: null,
      needsAuth: false,
    };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const name = String(o.name || o.id || "").trim();
  const checks = Array.isArray(o.checks)
    ? o.checks.map(mapDoctorCheck).filter((c) => c.label)
    : [];
  let tools = doctorToolNames(o);
  if (tools.length === 0) {
    for (const check of checks) {
      const fromDetail = toolNamesFromDetail(check.detail);
      if (fromDetail.length) {
        tools = fromDetail;
        break;
      }
    }
  }
  let toolCount = null;
  if (typeof o.tool_count === "number") toolCount = o.tool_count;
  else if (typeof o.toolCount === "number") toolCount = o.toolCount;
  if (toolCount == null) {
    for (const check of checks) {
      const n = toolCountFromCheck(check.label, check.detail);
      if (n != null) {
        toolCount = n;
        break;
      }
    }
  }
  if (toolCount == null && tools.length) toolCount = tools.length;

  const transport =
    o.transport == null || o.transport === ""
      ? null
      : String(o.transport).toLowerCase();
  const target =
    o.target == null || o.target === ""
      ? o.url == null || o.url === ""
        ? null
        : String(o.url)
      : String(o.target);

  const needsAuth = checks.some((c) =>
    !c.passed && mcpTextNeedsAuth(`${c.label} ${c.detail || ""}`),
  );

  return {
    name,
    transport,
    target,
    source: doctorSourceLabel(o.source),
    healthy: o.healthy === true,
    checks,
    tools,
    toolCount,
    needsAuth,
  };
}

/**
 * Sanitized `grok mcp doctor --json` payload for Settings Test.
 * @param {unknown} data
 */
export function mcpDoctorFromData(data) {
  if (!data || typeof data !== "object") {
    return { healthyCount: 0, failingCount: 0, servers: [] };
  }
  const o = /** @type {Record<string, unknown>} */ (data);
  const rows = Array.isArray(o.servers)
    ? o.servers
    : Array.isArray(data)
      ? data
      : [];
  const servers = rows.map(mapMcpDoctorServer).filter((s) => Boolean(s.name));
  const healthyCount =
    typeof o.healthy_count === "number"
      ? o.healthy_count
      : typeof o.healthyCount === "number"
        ? o.healthyCount
        : servers.filter((s) => s.healthy).length;
  const failingCount =
    typeof o.failing_count === "number"
      ? o.failing_count
      : typeof o.failingCount === "number"
        ? o.failingCount
        : servers.filter((s) => !s.healthy).length;
  return { healthyCount, failingCount, servers };
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
 * Sanitized list payload for mcp:list IPC. Never includes raw grok data/stdout
 * (those can hold env/header secret values).
 * @param {boolean} ok
 * @param {ReturnType<typeof mcpServersFromData>} servers
 * @param {"list" | "inspect"} source
 * @param {string | null} [error]
 */
function mcpListResult(ok, servers, source, error = null) {
  return {
    ok: Boolean(ok),
    servers,
    source,
    error: ok ? null : error || "Failed to list MCP servers",
  };
}

/**
 * Flag servers that already have OAuth tokens. Names only — no token values.
 * @param {ReturnType<typeof mcpServersFromData>} servers
 */
function markMcpSignedIn(servers) {
  const signed = readMcpCredentialServerNames();
  if (!signed.size) return servers;
  return servers.map((s) => ({
    ...s,
    signedIn: signed.has(s.name),
  }));
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
    return mcpListResult(true, markMcpSignedIn(servers), "list");
  }

  const inspected = await runGrok(["inspect", "--json"], runOpts);
  if (inspected.ok) {
    const fromInspect = mcpServersFromData(
      inspected.data?.mcpServers ?? inspected.data,
    );
    if (fromInspect.length > 0 || listed.ok) {
      return mcpListResult(true, markMcpSignedIn(fromInspect), "inspect");
    }
  }

  if (!listed.ok) {
    return mcpListResult(
      false,
      [],
      "list",
      listed.error || "Failed to list MCP servers",
    );
  }
  return mcpListResult(true, [], "list");
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
 * `grok mcp doctor --json [name]` — structured report for Settings Test.
 * Never forwards raw grok `data` (keep env/header secrets off IPC).
 * @param {unknown} [name]
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function doctorMcp(name, opts = {}) {
  const result = await runGrok(mcpDoctorArgv(name), {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 60_000,
    json: true,
    bin: opts.bin,
  });
  const report = mcpDoctorFromData(result.data);
  const fallbackAuth = mcpTextNeedsAuth(
    [result.stdout, result.stderr, result.error].filter(Boolean).join("\n"),
  );
  const servers = report.servers.map((row) =>
    row.needsAuth || fallbackAuth ? { ...row, needsAuth: true } : row,
  );
  return {
    ok: result.ok,
    healthyCount: report.healthyCount,
    failingCount: report.failingCount,
    servers,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

/** Plugin names: kebab-case or scoped `<scope>/<hash>/<name>` from `grok plugin list`. */
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_./+-]*$/;

/**
 * @param {unknown} name
 * @returns {string}
 */
export function assertPluginName(name) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Plugin name is required");
  if (n.startsWith("-") || n.includes("..") || !PLUGIN_NAME_RE.test(n)) {
    throw new Error(
      "Plugin name may only contain letters, numbers, slashes, dots, and hyphens",
    );
  }
  return n;
}

/**
 * Git URL, GitHub shorthand (user/repo[@ref][#subdir]), or local path.
 * Single argv token — never starts with `-` (no extra grok flags).
 * @param {unknown} source
 * @returns {string}
 */
export function assertPluginSource(source) {
  const s = String(source || "").trim();
  if (!s) throw new Error("Plugin source is required");
  if (s.startsWith("-")) {
    throw new Error("Plugin source must not start with -");
  }
  if (/[\s\r\n]/.test(s)) {
    throw new Error("Plugin source must be a single argv token");
  }
  return s;
}

/**
 * @param {unknown} raw
 * @returns {unknown[]}
 */
export function extractPluginRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (Array.isArray(o.plugins)) return o.plugins;
  if (Array.isArray(o.items)) return o.items;
  return [];
}

/**
 * Map one `grok plugin list --json` / inspect row. Drops `components`.
 * @param {unknown} raw
 * @returns {{
 *   name: string,
 *   enabled: boolean | null,
 *   status: string | null,
 *   version: string | null,
 *   description: string | null,
 *   marketplace: string | null,
 *   source: string | null,
 *   skillCount: number | null,
 *   hasHooks: boolean | null,
 *   hasAgents: boolean | null,
 *   hasMcp: boolean | null,
 * }}
 */
export function mapPluginRow(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      name: "",
      enabled: null,
      status: null,
      version: null,
      description: null,
      marketplace: null,
      source: null,
      skillCount: null,
      hasHooks: null,
      hasAgents: null,
      hasMcp: null,
    };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const name = String(o.name || o.id || "").trim();
  const status =
    o.status == null || o.status === "" ? null : String(o.status).toLowerCase();
  /** @type {boolean | null} */
  let enabled = null;
  if (typeof o.enabled === "boolean") enabled = o.enabled;
  else if (o.enabled === "true" || o.enabled === 1) enabled = true;
  else if (o.enabled === "false" || o.enabled === 0) enabled = false;
  else if (status === "disabled") enabled = false;
  else if (status === "enabled" || status === "installed") enabled = true;

  const version = o.version == null || o.version === "" ? null : String(o.version);
  const description =
    o.description == null || o.description === "" ? null : String(o.description);
  const marketplace =
    o.marketplace == null || o.marketplace === "" ? null : String(o.marketplace);
  let source = null;
  if (typeof o.source === "string" && o.source) source = o.source;
  else if (o.source && typeof o.source === "object") {
    const src = /** @type {Record<string, unknown>} */ (o.source);
    source = src.type != null ? String(src.type) : null;
  } else if (marketplace) {
    source = marketplace;
  }

  const skillRaw = o.skill_count ?? o.skillCount;
  const skillCount =
    typeof skillRaw === "number" && Number.isFinite(skillRaw)
      ? skillRaw
      : null;

  /** @param {unknown} v */
  const boolOrNull = (v) => (typeof v === "boolean" ? v : null);

  return {
    name,
    enabled,
    status,
    version,
    description,
    marketplace,
    source,
    skillCount,
    hasHooks: boolOrNull(o.has_hooks ?? o.hasHooks),
    hasAgents: boolOrNull(o.has_agents ?? o.hasAgents),
    hasMcp: boolOrNull(o.has_mcp ?? o.hasMcp),
  };
}

/**
 * @param {unknown} data
 */
export function pluginsFromData(data) {
  return extractPluginRows(data)
    .map(mapPluginRow)
    .filter((p) => Boolean(p.name) && p.status !== "available");
}

/** @returns {string[]} */
export function pluginListArgv() {
  return ["plugin", "list", "--json"];
}

/**
 * @param {unknown} name
 */
export function pluginEnableArgv(name) {
  return ["plugin", "enable", assertPluginName(name)];
}

/**
 * @param {unknown} name
 */
export function pluginDisableArgv(name) {
  return ["plugin", "disable", assertPluginName(name)];
}

/**
 * `grok plugin install [--trust] <source>`. UI confirms, then always --trust
 * (CLI otherwise prints a warning and stops; stdin is not a TTY here).
 *
 * @param {unknown} source
 * @param {{ trust?: boolean }} [opts]
 * @returns {string[]}
 */
export function pluginInstallArgv(source, opts = {}) {
  const src = assertPluginSource(source);
  const argv = ["plugin", "install"];
  if (opts.trust !== false) argv.push("--trust");
  argv.push(src);
  return argv;
}

/**
 * Sanitized list payload for plugin:list IPC. Never includes raw grok data/stdout.
 * @param {boolean} ok
 * @param {ReturnType<typeof pluginsFromData>} plugins
 * @param {"list" | "inspect"} source
 * @param {string | null} [error]
 */
function pluginListResult(ok, plugins, source, error = null) {
  return {
    ok: Boolean(ok),
    plugins,
    source,
    error: ok ? null : error || "Failed to list plugins",
  };
}

/**
 * `grok plugin list --json`. Falls back to `grok inspect --json` plugins
 * when list fails or is unparseable.
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function listPlugins(opts = {}) {
  const runOpts = {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 20_000,
    json: true,
    bin: opts.bin,
  };
  const listed = await runGrok(pluginListArgv(), runOpts);
  if (listed.ok) {
    return pluginListResult(true, pluginsFromData(listed.data), "list");
  }

  const inspected = await runGrok(["inspect", "--json"], runOpts);
  if (inspected.ok) {
    return pluginListResult(
      true,
      pluginsFromData(inspected.data?.plugins ?? inspected.data),
      "inspect",
    );
  }

  return pluginListResult(
    false,
    [],
    "list",
    listed.error || "Failed to list plugins",
  );
}

/**
 * @param {unknown} name
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function enablePlugin(name, opts = {}) {
  return runGrok(pluginEnableArgv(name), {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 20_000,
    bin: opts.bin,
  });
}

/**
 * @param {unknown} name
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string }} [opts]
 */
export async function disablePlugin(name, opts = {}) {
  return runGrok(pluginDisableArgv(name), {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 20_000,
    bin: opts.bin,
  });
}

/**
 * `grok plugin install --trust <source>` after the UI confirms.
 * @param {unknown} source
 * @param {{ cwd?: string, timeoutMs?: number, bin?: string, trust?: boolean }} [opts]
 */
export async function installPlugin(source, opts = {}) {
  return runGrok(pluginInstallArgv(source, { trust: opts.trust }), {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 120_000,
    bin: opts.bin,
  });
}
