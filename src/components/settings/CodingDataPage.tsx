export function CodingDataPage({
  codingDataOptIn,
  codingDataNote,
  offerRestart,
  restarting,
  onSetCodingDataOptIn,
  onRestartAgent,
}: {
  codingDataOptIn: boolean;
  codingDataNote?: string;
  offerRestart?: boolean;
  restarting?: boolean;
  onSetCodingDataOptIn: (next: boolean) => void;
  onRestartAgent: () => void;
}) {
  return (
    <section className="settings-section">
      <div className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">Share coding data</span>
          <span className="settings-desc">
            Opt in to provide SpaceXAI the ability to retain and train on coding
            data (prompts, traces, metrics) for training and debugging. Simple
            product metrics may still be collected. Same setting as CLI{" "}
            <code>/privacy</code>. Default is <strong>Opt in</strong>. Restart
            the agent after changing so the running process picks it up.
          </span>
          {codingDataNote ? (
            <span className="settings-desc settings-note">{codingDataNote}</span>
          ) : null}
          {offerRestart ? (
            <span className="settings-desc settings-note">
              Restart the agent to apply this change.
            </span>
          ) : null}
        </div>
        <div
          className="theme-toggle coding-data-toggle"
          role="radiogroup"
          aria-label="Coding data retention"
        >
          <button
            type="button"
            className={`theme-opt ${codingDataOptIn ? "active" : ""}`}
            aria-checked={codingDataOptIn}
            role="radio"
            onClick={() => onSetCodingDataOptIn(true)}
          >
            Opt in
          </button>
          <button
            type="button"
            className={`theme-opt ${!codingDataOptIn ? "active" : ""}`}
            aria-checked={!codingDataOptIn}
            role="radio"
            onClick={() => onSetCodingDataOptIn(false)}
          >
            Opt out
          </button>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Restart agent</span>
          <span className="settings-desc">
            Respawn the Grok process for this window and resume the same chat.
            Use after coding-data or ~/.grok skill changes. MCP and plugin
            writes already restart.
          </span>
        </div>
        <button
          type="button"
          className="btn"
          disabled={restarting}
          onClick={() => onRestartAgent()}
        >
          {restarting ? "Restarting…" : "Restart agent"}
        </button>
      </div>
    </section>
  );
}
