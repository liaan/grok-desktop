export function DiagnosticsPage({
  debugLogging,
  debugLogPath,
  onSetDebugLogging,
  onOpenDebugLog,
}: {
  debugLogging: boolean;
  debugLogPath: string;
  onSetDebugLogging: (next: boolean) => void;
  onOpenDebugLog: () => void;
}) {
  return (
    <section className="settings-section">
      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Debug logging</span>
          <span className="settings-desc">
            Write tool, hook, terminal, and ACP events to a local JSONL log. Use
            when tools stick on pending / in_progress. Env{" "}
            <code>GROK_DESKTOP_DEBUG=1</code> also enables this. Path:{" "}
            <code className="settings-path" title={debugLogPath}>
              {debugLogPath || "…"}
            </code>
          </span>
        </div>
        <input
          type="checkbox"
          checked={debugLogging}
          onChange={(e) => onSetDebugLogging(e.target.checked)}
        />
      </label>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Open debug log</span>
          <span className="settings-desc">
            Open the log file in your default editor (create if missing).
          </span>
        </div>
        <button type="button" className="btn" onClick={() => onOpenDebugLog()}>
          Open log
        </button>
      </div>
    </section>
  );
}
