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
  onOpenSettings,
}: {
  sandboxTerminal: boolean;
  allowOutsideProject: boolean;
  permissionMode: PermissionMode;
  onOpenSettings: () => void;
}) {
  const elevatedPerms = permissionMode !== "ask";
  const show =
    !sandboxTerminal || allowOutsideProject || elevatedPerms;
  if (!show) return null;

  return (
    <div className="elevated-chips" aria-label="Elevated safety modes">
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
