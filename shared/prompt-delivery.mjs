import {
  INTERJECT_UNSUPPORTED_REASON,
} from "./acp-interject.mjs";

/**
 * Mid-turn composer routing (busy session).
 *
 * - auto (Enter): queue follow-up until the turn ends (same as TUI).
 * - queue (Queue button): same as auto.
 * - interject (empty Enter on a queued item / Interject now): `x.ai/interject`.
 * - now (Ctrl/⌘+Enter): cancel-and-send.
 *
 * @param {"auto" | "queue" | "now" | "interject" | string} mode
 * @param {boolean} busy
 * @returns {"prompt" | "interject" | "queue" | "send-now"}
 */
export function midTurnAction(mode, busy) {
  if (!busy) return "prompt";
  if (mode === "now") return "send-now";
  if (mode === "interject") return "interject";
  if (mode === "queue") return "queue";
  return "queue";
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
