/** Re-export shared permission mode helpers for Electron main. */
export {
  DESKTOP_PERMISSION_MODES,
  DESKTOP_CLIENT_IDENTIFIER,
  ACP_CLIENT_IDENTIFIER,
  YOLO_MODE_CHANGED_METHOD,
  initializeClientMeta,
  normalizePermissionMode,
  toAgentPermissionMode,
  sessionPermissionMeta,
  yoloModeChangedParams,
  permissionModeLabel,
  permissionModeDescription,
  permissionModeChipLabel,
} from "../shared/permission-mode.mjs";
