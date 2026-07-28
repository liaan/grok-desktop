/**
 * Discover git worktree roots linked to the open project repository.
 * Used so ACP fs/terminal path gates allow sibling worktrees without
 * turning on full “Allow outside project”.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** @type {Map<string, { at: number, roots: string[] }>} */
const cache = new Map();
const CACHE_TTL_MS = 15_000;

/**
 * @param {string} p
 * @returns {string}
 */
function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * True if `dir` looks like a git work tree (dir/.git file or directory).
 * @param {string} dir
 */
function hasGitMarker(dir) {
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

/**
 * Parse `git worktree list --porcelain` stdout into absolute worktree paths.
 * @param {string} text
 * @returns {string[]}
 */
export function parseWorktreePorcelain(text) {
  /** @type {string[]} */
  const roots = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    // worktree /abs/path
    if (line.startsWith("worktree ")) {
      const p = line.slice("worktree ".length).trim();
      if (p) roots.push(path.resolve(p));
    }
  }
  return roots;
}

/**
 * List absolute roots of every worktree in the same git repo as `projectRoot`
 * (including the main checkout). Empty when not a git repo or git missing.
 *
 * Cached briefly — worktree add/remove is uncommon mid-turn.
 *
 * @param {string} projectRoot
 * @param {{ refresh?: boolean }} [opts]
 * @returns {string[]}
 */
export function listLinkedWorktreeRoots(projectRoot, opts = {}) {
  if (!projectRoot || typeof projectRoot !== "string") return [];
  const key = path.resolve(projectRoot);
  const now = Date.now();
  if (!opts.refresh) {
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.roots;
  }

  if (!hasGitMarker(key)) {
    cache.set(key, { at: now, roots: [] });
    return [];
  }

  let result;
  try {
    result = spawnSync(
      "git",
      ["-C", key, "worktree", "list", "--porcelain"],
      {
        encoding: "utf8",
        timeout: 8_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    cache.set(key, { at: now, roots: [] });
    return [];
  }

  if (result.status !== 0) {
    cache.set(key, { at: now, roots: [] });
    return [];
  }

  const roots = parseWorktreePorcelain(result.stdout || "")
    .map((p) => realpathOrSelf(p))
    .filter(Boolean);

  // De-dupe while preserving order
  const seen = new Set();
  /** @type {string[]} */
  const unique = [];
  for (const r of roots) {
    const n = path.resolve(r);
    if (seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }

  cache.set(key, { at: now, roots: unique });
  return unique;
}

/**
 * Drop cache (tests / after known worktree mutation).
 * @param {string} [projectRoot]
 */
export function clearWorktreeRootCache(projectRoot) {
  if (projectRoot) cache.delete(path.resolve(projectRoot));
  else cache.clear();
}
