/** Plan-approval helpers. Approve-with-comments is interject after approved. */

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
