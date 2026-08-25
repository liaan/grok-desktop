/**
 * Multi-window occupancy + Grok ACP worktrees.
 *
 * Grok owns `~/.grok/worktrees` via ACP `create_from_worktree_sync`. Those
 * copies are standalone git checkouts — they do not appear in
 * `git worktree list`. An in-memory family map (validated ACP list/create
 * only) is passed into path-safety as extra roots on the ACP allowGrokHome
 * path. Occupancy is in-process (single-instance).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyCheckoutInspect, inspectCheckoutForUi } from "./checkout-occupancy.mjs";
import {
  checkoutKey,
  hasGitMarker,
  listLinkedWorktreeRoots,
  normalizeCheckoutPath,
  sameCheckoutPath,
} from "./git-worktrees.mjs";
import { grokHomeDir } from "./grok-home.mjs";
import { setExtraAllowedRootsFor } from "./path-safety.mjs";

export const DESKTOP_APP_USER_MODEL_ID = "com.karman.grok-desktop";

export const MARKER_MAX_BYTES = 8 * 1024;

/** @type {Map<string, Set<string>>} canonicalKey → absolute paths */
const families = new Map();
/** @type {Map<string, string>} pathKey → canonicalKey */
const alias = new Map();

function grokWorktreesDir() {
  return path.join(grokHomeDir(), "worktrees");
}

