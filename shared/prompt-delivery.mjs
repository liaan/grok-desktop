import {
  INTERJECT_UNSUPPORTED_REASON,
} from "./acp-interject.mjs";

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
 * True when this Grok CLI has no `x.ai/interject`.
 * Generic JSON-RPC method-missing must not enqueue.
 * @param {unknown} err
 */
export function isInterjectUnsupported(err) {
  if (!err || typeof err !== "object") return false;
  return (
    err.ok === false && err.reason === INTERJECT_UNSUPPORTED_REASON
  );
}

/**
 * Renderer follow-up after `agent:interject`. Throws are real failures —
 * leftover unsupported Errors are mapped to JSON in main before this runs.
 * @param {unknown} result
 * @param {unknown} [thrown]
 * @returns {"ok" | "queue" | "error"}
 */
export function interjectRpcFollowUp(result, thrown) {
  if (thrown) return "error";
  if (isInterjectUnsupported(result)) return "queue";
  if (result && typeof result === "object" && result.ok === false) {
    return "error";
  }
  return "ok";
}
