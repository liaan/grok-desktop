/**
 * Project-root path checks for renderer IPC and ACP client FS/terminals.
 *
 * Containment is both lexical (path.relative) and physical (realpath) so a
 * symlink inside the project cannot point ACP fs/terminal paths outside.
 *
 * Linked git worktrees of the open project’s repository are also allowed
 * (sibling checkouts from `git worktree add`) without enabling full
 * “Allow outside project”.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listLinkedWorktreeRoots } from "./git-worktrees.mjs";

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

/**
 * Allowed roots: open project + linked git worktrees of the same repo.
 * @param {string} root
 * @returns {string[]}
 */
function allowedRoots(root) {
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
  for (const root of roots) {
    let realRoot = root;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      /* keep */
    }
    if (isUnder(root, resolved) || isUnder(realRoot, realTarget)) {
      return true;
    }
  }
  return false;
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
 * Resolve a path relative to project root. When `allowOutside` is false
 * (default), the path must stay under root or a linked git worktree.
 * @param {string} root Project / session cwd
 * @param {string} target Absolute or relative path
 * @param {{ allowOutside?: boolean }} [opts]
 * @returns {string} Absolute resolved path
 */
export function resolveProjectPath(root, target, opts = {}) {
  if (!root) throw new Error("No project open");
  if (target == null || String(target).trim() === "") {
    throw new Error("Path is required");
  }
  const allowOutside = Boolean(opts.allowOutside);
  if (!allowOutside) {
    return assertPathInProject(root, target);
  }
  const raw = expandUserPath(String(target).trim());
  return path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(path.resolve(root), raw);
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
