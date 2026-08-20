/**
 * Detect when a project folder is already open in another Grok Desktop window
 * (same git worktree / same files). Used to prompt for a sibling worktree
 * instead of two agents editing one checkout.
 */
import { getGitBranch } from "./git-info.mjs";
import {
  hasGitMarker,
  listLinkedWorktrees,
  listLocalBranchNames,
  normalizeCheckoutPath,
  sameCheckoutPath,
  suggestWorktreeDir,
} from "./git-worktrees.mjs";

/**
 * @typedef {{ windowId: number, cwd: string, title?: string }} OpenCheckoutRow
 */

/**
 * @param {string} cwd
 * @param {OpenCheckoutRow[]} openRows
 * @param {number | null} [excludeWindowId]
 * @returns {OpenCheckoutRow | null}
 */
export function findOccupyingCheckout(cwd, openRows, excludeWindowId = null) {
  const target = normalizeCheckoutPath(cwd);
  if (!target) return null;
  for (const row of openRows || []) {
    if (excludeWindowId != null && row.windowId === excludeWindowId) continue;
    if (!row?.cwd) continue;
    if (sameCheckoutPath(row.cwd, target)) {
      return {
        windowId: row.windowId,
        cwd: normalizeCheckoutPath(row.cwd),
        title: row.title || "",
      };
    }
  }
  return null;
}

/**
 * Snapshot for the duplicate-open prompt (or New Worktree form).
 *
 * @param {string} cwd
 * @param {OpenCheckoutRow[]} openRows
 * @param {{ excludeWindowId?: number | null }} [opts]
 */
export async function inspectCheckoutForUi(cwd, openRows, opts = {}) {
  const root = normalizeCheckoutPath(cwd);
  const git = Boolean(root && hasGitMarker(root));
  const trees = git ? listLinkedWorktrees(root) : [];
  const branches = git ? listLocalBranchNames(root) : [];
  const branchInfo = git
    ? await getGitBranch(root)
    : { branch: null, detached: false };
  const checkedOut = new Set(
    trees.map((t) => t.branch).filter(Boolean),
  );
  const occupancy = findOccupyingCheckout(
    root,
    openRows,
    opts.excludeWindowId ?? null,
  );
  const occupancyBranch = occupancy
    ? await getGitBranch(occupancy.cwd)
    : { branch: null, detached: false };

  const worktrees = trees.map((t) => ({
    path: t.path,
    head: t.head,
    branch: t.branch,
    detached: t.detached,
    bare: t.bare,
    locked: t.locked,
    open: (openRows || []).some((row) => sameCheckoutPath(row.cwd, t.path)),
  }));

  const mainRoot = trees[0]?.path || root;
  const suggestedDir = git
    ? suggestWorktreeDir(
        mainRoot,
        "wip",
        trees.map((t) => t.path),
      )
    : null;

  return {
    cwd: root,
    git,
    currentBranch: branchInfo.branch,
    detached: branchInfo.detached,
    branches,
    checkedOutBranches: [...checkedOut],
    worktrees,
    suggestedDir,
    occupancy: occupancy
      ? {
          windowId: occupancy.windowId,
          cwd: occupancy.cwd,
          title: occupancy.title || "",
          branch: occupancyBranch.branch,
          detached: occupancyBranch.detached,
        }
      : null,
  };
}

/**
 * @param {string} cwd
 * @param {OpenCheckoutRow[]} openRows
 * @param {number | null} [excludeWindowId]
 */
export async function buildCheckoutConflict(cwd, openRows, excludeWindowId = null) {
  const snap = await inspectCheckoutForUi(cwd, openRows, { excludeWindowId });
  if (!snap.occupancy) return null;
  return {
    conflict: "checkout-open",
    ...snap,
  };
}
