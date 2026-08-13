import { useEffect, useState } from "react";
import type { GrokEngineInfo, GrokUpdateCheck } from "../../vite-env";

export function EnginePage({
  grokBinary,
  restarting,
  onRestartAgent,
}: {
  grokBinary?: string;
  restarting?: boolean;
  onRestartAgent: () => void;
}) {
  const [engine, setEngine] = useState<GrokEngineInfo | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUpdateNote(null);
    void window.grokDesktop.getGrokEngine().then((info) => {
      if (!cancelled) setEngine(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="settings-section">
      <div className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">Grok CLI</span>
          <span className="settings-desc">
            Path:{" "}
            <code
              className="settings-path"
              title={engine?.binary || grokBinary || ""}
            >
              {engine?.binary || grokBinary || "…"}
            </code>
          </span>
          <span className="settings-desc">
            Version:{" "}
            {engine == null
              ? "…"
              : engine.binaryFound
                ? engine.version || engine.error || "unknown"
                : "not found"}
          </span>
          {updateNote ? (
            <span className="settings-desc settings-note">{updateNote}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="btn"
          disabled={engineBusy || !engine?.binaryFound}
          onClick={() => {
            void (async () => {
              setEngineBusy(true);
              setUpdateNote(null);
              try {
                const check: GrokUpdateCheck =
                  await window.grokDesktop.checkGrokUpdate();
                if (!check.ok) {
                  setUpdateNote(
                    check.error || "Could not check for CLI updates.",
                  );
                  return;
                }
                if (!check.updateAvailable) {
                  setUpdateNote(
                    check.currentVersion
                      ? `Grok ${check.currentVersion} is up to date.`
                      : "Grok CLI is up to date.",
                  );
                  return;
                }
                const from = check.currentVersion || "current";
                const to = check.latestVersion || "latest";
                if (
                  !window.confirm(
                    `Install Grok CLI ${to}?\n\nCurrent: ${from}\nDesktop will not auto-upgrade the engine.`,
                  )
                ) {
                  setUpdateNote(
                    `Update available: ${from} → ${to}. Install cancelled.`,
                  );
                  return;
                }
                const installed = await window.grokDesktop.installGrokUpdate();
                if (!installed.ok) {
                  setUpdateNote(installed.error || "CLI update failed.");
                  return;
                }
                const next = await window.grokDesktop.getGrokEngine();
                setEngine(next);
                setUpdateNote(
                  `Installed Grok ${next.version || to}. Restart the agent to use it.`,
                );
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                setUpdateNote(msg || "CLI update check failed.");
              } finally {
                setEngineBusy(false);
              }
            })();
          }}
        >
          {engineBusy ? "Working…" : "Check for CLI updates"}
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Restart agent</span>
          <span className="settings-desc">
            Respawn the Grok process and resume this chat. Needed after CLI
            updates or ~/.grok skill changes.
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
