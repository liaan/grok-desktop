/** ACP session mode ids (`session/set_mode`). */

export const PLAN_MODE_ID = "plan";
export const DEFAULT_SESSION_MODE_ID = "default";

/** Toast when `/plan` is typed while already in plan mode (same as TUI). */
export const ALREADY_IN_PLAN_NOTICE =
  "Already in plan mode. Use /view-plan to view the current plan.";

/**
 * @param {unknown} modeId
 * @returns {boolean}
 */
export function isPlanMode(modeId) {
  return String(modeId || "").trim() === PLAN_MODE_ID;
}

/**
 * ACP `session/set_mode` params (camelCase wire names).
 * @param {string} sessionId
 * @param {string} modeId
 */
export function setSessionModeParams(sessionId, modeId) {
  return {
    sessionId: String(sessionId || ""),
    modeId: String(modeId || "").trim(),
  };
}

/**
 * Current mode from session/new|load (`modes.currentModeId`).
 * @param {any} session
 * @returns {string | null}
 */
export function rememberSessionMode(session) {
  const modes = session?.modes;
  const current =
    modes?.currentModeId ||
    modes?.current_mode_id ||
    session?.currentModeId ||
    session?.current_mode_id ||
    null;
  if (current == null || current === "") return null;
  return String(current);
}

/**
 * `current_mode_update` payload → mode id. `undefined` if this is not that
 * update kind (callers must not wipe sessionMode).
 * @param {any} params
 * @returns {string | null | undefined}
 */
export function currentModeIdFromUpdate(params) {
  const update = params?.update ?? params;
  const kind = String(update?.sessionUpdate || update?.session_update || "");
  if (kind !== "current_mode_update") return undefined;
  const modeId =
    update?.currentModeId || update?.modeId || update?.current_mode_id || null;
  return modeId ? String(modeId) : null;
}

/**
 * TUI `/plan` client action. Never send the `/plan` token as prompt text.
 *
 * @param {string} [args] remainder after `/plan`
 * @param {{ alreadyInPlan?: boolean }} [opts]
 * @returns {{
 *   type: 'already-in-plan' | 'set-mode' | 'set-mode-then-prompt',
 *   modeId?: string,
 *   text?: string,
 * }}
 */
export function planSlashAction(args, opts = {}) {
  if (opts.alreadyInPlan) {
    return { type: "already-in-plan" };
  }
  const text = String(args || "").trim();
  if (text) {
    return { type: "set-mode-then-prompt", modeId: PLAN_MODE_ID, text };
  }
  return { type: "set-mode", modeId: PLAN_MODE_ID };
}

/** Timeline text so `/plan` gets the same command chip as other slashes. */
export function planSlashDisplay(args) {
  const text = String(args || "").trim();
  return text ? `/plan ${text}` : "/plan";
}

/**
 * Numbered questionnaire (two or more "N. …?" stems on their own lines).
 * @param {unknown} text
 */
export function looksLikePlanQuestion(text) {
  const hits = String(text || "").match(/^\s*\d+[.)]\s+\S[^\n]{0,200}\?/gm);
  return Boolean(hits && hits.length >= 2);
}
