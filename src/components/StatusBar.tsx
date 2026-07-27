/**
 * Bottom status strip for the main column — privacy indicator + git branch.
 */
export function StatusBar({
  privacyMode,
  onOpenSettings,
  gitBranch,
  gitDetached,
}: {
  privacyMode: boolean;
  onOpenSettings: () => void;
  gitBranch: string | null;
  gitDetached: boolean;
}) {
  return (
    <footer className="status-bar" role="status" aria-label="Project status">
      <div className="status-bar-left">
        {privacyMode ? (
          <button
            type="button"
            className="status-bar-chip privacy"
            title="Privacy mode is on — home paths are hidden in the UI. Click to open Settings."
            onClick={onOpenSettings}
          >
            Privacy
          </button>
        ) : null}
      </div>
      <div className="status-bar-right">
        {gitBranch ? (
          <span
            className={`status-bar-git ${gitDetached ? "detached" : ""}`}
            title={
              gitDetached
                ? `Detached HEAD @ ${gitBranch}`
                : `Git branch: ${gitBranch}`
            }
          >
            <span className="status-bar-git-icon" aria-hidden>
              ⎇
            </span>
            <span className="status-bar-git-name">{gitBranch}</span>
            {gitDetached ? (
              <span className="status-bar-git-detached">detached</span>
            ) : null}
          </span>
        ) : (
          <span className="status-bar-git muted" title="Not a git repository">
            <span className="status-bar-git-icon" aria-hidden>
              ⎇
            </span>
            <span className="status-bar-git-name">no git</span>
          </span>
        )}
      </div>
    </footer>
  );
}
