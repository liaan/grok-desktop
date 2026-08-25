/**
 * Project-root path checks for renderer IPC and ACP client FS/terminals.
 *
 * Containment is both lexical (path.relative) and physical (realpath) so a
 * symlink inside the project cannot point ACP fs/terminal paths outside.
 *
 * Linked git worktrees of the open project’s repository are also allowed
 * (`git worktree list --porcelain`) without enabling full “Allow outside
 * project”. Grok ACP worktree family extra roots (standalone clones under
 * ~/.grok/worktrees) apply only on the ACP `allowGrokHome` path — renderer
 * IPC stays the open project + porcelain.
 *
 * Agent tools (ACP fs/* + terminal cwd) also always allow GROK_HOME (~/.grok)
 * so skills, agents, personas, sessions, and MCP config remain readable without
 * turning on “Allow outside project” or disabling the terminal sandbox.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { grokHomeDir } from "./grok-home.mjs";
import { listLinkedWorktreeRoots } from "./git-worktrees.mjs";

/** @type {(root: string) => string[]} */
let extraAllowedRootsForRoot = (_root) => [];

/**
 * Extra allowed roots (Grok ACP worktree family). Containment helper only —
 * callers own the map.
 * @param {(root: string) => string[]} [fn]
 */
export function setExtraAllowedRootsFor(fn) {
  extraAllowedRootsForRoot = typeof fn === "function" ? fn : () => [];
}

/**
 * Expand leading `~` / `~/` to the user home (POSIX + Windows-friendly).
 * Path concern — lives here so content helpers do not own path policy.
 * @param {string} p
 * @returns {string}
 */
export function expandUserPath(p) {
  const s = String(p ?? "");
  if (s === "~") return os.homedir();
  if (s.startsWith("~/") || s.startsWith("~\\")) {
    return path.join(os.homedir(), s.slice(2));
  }
  // ~username — only expand bare ~user when it matches current user
  if (/^~[^/\\]/.test(s)) {
    const name = s.slice(1).split(/[/\\]/)[0];
    try {
      if (name && name === os.userInfo().username) {
        return path.join(
          os.homedir(),
          s.slice(1 + name.length).replace(/^[/\\]/, ""),
        );
      }
    } catch {
      /* ignore */
    }
  }
  return s;
}

/**
 * Realpath `resolved` if it exists; otherwise realpath the nearest existing
 * ancestor and rejoin the non-existing tail (for create/write targets).
 * @param {string} resolved Absolute path
 * @returns {string}
 */
function resolveRealish(resolved) {
  try {
    return fs.realpathSync(resolved);
  } catch {
    /* walk up to an existing ancestor */
  }
  /** @type {string[]} */
  const tail = [];
  let cur = resolved;
  while (true) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      return resolved;
    }
    tail.unshift(path.basename(cur));
    try {
      return path.join(fs.realpathSync(parent), ...tail);
    } catch {
      cur = parent;
    }
  }
}

/**
 * @param {string} rootAbs
 * @param {string} targetAbs
 * @returns {boolean}
 */
