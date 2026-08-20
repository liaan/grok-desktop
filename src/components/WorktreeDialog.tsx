import { useEffect, useMemo, useState } from "react";
import { basen } from "../lib/path-utils";
import { usePrivacy } from "../lib/privacy-context";
import type { CheckoutConflict, CheckoutInspect } from "../vite-env";

export type WorktreeDialogState =
  | {
      kind: "conflict";
      conflict: CheckoutConflict;
      pendingCwd: string;
    }
  | {
      kind: "create";
      sourceCwd: string;
      inspect: CheckoutInspect;
      openInNewWindow: boolean;
    };

/**
 * Duplicate-checkout prompt + create-worktree form.
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
  onCreate: (opts: {
    cwd: string;
    branch: string;
    dir: string;
    newWindow: boolean;
  }) => void;
}) {
  const { redact } = usePrivacy();
  const [step, setStep] = useState<"choose" | "create">("choose");
  const [branch, setBranch] = useState("");
  const [dir, setDir] = useState("");
  const [dirTouched, setDirTouched] = useState(false);

  const inspect: CheckoutInspect | null = state
    ? state.kind === "conflict"
      ? state.conflict
      : state.inspect
    : null;
  const sourceCwd =
    state?.kind === "conflict" ? state.pendingCwd : state?.sourceCwd || "";
  const defaultNewWindow =
    state?.kind === "create" ? state.openInNewWindow : false;

  useEffect(() => {
    if (!state) return;
    setStep(state.kind === "create" ? "create" : "choose");
    setBranch("");
    setDir(inspect?.suggestedDir || "");
    setDirTouched(false);
  }, [state, inspect?.suggestedDir]);

  useEffect(() => {
    if (!state || step !== "create" || dirTouched || !sourceCwd) return;
    const name = branch.trim();
    if (!name) {
      setDir(inspect?.suggestedDir || "");
      return;
    }
    let cancelled = false;
    void window.grokDesktop
      .suggestWorktreeDir({ cwd: sourceCwd, branch: name })
      .then((res) => {
        if (!cancelled && res.dir) setDir(res.dir);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [branch, dirTouched, inspect?.suggestedDir, sourceCwd, state, step]);

  const unusedTrees = useMemo(
    () => (inspect?.worktrees || []).filter((t) => !t.open),
    [inspect],
  );

  if (!state || !inspect) return null;

  const occ = inspect.occupancy;
  const git = inspect.git;
  const checkedOut = new Set(inspect.checkedOutBranches || []);
  const exists = (inspect.branches || []).includes(branch.trim());
  const alreadyOut = checkedOut.has(branch.trim());
  const branchHint = !branch.trim()
    ? null
    : alreadyOut
      ? `Already checked out in another worktree — pick a new name.`
      : exists
        ? `This branch exists — a worktree will attach to it.`
        : `New branch from ${inspect.currentBranch || "HEAD"}.`;

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
          <h2 id="worktree-dialog-title">
            {step === "create"
              ? "Create git worktree"
              : "This folder is already open"}
          </h2>
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
          {step === "choose" ? (
            <>
              <p className="worktree-lead">
                Another Grok window is already using{" "}
                <strong>{basen(sourceCwd)}</strong>
                {occ?.branch ? (
                  <>
                    {" "}
                    on <code>{occ.branch}</code>
                  </>
                ) : null}
                . Two windows on the same checkout share files and the same
                branch — easy to edit the wrong task.
              </p>
              <p className="worktree-path" title={redact(sourceCwd)}>
                {redact(sourceCwd)}
              </p>
              {git ? (
                <p className="muted">
                  Create a git worktree (or open an existing one) so each window
                  has its own branch and working copy.
                </p>
              ) : (
                <p className="muted">
                  This folder is not a git repo, so a worktree cannot be
                  created. Switch to the other window, or open this folder
                  anyway.
                </p>
              )}

              {unusedTrees.length > 0 ? (
                <div className="worktree-existing">
                  <div className="worktree-existing-label">
                    Existing worktrees (not open)
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
                        {basen(t.path)}
                        {t.branch ? ` · ${t.branch}` : t.detached ? " · detached" : ""}
                      </span>
                      <span className="path">{redact(t.path)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="worktree-lead">
                New checkout next to the repo. Name a branch for this window’s
                work.
              </p>
              <label className="mcp-field">
                <span className="mcp-field-label">Branch</span>
                <input
                  className="settings-input"
                  value={branch}
                  disabled={busy}
                  autoFocus
                  placeholder="feat/my-task"
                  onChange={(e) => setBranch(e.target.value)}
                />
              </label>
              {branchHint ? (
                <p className={`worktree-hint ${alreadyOut ? "warn" : ""}`}>
                  {branchHint}
                </p>
              ) : null}
              <label className="mcp-field">
                <span className="mcp-field-label">Folder</span>
                <input
                  className="settings-input"
                  value={dir}
                  disabled={busy}
                  onChange={(e) => {
                    setDirTouched(true);
                    setDir(e.target.value);
                  }}
                />
              </label>
            </>
          )}

          {error ? <p className="welcome-error">{error}</p> : null}
        </div>

        <div className="modal-footer plan-approval-footer">
          {step === "choose" ? (
            <>
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
              {git ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => setStep("create")}
                >
                  Create worktree…
                </button>
              ) : null}
            </>
          ) : (
            <>
              {state.kind === "conflict" ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setStep("choose")}
                >
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={onCancel}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="btn primary"
                disabled={
                  busy || !branch.trim() || !dir.trim() || alreadyOut
                }
                onClick={() =>
                  onCreate({
                    cwd: sourceCwd,
                    branch: branch.trim(),
                    dir: dir.trim(),
                    newWindow: defaultNewWindow,
                  })
                }
              >
                {busy
                  ? "Creating…"
                  : defaultNewWindow
                    ? "Create and open window"
                    : "Create and open"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
