/** Re-export shared permission mode helpers for Electron main. */
export {
  DESKTOP_PERMISSION_MODES,
  YOLO_MODE_CHANGED_METHOD,
  normalizePermissionMode,
  toAgentPermissionMode,
  sessionPermissionMeta,
  yoloModeChangedParams,
  yoloModeChangedExtNotification,
  permissionModeLabel,
  permissionModeDescription,
  permissionModeChipLabel,
} from "../shared/permission-mode.mjs";
