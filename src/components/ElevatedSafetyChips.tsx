/**
 * Persistent topbar indicators when elevated / reduced-safety modes are on.
 * Click opens Settings so the operator can turn them off.
 */
export function ElevatedSafetyChips({
  sandboxTerminal,
  allowOutsideProject,
  alwaysApprove,
  onOpenSettings,
}: {
  sandboxTerminal: boolean;
  allowOutsideProject: boolean;
  alwaysApprove: boolean;
  onOpenSettings: () => void;
}) {
  const show =
    !sandboxTerminal || allowOutsideProject || alwaysApprove;
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
      {alwaysApprove && (
        <button
          type="button"
          className="elevated-chip"
          title="Tool permissions auto-approved — click to open Settings"
          onClick={onOpenSettings}
        >
          Auto-approve
        </button>
      )}
    </div>
  );
}
