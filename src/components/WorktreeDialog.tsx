import { basen } from "../lib/path-utils";
import { usePrivacy } from "../lib/privacy-context";
import { useI18n } from "../lib/i18n";
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
  const { t } = useI18n();
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
          <h2 id="worktree-dialog-title">{t("worktree.already")}</h2>
          <button
            type="button"
            className="btn ghost btn-sm"
            aria-label={t("worktree.cancel")}
            disabled={busy}
            onClick={onCancel}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="worktree-lead">
            {t(occ?.branch ? "worktree.leadBranch" : "worktree.lead", {
              folder: basen(sourceCwd),
              branch: occ?.branch || "",
            })}
          </p>
          <p className="worktree-path" title={redact(sourceCwd)}>
            {redact(sourceCwd)}
          </p>
          <p className="muted">
            {t("worktree.desc")}
          </p>

          {unusedTrees.length > 0 ? (
            <div className="worktree-existing">
              <div className="worktree-existing-label">
                {t("worktree.existing")}
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
            {t("worktree.cancel")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            title={t("worktree.shareTitle")}
            onClick={() => onOpenAnyway(sourceCwd)}
          >
            {t("worktree.openAnyway")}
          </button>
          {occ ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onFocusWindow(occ.windowId)}
            >
              {t("worktree.switch")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => onCreate({ cwd: sourceCwd, newWindow: false })}
          >
            {busy ? t("worktree.creating") : t("worktree.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
