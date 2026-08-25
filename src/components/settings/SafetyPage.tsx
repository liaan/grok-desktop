import {
  PERMISSION_MODE_OPTIONS,
  type PermissionMode,
} from "../../lib/permission-mode";

export function SafetyPage({
  permissionMode,
  sandboxTerminal,
  sandboxStatus,
  allowOutsideProject,
  onSetPermissionMode,
  onSetSandboxTerminal,
  onToggleAllowOutside,
}: {
  permissionMode: PermissionMode;
  sandboxTerminal: boolean;
  sandboxStatus: string;
  allowOutsideProject: boolean;
  onSetPermissionMode: (mode: PermissionMode) => void;
  onSetSandboxTerminal: (next: boolean) => void;
  onToggleAllowOutside: () => void;
}) {
  const modeMeta =
    PERMISSION_MODE_OPTIONS.find((o) => o.value === permissionMode) ||
    PERMISSION_MODE_OPTIONS[0];

  return (
    <section className="settings-section">
      <label className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">Tool permission mode</span>
          <span className="settings-desc">{modeMeta.description}</span>
        </div>
        <select
          className="settings-select"
          value={permissionMode}
          aria-label="Tool permission mode"
          onChange={(e) =>
            onSetPermissionMode(e.target.value as PermissionMode)
          }
        >
          {PERMISSION_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Sandbox terminal</span>
          <span className="settings-desc">
            When on (recommended), tool shells run in a project filesystem jail.
            Host secrets and the Docker daemon stay out of reach; network still
            works. Backend: {sandboxStatus || "…"}.
          </span>
        </div>
        <input
          type="checkbox"
          checked={sandboxTerminal}
          onChange={(e) => onSetSandboxTerminal(e.target.checked)}
        />
      </label>
      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Allow outside project</span>
          <span className="settings-desc">
            When off (recommended), ACP file ops and terminal cwd must stay
            inside the open project, a <strong>linked git worktree</strong> of
            this repo, or a Grok worktree of this repo (
            <code>~/.grok/worktrees</code>). File browser stays the open
            folder and linked git worktrees — not the Grok worktree family.
            Independent of terminal sandbox. Turn on only for unrelated host
            paths.
          </span>
        </div>
        <input
          type="checkbox"
          checked={allowOutsideProject}
          onChange={onToggleAllowOutside}
        />
      </label>
    </section>
  );
}
