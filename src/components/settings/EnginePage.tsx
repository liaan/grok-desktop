import { useEffect, useState } from "react";
import {
  AUTO_COMPACT_OPTIONS,
  type AutoCompactAt,
} from "../../../shared/auto-compact.mjs";
import type { GrokEngineInfo, GrokUpdateCheck } from "../../vite-env";
import { useI18n } from "../../lib/i18n";

export function EnginePage({
  grokBinary,
  restarting,
  autoCompactAt,
  onSetAutoCompactAt,
  onRestartAgent,
}: {
  grokBinary?: string;
  restarting?: boolean;
  autoCompactAt: AutoCompactAt;
  onSetAutoCompactAt: (next: AutoCompactAt) => void;
  onRestartAgent: () => void;
}) {
  const { t } = useI18n();
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
      <label className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">{t("engine.compact")}</span>
          <span className="settings-desc">{t("engine.compactDesc")}</span>
        </div>
        <select
          className="settings-select"
          value={autoCompactAt}
          onChange={(e) =>
            onSetAutoCompactAt(e.target.value as AutoCompactAt)
          }
        >
          {AUTO_COMPACT_OPTIONS.map((opt) => (
            <option
              key={opt.id}
              value={opt.id}
              title={
                opt.id === "off"
                  ? t("engine.autoCompactOffHint")
                  : t(`engine.autoCompact${opt.id}Hint`)
              }
            >
              {opt.id === "off" ? t("engine.autoCompactOff") : opt.label}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">{t("engine.cli")}</span>
          <span className="settings-desc">
            {t("engine.pathLabel")}{" "}
            <code
              className="settings-path"
              title={engine?.binary || grokBinary || ""}
            >
              {engine?.binary || grokBinary || "…"}
            </code>
          </span>
          <span className="settings-desc">
            {t("engine.versionLabel")}{" "}
            {engine == null
              ? "…"
              : engine.binaryFound
                ? engine.version || engine.error || t("engine.unknown")
                : t("engine.notFound")}
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
                    check.error || t("engine.checkFailed"),
                  );
                  return;
                }
                if (!check.updateAvailable) {
                  setUpdateNote(
                    check.currentVersion
                      ? t("engine.upToDateVersion", {
                          version: check.currentVersion,
                        })
                      : t("engine.upToDate"),
                  );
                  return;
                }
                const from = check.currentVersion || "current";
                const to = check.latestVersion || "latest";
                if (
                  !window.confirm(
                    t("engine.installConfirm", { from, to }),
                  )
                ) {
                  setUpdateNote(
                    t("engine.updateCancelled", { from, to }),
                  );
                  return;
                }
                const installed = await window.grokDesktop.installGrokUpdate();
                if (!installed.ok) {
                  setUpdateNote(installed.error || t("engine.cliUpdateFailed"));
                  return;
                }
                const next = await window.grokDesktop.getGrokEngine();
                setEngine(next);
                setUpdateNote(
                  t("engine.installedNote", { version: next.version || to }),
                );
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                setUpdateNote(msg || t("engine.checkFailedShort"));
              } finally {
                setEngineBusy(false);
              }
            })();
          }}
        >
          {engineBusy ? t("mcp.working") : t("engine.checkBtn")}
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("engine.restart")}</span>
          <span className="settings-desc">{t("engine.restartDesc")}</span>
        </div>
        <button
          type="button"
          className="btn"
          disabled={restarting}
          onClick={() => onRestartAgent()}
        >
          {restarting ? t("mcp.restarting") : t("engine.restart")}
        </button>
      </div>
    </section>
  );
}
