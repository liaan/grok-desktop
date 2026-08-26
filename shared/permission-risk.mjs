/**
 * Classify session/request_permission as safe (browse/read) vs write (edit/post/shell).
 * Auto silent-allows safe; writes prompt unless session-grant or always-approve.
 */

import {
  pickAllowOptionId,
  selectedPermissionResult,
} from "./permission-options.mjs";

/** @typedef {'safe' | 'write'} PermissionRisk */

const SAFE_KINDS = new Set([
  "read",
  "search",
  "fetch",
  "think",
  "switch_mode",
  "switch-mode",
]);

const WRITE_KINDS = new Set([
  "edit",
  "delete",
  "move",
  "execute",
  "write",
  "create",
]);

/** Exact tool names (normalized: lowercase, '-' → '_'). Not title tokens. */
const SAFE_NAME_EXACT = new Set([
  "read",
  "read_file",
  "read_text_file",
  "list",
  "list_dir",
  "list_directory",
  "search",
  "grep",
  "glob",
  "find",
  "fetch",
  "get",
  "describe",
  "inspect",
  "snapshot",
  "screenshot",
  "browse",
  "ls",
  "dir",
  "pwd",
  "cat",
  "head",
  "tail",
  "web_search",
  "web_fetch",
  "open_page",
  "preview_open",
  "preview_snapshot",
  "preview_screenshot",
  "preview_network",
  "preview_state",
  "preview_close",
]);

const WRITE_NAME_EXACT = new Set([
  "write",
  "edit",
  "create",
  "delete",
  "remove",
  "unlink",
  "commit",
  "push",
  "apply",
  "patch",
  "mkdir",
  "rmdir",
  "install",
  "publish",
  "post",
  "put",
  "upload",
  "deploy",
  "truncate",
  "chmod",
  "chown",
  "sudo",
  "preview_click",
  "preview_fill",
  "preview_press",
  "preview_interact",
  "preview_type",
  "preview_fill_form",
  "search_replace",
  "str_replace",
]);

/** Unambiguous browse prefixes only — short verbs stay exact. */
const SAFE_NAME_PREFIXES = [
  "web_search",
  "web_fetch",
  "open_page",
  "preview_open",
  "preview_snapshot",
  "preview_screenshot",
  "preview_network",
  "preview_state",
  "preview_close",
];

const WRITE_NAME_PREFIXES = [
  "write",
  "edit",
  "create",
  "delete",
  "remove",
  "unlink",
  "commit",
  "push",
  "apply",
  "patch",
  "mkdir",
  "rmdir",
  "install",
  "publish",
  "post",
  "put",
  "upload",
  "deploy",
  "truncate",
  "chmod",
  "chown",
  "preview_click",
  "preview_fill",
  "preview_press",
  "preview_interact",
  "preview_type",
  "preview_fill_form",
  "search_replace",
  "str_replace",
];

const READ_ONLY_CMDS = new Set([
  "ls",
  "dir",
  "pwd",
  "cat",
  "head",
  "tail",
  "type",
  "rg",
  "grep",
  "findstr",
  "find",
  "wc",
  "which",
  "where",
  "hostname",
  "whoami",
  "date",
  "uname",
  "echo",
]);

const READ_ONLY_GIT = new Set([
  "status",
  "log",
  "diff",
  "show",
  "rev-parse",
]);

const FIND_MUTATING = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-fprint",
  "-fprintf",
]);

/**
 * @param {any} params
 */
export function permissionToolBits(params) {
  const tool = params?.toolCall || params?.tool_call || {};
  const meta = tool._meta?.["x.ai/tool"] || tool._meta?.tool || {};
  const raw = tool.rawInput ?? tool.raw_input ?? {};
  const title = String(tool.title || "");
  const kind = String(tool.kind || meta.kind || "").toLowerCase();
  const name = String(meta.name || meta.tool || raw.name || "").toLowerCase();
  const command = String(
    raw.command || raw.cmd || extractExecuteCommand(title) || "",
  ).trim();
  const blob = `${title} ${name} ${kind}`.toLowerCase();
  return { title, kind, name, command, blob, raw };
}

function extractExecuteCommand(title) {
  const t = String(title || "").trim();
  const tick = t.match(/^Execute\s+`([\s\S]+)`\s*$/i);
  if (tick?.[1]) return tick[1].trim();
  const plain = t.match(/^Execute\s+(.+)$/i);
  if (plain?.[1]) return plain[1].trim();
  return "";
}

/** Last MCP segment: desktop-preview__preview_snapshot → preview_snapshot */
function toolNameKey(raw) {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/-/g, "_");
  const i = s.lastIndexOf("__");
  return (i >= 0 ? s.slice(i + 2) : s).trim();
}