function isUnderDir(root, target) {
  const r = checkoutKey(root);
  const t = checkoutKey(target);
  if (!r || !t) return false;
  const rel = path.relative(r, t);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Drive root, $HOME or an ancestor of $HOME, GROK_HOME, or the worktrees bucket. */
export function isTooBroadRoot(p) {
  const n = normalizeCheckoutPath(p);
  if (!n) return true;
  if (path.dirname(n) === n) return true;
  const home = normalizeCheckoutPath(os.homedir());
  if (home && isUnderDir(n, home)) return true;
  const gh = normalizeCheckoutPath(grokHomeDir());
  if (gh && sameCheckoutPath(n, gh)) return true;
  const bucket = normalizeCheckoutPath(grokWorktreesDir());
  if (bucket && sameCheckoutPath(n, bucket)) return true;
  return false;
}

/**
 * Grok ACP worktrees are a new git root. Folder-trust would otherwise skip
 * project MCP/hooks until a prompt. Auto-trust those paths — the user already
 * created them from a repo they had open.
 * @param {string} [cwd]
 * @param {string} [workspace]
 */
export function shouldAutoTrustFolder(cwd, workspace) {
  return isGrokAcpWorktreePath(cwd) || isGrokAcpWorktreePath(workspace);
}

/** True after realpath if `p` is a directory inside ~/.grok/worktrees (not the bucket). */
export function isGrokAcpWorktreePath(p) {
  const n = normalizeCheckoutPath(p);
  if (!n || isTooBroadRoot(n)) return false;
  const bucket = normalizeCheckoutPath(grokWorktreesDir());
  if (!bucket || sameCheckoutPath(n, bucket) || !isUnderDir(bucket, n)) {
    return false;
  }
  try {
    return fs.statSync(n).isDirectory();
  } catch {
    return false;
  }
}

function isUsableSource(p) {
  const n = normalizeCheckoutPath(p);
  if (!n || isTooBroadRoot(n) || !hasGitMarker(n)) return false;
  try {
    return fs.statSync(n).isDirectory();
  } catch {
    return false;
  }
}

function relatedToLiveCwd(candidate, liveCwd) {
  if (sameCheckoutPath(candidate, liveCwd)) return true;
  return listLinkedWorktreeRoots(liveCwd).some((r) =>
    sameCheckoutPath(r, candidate),
  );
}

/**
 * Remember that `worktreePath` is a Grok worktree of `sourcePath`.
 * Low-level map only — ACP callers must go through registerValidatedFamily.
 * @param {string} worktreePath
 * @param {string} sourcePath
 */
export function registerWorktreeFamily(worktreePath, sourcePath) {
  const wt = normalizeCheckoutPath(worktreePath);
  const src = normalizeCheckoutPath(sourcePath);
  if (!wt || !src) return;
  const wtK = checkoutKey(wt);
  const srcK = checkoutKey(src);
  if (!wtK || !srcK) return;

  const existingWt = alias.get(wtK);
  const existingSrc = alias.get(srcK);
  const key = existingSrc || existingWt || srcK;

  let set = families.get(key);
  if (!set) {
    set = new Set();
    families.set(key, set);
  }

  const absorb = (fromKey) => {
    if (!fromKey || fromKey === key) return;
    const other = families.get(fromKey);
    if (!other) return;
    for (const p of other) {
      set.add(p);
      alias.set(checkoutKey(p), key);
    }
    families.delete(fromKey);
  };
  absorb(existingWt);
  absorb(existingSrc);

  set.add(src);
  set.add(wt);
  alias.set(srcK, key);
  alias.set(wtK, key);
}

/**
 * Pair a Grok worktree with a source only when both sides pass the allowlist
 * and at least one side is this session’s checkout.
 * @param {string} worktreePath
 * @param {string} sourcePath
 * @param {string} liveCwd
 * @returns {boolean}
 */
export function registerValidatedFamily(worktreePath, sourcePath, liveCwd) {
  if (!liveCwd || !isGrokAcpWorktreePath(worktreePath) || !isUsableSource(sourcePath)) {
    return false;
  }
  if (sameCheckoutPath(worktreePath, sourcePath)) return false;
  if (
    !relatedToLiveCwd(sourcePath, liveCwd) &&
    !relatedToLiveCwd(worktreePath, liveCwd)
  ) {
    return false;
  }
  registerWorktreeFamily(worktreePath, sourcePath);
  return true;
}

/**
 * Extra path-gate roots for `root` (source checkout + Grok worktrees).
 * @param {string} root
 * @returns {string[]}
 */
export function extraAllowedRootsFor(root) {
  const k = alias.get(checkoutKey(root));
  if (!k) return [];
  return [...(families.get(k) || [])];
}

/** Tests / process reuse. */
export function clearWorktreeFamilies() {
  families.clear();
  alias.clear();
}

/** Point path-safety at this module’s in-memory family. */
export function wireWorktreePathGate() {
  setExtraAllowedRootsFor(extraAllowedRootsFor);
}

/**
 * UX helper: source path Grok wrote on an ACP worktree. Not used for the
 * path-gate family map (agent-writable).
 * @param {string} checkout
 * @returns {string | null}
 */
export function readGrokWorktreeSource(checkout) {
  const root = normalizeCheckoutPath(checkout);
  if (!root || !isGrokAcpWorktreePath(root)) return null;
  try {
    const marker = path.join(root, ".git", "grok-worktree-source");
    const st = fs.statSync(marker);
    if (!st.isFile() || st.size <= 0 || st.size > MARKER_MAX_BYTES) return null;
    const buf = Buffer.alloc(Math.min(st.size, MARKER_MAX_BYTES));
    const fd = fs.openSync(marker, "r");
    try {
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const line = buf.slice(0, n).toString("utf8").split(/\r?\n/)[0].trim();
      if (!line || !path.isAbsolute(line)) return null;
      const src = normalizeCheckoutPath(line);
      if (!src || sameCheckoutPath(src, root) || !isUsableSource(src)) {
        return null;
      }
      return src;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Pair `created.path` with session cwd / ACP sourceGitRoot after allowlist.
 * @param {{ path?: string, sourceGitRoot?: string | null }} created
 * @param {string} [sourceCwd]
 */
export function registerCreatedWorktree(created, sourceCwd) {
  const wt = created?.path;
  if (!wt || !sourceCwd) return;
  registerValidatedFamily(wt, sourceCwd, sourceCwd);
  const gitRoot = created.sourceGitRoot
    ? String(created.sourceGitRoot).trim()
    : "";
  if (gitRoot) registerValidatedFamily(wt, gitRoot, sourceCwd);
}

function rowMatchesCheckout(row, cwd) {
  if (!row?.path || !isGrokAcpWorktreePath(row.path)) return false;
  if (sameCheckoutPath(row.path, cwd)) return true;
  if (row.sourceRepo && sameCheckoutPath(row.sourceRepo, cwd)) return true;
  return false;
}

/**
 * ACP list without registering family. Omits `repo` (Grok matches a basename
 * slug, not an absolute cwd) and filters client-side.
 * @param {{ listWorktrees?: (opts?: object) => Promise<any[]> } | null} agent
 * @param {string} cwd
 * @returns {Promise<any[]>}
 */
export async function listAcpWorktrees(agent, cwd) {
  if (!agent?.listWorktrees || !cwd) return [];
  /** @type {any[]} */
  let rows = [];
  try {
    rows = await agent.listWorktrees({ includeAll: true });
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.filter((t) => rowMatchesCheckout(t, cwd));
}

/**
 * @param {any[]} rows
 * @param {string} liveCwd
 */
export function registerAcpWorktreeRows(rows, liveCwd) {
  if (!liveCwd) return;
  for (const t of rows || []) {
    if (t?.path && t.sourceRepo) {
      registerValidatedFamily(t.path, t.sourceRepo, liveCwd);
    }
  }
}

/**
 * List + register. Use after a successful project open, not occupancy inspect.
 * @param {{ listWorktrees?: Function } | null} agent
 * @param {string} repo
 * @returns {Promise<any[]>}
 */
export async function listAndRegisterAcpWorktrees(agent, repo) {
  const rows = await listAcpWorktrees(agent, repo);
  registerAcpWorktreeRows(rows, repo);
  return rows;
}

/**
 * Live ACP agent for worktree list/create.
 * Prefer a ready agent on the target checkout, then the calling window, then any live agent.
 * @param {string} cwd
 * @param {{ agent?: { ready?: boolean, cwd?: string } | null, disposed?: boolean } | null} [prefer]
 * @param {Iterable<{ disposed?: boolean, agent?: { ready?: boolean, cwd?: string } | null }>} [sessions]
 */
export function agentForWorktreeRpc(cwd, prefer = null, sessions = []) {
  const rows = [...sessions];
  if (cwd) {
    for (const other of rows) {
      if (other.disposed || !other.agent?.ready || !other.agent.cwd) continue;
      if (sameCheckoutPath(other.agent.cwd, cwd)) return other.agent;
    }
  }
  if (prefer?.agent?.ready && prefer.agent.cwd) return prefer.agent;
  for (const other of rows) {
    if (other.disposed || !other.agent?.ready || !other.agent.cwd) continue;
    return other.agent;
  }
  return null;
}

/**
 * Occupancy inspect + ACP list. Does not mutate the family map.
 * @param {string} cwd
 * @param {{
 *   agent?: { listWorktrees?: Function } | null,
 *   openRows?: { windowId: number, cwd: string, title?: string }[],
 *   excludeWindowId?: number | null,
 *   allowSameCheckout?: boolean,
 * }} [opts]
 * @returns {Promise<{
 *   conflict: (object & { conflict: "checkout-open" }) | null,
 *   acpWorktrees: any[],
 * }>}
 */
export async function planProjectOpen(cwd, opts = {}) {
  const root = typeof cwd === "string" ? cwd.trim() : "";
  if (!root) return { conflict: null, acpWorktrees: [] };
  const acpWorktrees = await listAcpWorktrees(opts.agent || null, root);
  if (!opts.allowSameCheckout) {
    const snap = await inspectCheckoutForUi(root, opts.openRows || [], {
      excludeWindowId: opts.excludeWindowId ?? null,
      acpWorktrees,
    });
    if (snap.occupancy) {
      return {
        conflict: { conflict: "checkout-open", ...snap },
        acpWorktrees,
      };
    }
  }
  return { conflict: null, acpWorktrees };
}

/** Family map after a successful open. */
export function commitProjectOpenFamily(cwd, acpWorktrees) {
  registerAcpWorktreeRows(acpWorktrees, cwd);
}

/**
 * Re-list with the live agent after session attach (cold start has no agent
 * during occupancy/plan). Falls back to the pre-open list if the new list
 * is empty or throws. Inspect/occupancy stay registration-free.
 * @param {string} cwd
 * @param {{ listWorktrees?: Function } | null} [agent]
 * @param {any[]} [fallbackRows]
 */
export async function commitFamilyAfterOpen(cwd, agent, fallbackRows = []) {
  let rows = Array.isArray(fallbackRows) ? fallbackRows : [];
  if (agent?.listWorktrees) {
    try {
      const fresh = await listAcpWorktrees(agent, cwd);
      if (fresh.length) rows = fresh;
    } catch {
      /* keep fallback */
    }
  }
  commitProjectOpenFamily(cwd, rows);
}

/**
 * Source cwd for ACP worktree create. Occupancy-dialog Create runs on
 * Welcome or a window on another project — allow the pending folder when
 * it is this session or already open in some window.
 * @param {string | undefined} optsCwd
 * @param {string | null | undefined} sessionCwd
 * @param {{ cwd?: string }[]} [openRows]
 * @returns {string | null}
 */
export function resolveWorktreeCreateCwd(optsCwd, sessionCwd, openRows = []) {
  const requested = typeof optsCwd === "string" ? optsCwd.trim() : "";
  const session = typeof sessionCwd === "string" ? sessionCwd.trim() : "";
  if (requested) {
    if (session && sameCheckoutPath(requested, session)) return session;
    if (
      (openRows || []).some(
        (row) => row?.cwd && sameCheckoutPath(row.cwd, requested),
      )
    ) {
      return requested;
    }
    return null;
  }
  return session || null;
}

/**
 * List ACP worktrees (no family register), then inspect occupancy for the UI.
 * @param {string} cwd
 * @param {{
 *   agent?: { listWorktrees?: Function } | null,
 *   openRows?: { windowId: number, cwd: string, title?: string }[],
 *   excludeWindowId?: number | null,
 * }} [opts]
 */
export async function inspectProjectCheckout(cwd, opts = {}) {
  const root = typeof cwd === "string" ? cwd.trim() : "";
  if (!root) return emptyCheckoutInspect();
  const acpWorktrees = await listAcpWorktrees(opts.agent || null, root);
  return inspectCheckoutForUi(root, opts.openRows || [], {
    excludeWindowId: opts.excludeWindowId ?? null,
    acpWorktrees,
  });
}

/**
 * Duplicate-open payload, or null when the checkout is free.
 * Does not register family (user may cancel the dialog).
 * @param {string} cwd
 * @param {{
 *   agent?: { listWorktrees?: Function } | null,
 *   openRows?: { windowId: number, cwd: string, title?: string }[],
 *   excludeWindowId?: number | null,
 * }} [opts]
 */
export async function occupancyConflict(cwd, opts = {}) {
  const plan = await planProjectOpen(cwd, { ...opts, allowSameCheckout: false });
  return plan.conflict;
}

/**
 * ACP create (Grok picks `~/.grok/worktrees/…`).
 * @param {{ createWorktreeFromCurrent?: Function } | null} agent
 * @param {{ sourceCwd: string, label?: string }} opts
 */
export async function createAcpWorktree(agent, opts) {
  if (!agent?.createWorktreeFromCurrent) {
    throw new Error(
      "Need a live Grok session to create a worktree (same as TUI /new).",
    );
  }
  const sourceCwd = String(opts?.sourceCwd || "").trim();
  if (!sourceCwd) {
    throw new Error("Open a project first — worktrees need a live Grok session.");
  }
  const created = await agent.createWorktreeFromCurrent({
    sourceCwd,
    label: opts.label,
  });
  const wt = created?.path;
  if (!wt || !isGrokAcpWorktreePath(wt)) {
    throw new Error(
      "Worktree create returned a path outside ~/.grok/worktrees.",
    );
  }
  registerCreatedWorktree(created, sourceCwd);
  return created;
}

/**
 * Windows Start Menu / jump lists need a stable AUMID for second-instance.
 * @param {{ setAppUserModelId?: (id: string) => void }} app
 */
export function configureDesktopInstance(app) {
  if (process.platform === "win32") {
    app.setAppUserModelId?.(DESKTOP_APP_USER_MODEL_ID);
  }
}

/**
 * One process, many windows. `GROK_DESKTOP_MULTI_INSTANCE=1` skips the lock.
 * @param {{ requestSingleInstanceLock?: () => boolean }} app
 */
export function isPrimaryDesktopInstance(app) {
  return (
    process.env.GROK_DESKTOP_MULTI_INSTANCE === "1" ||
    Boolean(app.requestSingleInstanceLock?.())
  );
}

/**
 * Second Start Menu launch → new window on the existing process.
 * Queues until `whenReady` so a launch during splash is not dropped.
 * @param {{
 *   on: (ev: string, fn: (...args: any[]) => void) => void,
 *   isReady?: () => boolean,
 *   whenReady?: () => Promise<unknown>,
 * }} app
 * @param {() => void} onSecondInstance
 */
export function wireSecondInstance(app, onSecondInstance) {
  let pending = 0;
  const flush = () => {
    const n = pending;
    pending = 0;
    for (let i = 0; i < n; i++) onSecondInstance();
  };
  app.on("second-instance", () => {
    const ready = typeof app.isReady === "function" ? app.isReady() : true;
    if (!ready) {
      pending += 1;
      return;
    }
    onSecondInstance();
  });
  if (typeof app.whenReady === "function") {
    Promise.resolve(app.whenReady()).then(flush).catch(() => {});
  }
}
