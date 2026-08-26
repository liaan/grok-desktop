/**
 * Types for shared/permission-mode.mjs (Electron + renderer).
 */
export type DesktopPermissionMode = "ask" | "auto" | "always-approve";

export const DESKTOP_PERMISSION_MODES: DesktopPermissionMode[];

export function normalizePermissionMode(
  value: unknown,
  legacyAlwaysApprove?: boolean,
): DesktopPermissionMode;

export function toAgentPermissionMode(
  mode: DesktopPermissionMode,
): "default" | "auto" | "bypassPermissions";

export const DESKTOP_CLIENT_IDENTIFIER: "grok-desktop";

export const ACP_CLIENT_IDENTIFIER: "grok-pager";

export const YOLO_MODE_CHANGED_METHOD: "_x.ai/yolo_mode_changed";

export function initializeClientMeta(): {
  clientIdentifier: "grok-pager";
};

export function sessionPermissionMeta(mode: unknown): {
  yoloMode: boolean;
  autoMode: boolean;
  permissionMode: string;
};

export function yoloModeChangedParams(mode: unknown): {
  yolo_mode: boolean;
  auto_mode: boolean;
  permission_mode: string;
  clientIdentifier: "grok-pager";
};

export function permissionModeLabel(mode: DesktopPermissionMode): string;

export function permissionModeDescription(
  mode: DesktopPermissionMode,
): string;

export function permissionModeChipLabel(
  mode: DesktopPermissionMode,
): string;
