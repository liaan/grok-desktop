/**
 * Project-root path checks for renderer IPC and ACP client FS/terminals.
 *
 * Containment is both lexical (path.relative) and physical (realpath) so a
 * symlink inside the project cannot point ACP fs/terminal paths outside.
 */
import fs from "node:fs";
import path from "node:path";

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
 * Resolve `target` and ensure it is under `root` (or equal to root).
 * Uses lexical resolve plus realpath so symlinks cannot escape the project.
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
  const resolved = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(resolvedRoot, target);

  if (!isUnder(resolvedRoot, resolved)) {
    throw new Error(
      `Path is outside the open project: ${resolved} (project: ${resolvedRoot})`,
    );
  }

  let realRoot = resolvedRoot;
  try {
    realRoot = fs.realpathSync(resolvedRoot);
  } catch {
    /* project should exist; keep resolved root */
  }
  const realTarget = resolveRealish(resolved);
  if (!isUnder(realRoot, realTarget)) {
    throw new Error(
      `Path is outside the open project: ${resolved} → ${realTarget} (project: ${realRoot})`,
    );
  }

  return resolved;
}

/**
 * Resolve a path relative to project root. When `allowOutside` is false
 * (default), the path must stay under root (lexical + realpath).
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
  const raw = String(target);
  return path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(path.resolve(root), raw);
}

/**
 * Lexical containment only (no realpath). Useful for UI when IPC already
 * enforces the full gate, or for pure path math without disk I/O.
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
