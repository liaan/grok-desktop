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
 * Same working tree (realpath + Windows case-fold).
 * @param {string} a
 * @param {string} b
 */
export function sameCheckoutPath(a, b) {
  const na = normalizeCheckoutPath(a);
  const nb = normalizeCheckoutPath(b);
  if (!na || !nb) return false;
  if (process.platform === "win32") {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
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

/**
 * @typedef {{
 *   path: string,
 *   head: string | null,
 *   branch: string | null,
 *   detached: boolean,
 *   bare: boolean,
 *   locked: boolean,
 * }} WorktreeEntry
 */

/**
 * Parse `git worktree list --porcelain` into entries (path, HEAD, branch).
 * @param {string} text
 * @returns {WorktreeEntry[]}
 */
export function parseWorktreePorcelainEntries(text) {
  /** @type {WorktreeEntry[]} */
  const entries = [];
  /** @type {WorktreeEntry | null} */
  let cur = null;
  const flush = () => {
    if (cur?.path) entries.push(cur);
    cur = null;
  };
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      flush();
      const p = line.slice("worktree ".length).trim();
      cur = {
        path: p ? path.resolve(p) : "",
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
      };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length).trim() || null;
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length).trim();
      cur.branch = ref.replace(/^refs\/heads\//, "") || null;
    } else if (line === "detached") {
      cur.detached = true;
    } else if (line === "bare") {
      cur.bare = true;
    } else if (line.startsWith("locked")) {
      cur.locked = true;
    } else if (line === "") {
      flush();
    }
  }
  flush();
  return entries;
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

/**
 * Full worktree list for the repo at `projectRoot` (including the main
 * checkout). Empty when not a git repo or git missing.
 * @param {string} projectRoot
 * @returns {WorktreeEntry[]}
 */
export function listLinkedWorktrees(projectRoot) {
  if (!projectRoot || typeof projectRoot !== "string") return [];
  const key = path.resolve(projectRoot);
  if (!hasGitMarker(key)) return [];

  const result = gitSync(["-C", key, "worktree", "list", "--porcelain"]);
  if (result.status !== 0) return [];

  /** @type {WorktreeEntry[]} */
  const unique = [];
  for (const entry of parseWorktreePorcelainEntries(result.stdout || "")) {
    const n = normalizeCheckoutPath(entry.path);
    if (!n) continue;
    if (unique.some((e) => sameCheckoutPath(e.path, n))) continue;
    unique.push({ ...entry, path: n });
  }
  return unique;
}

/**
 * Folder-name fragment from a branch (`feat/foo` → `feat-foo`).
 * @param {string} branch
 */
export function slugifyBranchForDir(branch) {
  const s = String(branch || "")
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return s.slice(0, 60) || "work";
}

/**
 * Sibling directory next to the main worktree: `{repo}-{branch-slug}`.
 * Skips paths that already exist or are listed in `existingPaths`.
 * @param {string} mainRoot
 * @param {string} branchName
 * @param {string[]} [existingPaths]
 */
export function suggestWorktreeDir(mainRoot, branchName, existingPaths = []) {
  const root = path.resolve(mainRoot);
  const parent = path.dirname(root);
  const base = path.basename(root);
  const slug = slugifyBranchForDir(branchName);
  const taken = (p) => {
    try {
      if (fs.existsSync(p)) return true;
    } catch {
      /* ignore */
    }
    return existingPaths.some((e) => sameCheckoutPath(e, p));
  };
  let dir = path.join(parent, `${base}-${slug}`);
  let n = 2;
  while (taken(dir)) {
    dir = path.join(parent, `${base}-${slug}-${n}`);
    n += 1;
    if (n > 99) break;
  }
  return dir;
}

/**
 * Local branch short names (`git for-each-ref refs/heads`).
 * @param {string} cwd
 * @returns {string[]}
 */
export function listLocalBranchNames(cwd) {
  if (!cwd || typeof cwd !== "string" || !hasGitMarker(cwd)) return [];
  const result = gitSync([
    "-C",
    path.resolve(cwd),
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  if (result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} cwd
 * @param {string} branch
 * @returns {string | null} git error or null if ok
 */
export function checkBranchName(cwd, branch) {
  const name = String(branch || "").trim();
  if (!name) return "Branch name is required.";
  const result = gitSync(
    ["-C", path.resolve(cwd), "check-ref-format", "--branch", name],
    { timeout: 4_000 },
  );
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || "").trim();
    return err || `Invalid branch name: ${name}`;
  }
  return null;
}

/**
 * Create a linked worktree. New branch (`-b`) when `branch` does not exist;
 * otherwise attach to that existing branch (git refuses if it is already
 * checked out in another worktree).
 *
 * @param {string} cwd  any worktree of the repo
 * @param {{ dir: string, branch: string, startPoint?: string }} opts
 * @returns {{ path: string, branch: string, createdBranch: boolean }}
 */
export function addGitWorktree(cwd, opts) {
  const root = path.resolve(cwd);
  const branch = String(opts?.branch || "").trim();
  const dir = path.resolve(String(opts?.dir || "").trim());
  if (!hasGitMarker(root)) {
    throw new Error("Not a git repository — cannot create a worktree.");
  }
  const invalid = checkBranchName(root, branch);
  if (invalid) throw new Error(invalid);
  if (!dir) throw new Error("Worktree folder is required.");
  if (fs.existsSync(dir)) {
    throw new Error(`Worktree folder already exists: ${dir}`);
  }

  const existing = listLocalBranchNames(root);
  const branchExists = existing.includes(branch);
  const trees = listLinkedWorktrees(root);
  const checkedOut = trees.find((t) => t.branch === branch && !t.detached);
  if (branchExists && checkedOut) {
    throw new Error(
      `Branch ${branch} is already checked out at ${checkedOut.path}. Pick a new branch name.`,
    );
  }

  /** @type {string[]} */
  const args = ["-C", root, "worktree", "add"];
  if (!branchExists) {
    args.push("-b", branch, dir);
    const start = String(opts?.startPoint || "").trim();
    if (start) args.push(start);
  } else {
    args.push(dir, branch);
  }

  const result = gitSync(args, { timeout: 60_000 });
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || "").trim();
    throw new Error(err || "git worktree add failed");
  }

  clearWorktreeRootCache();
  return {
    path: normalizeCheckoutPath(dir),
    branch,
    createdBranch: !branchExists,
  };
}
