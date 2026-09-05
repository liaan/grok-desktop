/**
 * Plan-approval helpers shared by the renderer and tests.
 *
 * grok-build `ExitPlanModeExtResponse.feedback` is only consumed on
 * `cancelled` (request changes). Approve-with-comments is a separate
 * `x.ai/interject` after `{ outcome: "approved" }` — same as the TUI.
 */

/**
 * @param {unknown} feedback
 * @returns {string} empty when there is nothing to send
 */
export function planApproveCommentsText(feedback) {
  const text = String(feedback || "").trim();
  if (!text) return "";
  return (
    "The user approved the plan with the following review comments:\n\n" + text
  );
}
