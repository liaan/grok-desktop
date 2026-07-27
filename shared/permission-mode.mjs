/**
 * Single source of truth: Desktop permission modes ↔ agent modes.
 * Used by Electron main and the React renderer (via src/lib re-export).
 *
 * Ask     → agent `default`  — client shows every session/request_permission
 * Auto    → agent `auto`     — agent filters routine work; client still shows asks
 * Always  → agent `bypassPermissions` + yoloMode — client auto-allows
 */

/** @typedef {'ask' | 'auto' | 'always-approve'} DesktopPermissionMode */

/** @type {DesktopPermissionMode[]} */
export const DESKTOP_PERMISSION_MODES = ["ask", "auto", "always-approve"];

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
 * Value for agent `_meta.permissionMode` / session/set_mode modeId.
 * @param {DesktopPermissionMode} mode
 * @returns {'default' | 'auto' | 'bypassPermissions'}
 */
export function toAgentPermissionMode(mode) {
  if (mode === "always-approve") return "bypassPermissions";
  if (mode === "auto") return "auto";
  return "default";
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
