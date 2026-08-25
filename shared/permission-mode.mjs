/**
 * Desktop permission modes ↔ agent yolo/auto.
 * session/new|load `_meta` seeds `yoloMode` / `autoMode` (not the mode string).
 * Live toggle: notify `_x.ai/yolo_mode_changed` with those params.
 */

/** @typedef {'ask' | 'auto' | 'always-approve'} DesktopPermissionMode */

/** @type {DesktopPermissionMode[]} */
export const DESKTOP_PERMISSION_MODES = ["ask", "auto", "always-approve"];

/** Product token the agent maps to ClientType::Desktop. */
export const DESKTOP_CLIENT_IDENTIFIER = "grok-desktop";

/** Underscore prefix so AgentSide routes this as an extension notification. */
export const YOLO_MODE_CHANGED_METHOD = "_x.ai/yolo_mode_changed";

/**
 * `initialize` `_meta` so permission prompts include Desktop options
 * (`enable-always-approve`) and yolo updates match this client's sessions.
 */
export function initializeClientMeta() {
  return { clientIdentifier: DESKTOP_CLIENT_IDENTIFIER };
}

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
 * Params body for `_x.ai/yolo_mode_changed` (snake_case keys as pager sends).
 * `clientIdentifier` scopes the update to Desktop-owned sessions.
 * Must be a **JSON object** (pager: `to_raw_value` on a map) — a stringified
 * body becomes a JSON string RawValue and agent `from_str` never sees keys.
 * @param {unknown} mode
 * @returns {{
 *   yolo_mode: boolean,
 *   auto_mode: boolean,
 *   permission_mode: string,
 *   clientIdentifier: string,
 * }}
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
    clientIdentifier: DESKTOP_CLIENT_IDENTIFIER,
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
    return "Reads and browsing are allowed automatically. Edits, posts, and changing shells still need approval — use Allow writes this session to skip the rest of this chat.";
  }
  return "Every tool that needs permission shows in the Approvals panel (default).";
}

export function permissionModeChipLabel(mode) {
  if (mode === "always-approve") return "Always approve";
  if (mode === "auto") return "Auto";
  return "Ask";
}
