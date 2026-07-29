/**
 * Single source of truth: Desktop permission modes ↔ agent modes.
 * Used by Electron main and the React renderer (via src/lib re-export).
 *
 * Wire contract (grok-build mvp_agent + pager):
 * - session/new|load `_meta`: `yoloMode` (bool), `autoMode`/`auto_mode` (bool).
 *   Agent does **not** seed auto/yolo from `permissionMode` string alone.
 * - Live toggle: ACP `ext_notification` with method `x.ai/yolo_mode_changed`
 *   and params `{ yolo_mode, auto_mode, permission_mode }` (pager shape).
 * - `session/set_mode` is for plan/default/ask **session** modes, not tool
 *   permission yolo/auto.
 *
 * Desktop UI:
 * - Ask     → client shows every request_permission; agent not yolo/auto
 * - Auto    → agent auto-filters; client still shows escalations
 * - Always  → client auto-allows + agent yolo (`--always-approve` at spawn)
 */

/** @typedef {'ask' | 'auto' | 'always-approve'} DesktopPermissionMode */

/** @type {DesktopPermissionMode[]} */
export const DESKTOP_PERMISSION_MODES = ["ask", "auto", "always-approve"];

/** ACP extension method the agent handles for live yolo/auto (see pager). */
export const YOLO_MODE_CHANGED_METHOD = "x.ai/yolo_mode_changed";

/**
 * @param {unknown} value
 * @param {boolean} [legacyAlwaysApprove]
 * @returns {DesktopPermissionMode}
 */
export function normalizePermissionMode(value, legacyAlwaysApprove = false) {
  const v = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/_/g, "-");
  if (v === "ask" || v === "default" || v === "manual") return "ask";
  if (v === "auto") return "auto";
  if (
    v === "always-approve" ||
    v === "alwaysapprove" ||
    v === "bypasspermissions" ||
    v === "bypass-permissions" ||
    v === "yolo"
  ) {
    return "always-approve";
  }
  if (legacyAlwaysApprove) return "always-approve";
  return "ask";
}

/**
 * Hook/telemetry label (not what seeds yolo/auto on session/new).
 * @param {DesktopPermissionMode} mode
 * @returns {'default' | 'auto' | 'bypassPermissions'}
 */
export function toAgentPermissionMode(mode) {
  if (mode === "always-approve") return "bypassPermissions";
  if (mode === "auto") return "auto";
  return "default";
}

/**
 * `_meta` for session/new and session/load (grok-build resolve_session_*).
 * @param {unknown} mode
 * @returns {{ yoloMode: boolean, autoMode: boolean, permissionMode: string }}
 */
export function sessionPermissionMeta(mode) {
  const m = normalizePermissionMode(mode);
  return {
    yoloMode: m === "always-approve",
    // Agent reads autoMode / auto_mode — not permissionMode alone.
    autoMode: m === "auto",
    permissionMode: toAgentPermissionMode(m),
  };
}

/**
 * Params body for `x.ai/yolo_mode_changed` (snake_case keys as pager sends).
 * @param {unknown} mode
 * @returns {{ yolo_mode: boolean, auto_mode: boolean, permission_mode: string }}
 */
export function yoloModeChangedParams(mode) {
  const m = normalizePermissionMode(mode);
  return {
    yolo_mode: m === "always-approve",
    auto_mode: m === "auto",
    permission_mode:
      m === "always-approve"
        ? "always-approve"
        : m === "auto"
          ? "auto"
          : "ask",
  };
}

/**
 * Full JSON-RPC notification params for `ext_notification`.
 * Inner `params` must be a **JSON object** (pager: `to_raw_value` on a map).
 * A stringified body becomes a JSON string RawValue; agent `from_str` then
 * yields a String Value and never sees `yolo_mode` / `auto_mode` keys.
 * @param {unknown} mode
 * @returns {{
 *   method: string,
 *   params: { yolo_mode: boolean, auto_mode: boolean, permission_mode: string },
 * }}
 */
export function yoloModeChangedExtNotification(mode) {
  return {
    method: YOLO_MODE_CHANGED_METHOD,
    params: yoloModeChangedParams(mode),
  };
}

/**
 * @param {DesktopPermissionMode} mode
 */
export function permissionModeLabel(mode) {
  if (mode === "always-approve") return "Always approve";
  if (mode === "auto") return "Auto";
  return "Ask (manual)";
}

/**
 * @param {DesktopPermissionMode} mode
 */
export function permissionModeDescription(mode) {
  if (mode === "always-approve") {
    return "Skip tool approval prompts. Deny rules and plan-mode edit gates still apply.";
  }
  if (mode === "auto") {
    return "Agent auto-allows routine safe work; escalations still appear in Approvals.";
  }
  return "Every tool that needs permission shows in the Approvals panel (default).";
}

export function permissionModeChipLabel(mode) {
  if (mode === "always-approve") return "Always approve";
  if (mode === "auto") return "Auto";
  return "Ask";
}
