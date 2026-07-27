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

export function permissionModeLabel(mode: DesktopPermissionMode): string;

export function permissionModeDescription(
  mode: DesktopPermissionMode,
): string;

export function permissionModeChipLabel(
  mode: DesktopPermissionMode,
): string;
