/**
 * Sidebar safety toggles: always-approve tools + project-root gate.
 * Kept out of App.tsx so settings surface area does not keep growing there.
 */

export function SidebarSafety({
  alwaysApprove,
  allowOutsideProject,
  onToggleAlwaysApprove,
  onToggleAllowOutside,
}: {
  alwaysApprove: boolean;
  allowOutsideProject: boolean;
  onToggleAlwaysApprove: () => void;
  onToggleAllowOutside: () => void;
}) {
  return (
    <>
      <label className="row" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={alwaysApprove}
          onChange={onToggleAlwaysApprove}
        />
        Always approve tools
      </label>
      <label
        className="row"
        style={{ cursor: "pointer", alignItems: "flex-start" }}
        title="When off (default), ACP file ops and terminal cwd must stay inside the open project folder. Renderer file browse stays project-scoped either way."
      >
        <input
          type="checkbox"
          checked={allowOutsideProject}
          onChange={onToggleAllowOutside}
          style={{ marginTop: 2 }}
        />
        <span>
          Allow outside project
          <span
            className="sidebar-hint"
            style={{ display: "block", padding: 0, marginTop: 2 }}
          >
            Off = safer (project root only)
          </span>
        </span>
      </label>
    </>
  );
}
