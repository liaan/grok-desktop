import {
  permissionModeChipLabel,
  type PermissionMode,
} from "../lib/permission-mode";

/**
 * Persistent topbar indicators when elevated / reduced-safety modes are on.
 * Click opens Settings so the operator can turn them off.
 */
export function ElevatedSafetyChips({
  sandboxTerminal,
  allowOutsideProject,
  permissionMode,
  privacyMode = false,
  onOpenSettings,
}: {
  sandboxTerminal: boolean;
  allowOutsideProject: boolean;
  permissionMode: PermissionMode;
  privacyMode?: boolean;
  onOpenSettings: () => void;
}) {
  const elevatedPerms = permissionMode !== "ask";
  const show =
    !sandboxTerminal || allowOutsideProject || elevatedPerms || privacyMode;
  if (!show) return null;

  return (
    <div className="elevated-chips" aria-label="Elevated safety modes">
      {privacyMode && (
        <button
          type="button"
          className="elevated-chip privacy"
          title="Privacy mode — home paths hidden in the UI. Click to open Settings."
          onClick={onOpenSettings}
        >
          Privacy
        </button>
      )}
      {!sandboxTerminal && (
        <button
          type="button"
          className="elevated-chip warn"
          title="Tool shells use the full host — click to open Settings"
          onClick={onOpenSettings}
        >
          Host shell
        </button>
      )}
      {allowOutsideProject && (
        <button
          type="button"
          className="elevated-chip warn"
          title="ACP may leave the project root — click to open Settings"
          onClick={onOpenSettings}
        >
          Outside project
        </button>
      )}
      {elevatedPerms && (
        <button
          type="button"
          className={`elevated-chip ${permissionMode === "always-approve" ? "warn" : ""}`}
          title="Tool permission mode — click to open Settings"
          onClick={onOpenSettings}
        >
          {permissionModeChipLabel(permissionMode)}
        </button>
      )}
    </div>
  );
}