function hitsNameTable(key, exact, prefixes) {
  if (!key) return false;
  const k = key.replace(/-/g, "_");
  if (exact.has(k)) return true;
  for (const prefix of prefixes) {
    if (k === prefix || k.startsWith(`${prefix}_`)) return true;
  }
  return false;
}

/** _meta name and full title-as-name only — never first token of a sentence. */
function nameKeys(name, title) {
  const keys = [];
  if (name) keys.push(toolNameKey(name));
  if (title) keys.push(toolNameKey(title));
  return keys;
}

function nameLooksWrite(name, title) {
  for (const key of nameKeys(name, title)) {
    if (hitsNameTable(key, WRITE_NAME_EXACT, WRITE_NAME_PREFIXES)) return true;
  }
  return false;
}

function nameLooksSafe(name, title) {
  for (const key of nameKeys(name, title)) {
    if (hitsNameTable(key, SAFE_NAME_EXACT, SAFE_NAME_PREFIXES)) return true;
  }
  return false;
}

function commandLooksReadOnly(command) {
  if (!command) return false;
  // Pipes, redirects, and substitution are writes even if the first argv is cat/echo.
  if (/[|><`\n]|\$\(/.test(command)) return false;
  const parts = command.split(/\s*(?:&&|\|\||&|;)\s*/);
  if (!parts.length) return false;
  return parts.every((p) => {
    const s = p.trim();
    if (!s) return true;
    if (/^sudo\b/i.test(s)) return false;
    const tokens = s.split(/\s+/);
    const cmd = tokens[0].replace(/\\/g, "/").split("/").pop().toLowerCase();
    if (cmd === "git") {
      const sub = (tokens[1] || "").toLowerCase();
      if (sub === "stash" && (tokens[2] || "").toLowerCase() === "list") {
        return !gitHasOutputFile(tokens);
      }
      if (READ_ONLY_GIT.has(sub)) return !gitHasOutputFile(tokens);
      return false;
    }
    if (cmd === "find" || cmd === "find.exe") {
      for (const t of tokens.slice(1)) {
        const flag = t.toLowerCase().split("=")[0];
        if (FIND_MUTATING.has(flag)) return false;
      }
    }
    return READ_ONLY_CMDS.has(cmd);
  });
}

function gitHasOutputFile(tokens) {
  for (const t of tokens) {
    if (/^--output(?:=|$)/i.test(t)) return true;
  }
  return false;
}

/**
 * @param {any} params session/request_permission params
 * @returns {PermissionRisk}
 */
export function classifyPermissionRisk(params) {
  const { kind, name, command, title } = permissionToolBits(params);
  const kindKey = kind.replace(/-/g, "_");

  if (command && !commandLooksReadOnly(command)) return "write";
  if (nameLooksWrite(name, title)) return "write";

  if (kindKey && SAFE_KINDS.has(kindKey)) return "safe";
  if (kindKey === "execute" && commandLooksReadOnly(command)) return "safe";
  if (kindKey && WRITE_KINDS.has(kindKey)) return "write";

  if (nameLooksSafe(name, title)) return "safe";
  if (command && commandLooksReadOnly(command)) return "safe";

  return "write";
}

/**
 * Single permission policy. Session grant never sets allowAlwaysOk.
 *
 * @param {any} params
 * @param {{
 *   permissionMode?: string,
 *   allowWritesThisSession?: boolean,
 * }} ctx
 * @returns {{ allow: true, allowAlwaysOk: boolean } | { allow: false }}
 */
export function permissionAutoDecision(params, ctx = {}) {
  const mode = String(ctx.permissionMode || "ask");
  const { title, name } = permissionToolBits(params);
  if (/exit_plan/i.test(`${title} ${name}`)) {
    return { allow: true, allowAlwaysOk: false };
  }
  if (mode === "always-approve") {
    return { allow: true, allowAlwaysOk: true };
  }
  if (ctx.allowWritesThisSession) {
    return { allow: true, allowAlwaysOk: false };
  }
  if (mode === "auto" && classifyPermissionRisk(params) === "safe") {
    return { allow: true, allowAlwaysOk: false };
  }
  return { allow: false };
}

/**
 * @param {any} params
 * @param {{
 *   permissionMode?: string,
 *   allowWritesThisSession?: boolean,
 * }} [ctx]
 * @returns {boolean}
 */
export function shouldAutoAllowPermission(params, ctx = {}) {
  return permissionAutoDecision(params, ctx).allow === true;
}

/**
 * @param {any} params
 * @param {{ allow: true, allowAlwaysOk: boolean } | { allow: false }} decision
 * @returns {{ outcome: { outcome: 'selected', optionId: string } } | null}
 */
export function outcomeForAutoDecision(params, decision) {
  if (!decision?.allow) return null;
  return selectedPermissionResult(
    pickAllowOptionId(params?.options, {
      allowAlwaysOk: Boolean(decision.allowAlwaysOk),
    }),
  );
}
