/**
 * Renderer permission-mode surface: re-export shared helpers + UI options.
 */
import {
  normalizePermissionMode as normalizeShared,
  permissionModeChipLabel as chipShared,
  permissionModeDescription as descShared,
  permissionModeLabel as labelShared,
  type DesktopPermissionMode,
} from "../../shared/permission-mode.mjs";

export type PermissionMode = DesktopPermissionMode;

export const PERMISSION_MODE_OPTIONS: Array<{
  value: PermissionMode;
  label: string;
  description: string;
}> = [
  {
    value: "ask",
    label: "Ask (manual)",
    description: descShared("ask"),
  },
  {
    value: "auto",
    label: "Auto",
    description: descShared("auto"),
  },
  {
    value: "always-approve",
    label: "Always approve",
    description: descShared("always-approve"),
  },
];

export function normalizePermissionMode(
  value: unknown,
  legacyAlwaysApprove = false,
): PermissionMode {
  return normalizeShared(value, legacyAlwaysApprove);
}

export function permissionModeChipLabel(mode: PermissionMode): string {
  return chipShared(mode);
}

export function permissionModeLabel(mode: PermissionMode): string {
  return labelShared(mode);
}

export function permissionModeDescription(mode: PermissionMode): string {
  return descShared(mode);
}
