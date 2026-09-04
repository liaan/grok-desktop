/**
 * Mid-turn composer routing (busy session).
 *
 * - auto (Enter): `x.ai/interject` into the running turn (does not cancel).
 * - queue (Queue button): local follow-up, sent as session/prompt after the turn.
 * - now (Ctrl/⌘+Enter / Send now): cancel-and-send, existing session/cancel path.
 *
 * @param {"auto" | "queue" | "now" | string} mode
 * @param {boolean} busy
 * @returns {"prompt" | "interject" | "queue" | "send-now"}
 */
export function midTurnAction(mode, busy) {
  if (!busy) return "prompt";
  if (mode === "now") return "send-now";
  if (mode === "queue") return "queue";
  return "interject";
}

/**
 * True when the ACP client/CLI has no `x.ai/interject` (old grok).
 * @param {unknown} err
 */
export function isInterjectUnsupported(err) {
  if (!err) return false;
  const code = typeof err === "object" ? err.code : undefined;
  if (code === -32601 || code === "INTERJECT_UNSUPPORTED") return true;
  return /method not found|-32601|unknown method|interject is not available/i.test(
    String(typeof err === "object" && err.message ? err.message : err),
  );
}
