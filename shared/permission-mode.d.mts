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

export const YOLO_MODE_CHANGED_METHOD: "x.ai/yolo_mode_changed";

export function sessionPermissionMeta(mode: unknown): {
  yoloMode: boolean;
  autoMode: boolean;
  permissionMode: string;
};

export function yoloModeChangedParams(mode: unknown): {
  yolo_mode: boolean;
  auto_mode: boolean;
  permission_mode: string;
};

export function yoloModeChangedExtNotification(mode: unknown): {
  method: string;
  params: {
    yolo_mode: boolean;
    auto_mode: boolean;
    permission_mode: string;
  };
};

export function permissionModeLabel(mode: DesktopPermissionMode): string;

export function permissionModeDescription(
  mode: DesktopPermissionMode,
): string;

export function permissionModeChipLabel(
  mode: DesktopPermissionMode,
): string;
