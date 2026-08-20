/**
 * Detect when a project folder is already open in another Grok Desktop window
 * (same git worktree / same files). Used to prompt for a sibling worktree
 * instead of two agents editing one checkout.
 */
import { getGitBranch } from "./git-info.mjs";
import {
  hasGitMarker,
  normalizeCheckoutPath,
  sameCheckoutPath,
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
 * Snapshot for the duplicate-open prompt.
 * Worktree rows come from ACP `x.ai/git/worktree/list` (opts.acpWorktrees).
 *
 * @param {string} cwd
 * @param {OpenCheckoutRow[]} openRows
 * @param {{
 *   excludeWindowId?: number | null,
 *   acpWorktrees?: Array<{
 *     path: string,
 *     label?: string | null,
 *     gitRef?: string | null,
 *     head?: string | null,
 *   }>,
 * }} [opts]
 */
export async function inspectCheckoutForUi(cwd, openRows, opts = {}) {
  const root = normalizeCheckoutPath(cwd);
  const git = Boolean(root && hasGitMarker(root));
  const occupancy = findOccupyingCheckout(
    root,
    openRows,
    opts.excludeWindowId ?? null,
  );
  const occupancyBranch = occupancy
    ? await getGitBranch(occupancy.cwd)
    : { branch: null, detached: false };

  const worktrees = (opts.acpWorktrees || []).map((t) => ({
    path: t.path,
    head: t.head || null,
    branch: t.gitRef || t.label || null,
    detached: false,
    bare: false,
    locked: false,
    open: (openRows || []).some((row) => sameCheckoutPath(row.cwd, t.path)),
    label: t.label || null,
  }));

  return {
    cwd: root,
    git,
    currentBranch: occupancyBranch.branch,
    detached: occupancyBranch.detached,
    branches: [],
    checkedOutBranches: [],
    worktrees,
    suggestedDir: null,
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
 * @param {{ acpWorktrees?: any[] }} [extra]
 */
export async function buildCheckoutConflict(
  cwd,
  openRows,
  excludeWindowId = null,
  extra = {},
) {
  const snap = await inspectCheckoutForUi(cwd, openRows, {
    excludeWindowId,
    acpWorktrees: extra.acpWorktrees,
  });
  if (!snap.occupancy) return null;
  return {
    conflict: "checkout-open",
    ...snap,
  };
}
