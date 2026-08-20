import { basen } from "../lib/path-utils";
import { usePrivacy } from "../lib/privacy-context";
import type { CheckoutConflict } from "../vite-env";

export type WorktreeDialogState = {
  kind: "conflict";
  conflict: CheckoutConflict;
  pendingCwd: string;
};

/**
 * Same checkout is already open — switch, reuse a Grok worktree, or create one
 * via ACP (same as TUI `/new` worktree). No git fields.
 */
export function WorktreeDialog({
  state,
  busy = false,
  error = null,
  onCancel,
  onFocusWindow,
  onOpenAnyway,
  onOpenPath,
  onCreate,
}: {
  state: WorktreeDialogState | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onFocusWindow: (windowId: number) => void;
  onOpenAnyway: (cwd: string) => void;
  onOpenPath: (cwd: string, newWindow: boolean) => void;
  onCreate: (opts: { cwd: string; newWindow: boolean }) => void;
}) {
  const { redact } = usePrivacy();
  if (!state) return null;

  const inspect = state.conflict;
  const sourceCwd = state.pendingCwd;
  const occ = inspect.occupancy;
  const unusedTrees = (inspect.worktrees || []).filter((t) => !t.open);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      data-modal-layer="overlay"
    >
      <div
        className="modal-dialog worktree-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-dialog-title"
      >
        <div className="modal-header">
          <h2 id="worktree-dialog-title">This folder is already open</h2>
          <button
            type="button"
            className="btn ghost btn-sm"
            aria-label="Cancel"
            disabled={busy}
            onClick={onCancel}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="worktree-lead">
            Another Grok window is already using{" "}
            <strong>{basen(sourceCwd)}</strong>
            {occ?.branch ? (
              <>
                {" "}
                on <code>{occ.branch}</code>
              </>
            ) : null}
            . Two windows on the same checkout share files and the same branch.
          </p>
          <p className="worktree-path" title={redact(sourceCwd)}>
            {redact(sourceCwd)}
          </p>
          <p className="muted">
            Create a Grok worktree (same as TUI <code>/new</code> with a
            worktree). Grok picks the path under <code>~/.grok/worktrees</code>
            — no branch or folder to type.
          </p>

          {unusedTrees.length > 0 ? (
            <div className="worktree-existing">
              <div className="worktree-existing-label">
                Existing Grok worktrees (not open)
              </div>
              {unusedTrees.map((t) => (
                <button
                  key={t.path}
                  type="button"
                  className="worktree-existing-btn"
                  disabled={busy}
                  onClick={() => onOpenPath(t.path, false)}
                >
                  <span className="name">
                    {t.label || basen(t.path)}
                    {t.branch ? ` · ${t.branch}` : ""}
                  </span>
                  <span className="path">{redact(t.path)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {error ? <p className="welcome-error">{error}</p> : null}
        </div>

        <div className="modal-footer plan-approval-footer">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            title="Two agents will share this working copy"
            onClick={() => onOpenAnyway(sourceCwd)}
          >
            Open anyway
          </button>
          {occ ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onFocusWindow(occ.windowId)}
            >
              Switch to open window
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => onCreate({ cwd: sourceCwd, newWindow: false })}
          >
            {busy ? "Creating…" : "Create worktree"}
          </button>
        </div>
      </div>
    </div>
  );
}
