/**
 * Discover git worktree roots linked to the open project repository
 * (`git worktree list --porcelain`). Used so ACP fs/terminal path gates
 * allow sibling git worktrees without turning on “Allow outside project”.
 *
 * Grok ACP worktrees under ~/.grok/worktrees are standalone clones — they
 * do not appear here. Pairing those with the source checkout is owned by
 * desktop-worktrees.mjs (ACP list/create).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildGrokEnv } from "./grok-home.mjs";

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
export function hasGitMarker(dir) {
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

/**
 * Absolute, realpathed checkout root for comparison.
 * @param {string} p
 * @returns {string}
 */
export function normalizeCheckoutPath(p) {
  if (!p || typeof p !== "string") return "";
  let n = realpathOrSelf(p.trim());
  n = path.resolve(n);
  // Drop trailing separators except Windows drive root (`C:\`)
  if (process.platform === "win32") {
    if (/^[a-zA-Z]:\\$/.test(n)) return n;
    n = n.replace(/[\\/]+$/, "");
  } else if (n !== "/") {
    n = n.replace(/\/+$/, "");
  }
  return n;
}

/**
 * Identity key for a checkout (realpath + Windows case-fold).
 * @param {string} p
 * @returns {string}
 */
export function checkoutKey(p) {
  const n = normalizeCheckoutPath(p);
  if (!n) return "";
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/**
 * Same working tree (realpath + Windows case-fold).
 * @param {string} a
 * @param {string} b
 */
export function sameCheckoutPath(a, b) {
  const ka = checkoutKey(a);
  const kb = checkoutKey(b);
  return Boolean(ka && kb && ka === kb);
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
  const resolved = path.resolve(projectRoot);
  const key = checkoutKey(resolved) || resolved;
  const now = Date.now();
  if (!opts.refresh) {
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.roots;
  }

  if (!hasGitMarker(resolved)) {
    cache.set(key, { at: now, roots: [] });
    return [];
  }

  const result = gitSync(["-C", resolved, "worktree", "list", "--porcelain"]);

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
    const n = checkoutKey(r) || path.resolve(r);
    if (seen.has(n)) continue;
    seen.add(n);
    unique.push(path.resolve(r));
  }

  cache.set(key, { at: now, roots: unique });
  return unique;
}

/**
 * Drop cache (tests / after known worktree mutation).
 * @param {string} [projectRoot]
 */
export function clearWorktreeRootCache(projectRoot) {
  if (projectRoot) {
    const resolved = path.resolve(projectRoot);
    cache.delete(checkoutKey(resolved) || resolved);
    cache.delete(resolved);
  } else cache.clear();
}

/**
 * @param {string[]} args
 * @param {{ timeout?: number }} [opts]
 */
function gitSync(args, opts = {}) {
  try {
    return spawnSync("git", args, {
      encoding: "utf8",
      timeout: opts.timeout ?? 8_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildGrokEnv(),
    });
  } catch (err) {
    return {
      status: 1,
      stdout: "",
      stderr: err?.message || String(err),
      error: err,
    };
  }
}
