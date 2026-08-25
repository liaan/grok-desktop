/**
 * Duplicate-open occupancy + slim checkout inspect payload.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sameCheckoutPath } from "../electron/git-worktrees.mjs";
import {
  emptyCheckoutInspect,
  findOccupyingCheckout,
  inspectCheckoutForUi,
} from "../electron/checkout-occupancy.mjs";

test("findOccupyingCheckout skips the calling window", () => {
  const rows = [
    { windowId: 1, cwd: "/repos/app", title: "app · Grok" },
    { windowId: 2, cwd: "/repos/other", title: "other · Grok" },
  ];
  assert.equal(findOccupyingCheckout("/repos/app", rows, 1), null);
  const hit = findOccupyingCheckout("/repos/app", rows, 2);
  assert.ok(hit);
  assert.equal(hit.windowId, 1);
  assert.equal(findOccupyingCheckout("/repos/app-feat", rows, 2), null);
});

test("occupier of inspected cwd returns occupancy object", async () => {
  const cwd = "/repos/app";
  const snap = await inspectCheckoutForUi(
    cwd,
    [{ windowId: 1, cwd, title: "app · Grok" }],
    { excludeWindowId: 2 },
  );
  assert.ok(snap.occupancy);
  assert.equal(snap.occupancy.windowId, 1);
  assert.equal(snap.occupancy.title, "app · Grok");
  assert.ok(sameCheckoutPath(snap.occupancy.cwd, cwd));
  assert.equal("branch" in snap.occupancy, true);
  assert.equal("detached" in snap.occupancy, true);
  assert.equal("branches" in snap, false);
  assert.equal("suggestedDir" in snap, false);
});

test("occupier of another ACP tree is not occupancy of inspected cwd", async () => {
  const wt = "/home/u/.grok/worktrees/app/wt-1";
  const snap = await inspectCheckoutForUi(
    "/repos/app",
    [{ windowId: 3, cwd: wt, title: "wt" }],
    { acpWorktrees: [{ path: wt, label: "fix", gitRef: "feat" }] },
  );
  assert.equal(snap.occupancy, null);
  assert.equal(snap.worktrees.length, 1);
  assert.equal(snap.worktrees[0].open, true);
  assert.equal(snap.worktrees[0].label, "fix");
  assert.equal(snap.worktrees[0].branch, "feat");
  assert.equal("detached" in snap.worktrees[0], false);
  assert.equal("bare" in snap.worktrees[0], false);
  assert.equal("locked" in snap.worktrees[0], false);
});

test("emptyCheckoutInspect has occupancy + worktrees only", () => {
  const empty = emptyCheckoutInspect();
  assert.equal(empty.cwd, "");
  assert.equal(empty.git, false);
  assert.equal(empty.occupancy, null);
  assert.deepEqual(empty.worktrees, []);
  assert.equal("suggestedDir" in empty, false);
});
