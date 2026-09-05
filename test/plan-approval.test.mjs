import { test } from "node:test";
import assert from "node:assert/strict";
import { planApproveCommentsText } from "../shared/plan-approval.mjs";

test("planApproveCommentsText is empty when there are no notes", () => {
  assert.equal(planApproveCommentsText(""), "");
  assert.equal(planApproveCommentsText("   "), "");
  assert.equal(planApproveCommentsText(null), "");
  assert.equal(planApproveCommentsText(undefined), "");
});

test("planApproveCommentsText matches TUI approve-w/ comments prefix", () => {
  const out = planApproveCommentsText("  use postgres  ");
  assert.equal(
    out,
    "The user approved the plan with the following review comments:\n\nuse postgres",
  );
});