function isUnder(rootAbs, targetAbs) {
  const rel = path.relative(rootAbs, targetAbs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function extraFamilyRoots(root) {
  try {
    const extra = extraAllowedRootsForRoot(root);
    return Array.isArray(extra) ? extra.filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Allowed roots: open project + porcelain-linked git worktrees.
 * Pass `includeFamily` for ACP tools so Grok worktree extra roots apply.
 * @param {string} root
 * @param {{ includeFamily?: boolean }} [opts]
 * @returns {string[]}
 */
function allowedRoots(root, opts = {}) {
  const resolvedRoot = path.resolve(root);
  /** @type {string[]} */
  const roots = [resolvedRoot];
  try {
    const realMain = fs.realpathSync(resolvedRoot);
    if (realMain !== resolvedRoot) roots.push(realMain);
  } catch {
    /* keep resolved */
  }
  for (const wt of listLinkedWorktreeRoots(resolvedRoot)) {
    roots.push(wt);
  }
  if (opts.includeFamily) {
    for (const fam of extraFamilyRoots(resolvedRoot)) {
      roots.push(fam);
      for (const wt of listLinkedWorktreeRoots(fam)) {
        roots.push(wt);
      }
    }
  }
  // de-dupe
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const r of roots) {
    const n = path.resolve(r);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * @param {string[]} roots
 * @param {string} resolved lexical absolute path
 * @returns {boolean}
 */
function isUnderAnyRoot(roots, resolved) {
  const realTarget = resolveRealish(resolved);
  let lexOk = false;
  let physOk = false;
  for (const root of roots) {
    if (isUnder(root, resolved)) lexOk = true;
    let realRoot = root;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      /* keep */
    }
    if (isUnder(realRoot, realTarget)) physOk = true;
  }
  return lexOk && physOk;
}

/**
 * Absolute GROK_HOME roots (lexical + realpath when present).
 * @returns {string[]}
 */
export function grokHomeRoots() {
  const home = path.resolve(grokHomeDir());
  /** @type {string[]} */
  const roots = [home];
  try {
    const real = fs.realpathSync(home);
    if (real !== home) roots.push(real);
  } catch {
    /* may not exist yet */
  }
  return roots;
}

/**
 * True if `target` is under GROK_HOME (skills, agents, personas, sessions, …).
 * @param {string} target Absolute or relative path (relative → resolve against GROK_HOME)
 * @returns {boolean}
 */
export function isUnderGrokHome(target) {
  if (target == null || String(target).trim() === "") return false;
  try {
    const home = path.resolve(grokHomeDir());
    const resolved = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(home, target);
    return isUnderAnyRoot(grokHomeRoots(), resolved);
  } catch {
    return false;
  }
}

/**
 * Resolve `target` and ensure it is under GROK_HOME.
 * @param {string} target
 * @returns {string}
 */
export function assertPathInGrokHome(target) {
  if (target == null || String(target).trim() === "") {
    throw new Error("Path is required");
  }
  const home = path.resolve(grokHomeDir());
  const resolved = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(home, target);
  if (!isUnderAnyRoot(grokHomeRoots(), resolved)) {
    throw new Error(`Path is outside GROK_HOME (${home}): ${resolved}`);
  }
  return resolved;
}

/**
 * Resolve `target` and ensure it is under `root` (or a linked git worktree).
 * Uses lexical resolve plus realpath so symlinks cannot escape the project
 * (except into registered worktrees of the same repo).
 * @param {string} root Project / session cwd
 * @param {string} target Absolute or relative path
 * @returns {string} Absolute resolved path (lexical; safe to open/write)
 */
export function assertPathInProject(root, target) {
  if (!root) throw new Error("No project open");
  if (target == null || String(target).trim() === "") {
    throw new Error("Path is required");
  }
  const resolvedRoot = path.resolve(root);
  const expanded = expandUserPath(String(target).trim());
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(resolvedRoot, expanded);

  const roots = allowedRoots(resolvedRoot);
  if (!isUnderAnyRoot(roots, resolved)) {
    throw new Error(
      `Path is outside the open project: ${resolved} (project: ${resolvedRoot}). ` +
        `Linked git worktrees of this repo are allowed; enable “Allow outside project” for other paths.`,
    );
  }

  return resolved;
}

/**
 * Project / worktrees, or GROK_HOME (skills, agents, personas, sessions).
 * @param {string} root Project cwd
 * @param {string} target
 * @returns {string}
 */
export function assertPathInProjectOrGrokHome(root, target) {
  if (!root) throw new Error("No project open");
  if (target == null || String(target).trim() === "") {
    throw new Error("Path is required");
  }
  const resolvedRoot = path.resolve(root);
  const expanded = expandUserPath(String(target).trim());
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(resolvedRoot, expanded);

  if (isUnderAnyRoot(allowedRoots(resolvedRoot, { includeFamily: true }), resolved)) {
    return resolved;
  }
  if (isUnderAnyRoot(grokHomeRoots(), resolved)) {
    return resolved;
  }

  throw new Error(
    `Path is outside the open project and GROK_HOME: ${resolved} ` +
      `(project: ${resolvedRoot}, GROK_HOME: ${path.resolve(grokHomeDir())}). ` +
      `Skills/agents under ~/.grok and Grok worktrees of this repo are always allowed; enable “Allow outside project” for other host paths.`,
  );
}

/**
 * Resolve a path relative to project root. When `allowOutside` is false
 * (default), the path must stay under root or a linked git worktree.
 * Pass `allowGrokHome: true` for ACP agent tools so ~/.grok skills/agents work.
 * @param {string} root Project / session cwd
 * @param {string} target Absolute or relative path
 * @param {{ allowOutside?: boolean, allowGrokHome?: boolean }} [opts]
 * @returns {string} Absolute resolved path
 */
export function resolveProjectPath(root, target, opts = {}) {
  if (!root) throw new Error("No project open");
  if (target == null || String(target).trim() === "") {
    throw new Error("Path is required");
  }
  const allowOutside = Boolean(opts.allowOutside);
  if (allowOutside) {
    const raw = expandUserPath(String(target).trim());
    return path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(path.resolve(root), raw);
  }
  if (opts.allowGrokHome) {
    return assertPathInProjectOrGrokHome(root, target);
  }
  return assertPathInProject(root, target);
}

/**
 * Lexical containment only (no realpath). Useful for UI when IPC already
 * enforces the full gate, or for pure path math without disk I/O.
 * Note: does **not** expand linked worktrees (UI-only helper).
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isLexicallyInProject(root, target) {
  if (!root || target == null || String(target).trim() === "") return false;
  try {
    const resolvedRoot = path.resolve(root);
    const resolved = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(resolvedRoot, target);
    return isUnder(resolvedRoot, resolved);
  } catch {
    return false;
  }
}

/**
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isPathInProject(root, target) {
  try {
    assertPathInProject(root, target);
    return true;
  } catch {
    return false;
  }
}
