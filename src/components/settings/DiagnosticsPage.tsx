import { useI18n } from "../../lib/i18n";

export function DiagnosticsPage({
  debugLogging,
  debugLogPath,
  crashLogPath,
  onSetDebugLogging,
  onOpenDebugLog,
  onOpenCrashLog,
}: {
  debugLogging: boolean;
  debugLogPath: string;
  crashLogPath: string;
  onSetDebugLogging: (next: boolean) => void;
  onOpenDebugLog: () => void;
  onOpenCrashLog: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="settings-section">
      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("diag.debug")}</span>
          <span className="settings-desc">
            {t("diag.debugDesc", { path: debugLogPath || "…" })}
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
          <span className="settings-label">{t("diag.open")}</span>
          <span className="settings-desc">{t("diag.openDesc")}</span>
        </div>
        <button type="button" className="btn" onClick={() => onOpenDebugLog()}>
          {t("diag.openBtn")}
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("diag.crash")}</span>
          <span className="settings-desc">
            {t("diag.crashDesc", { path: crashLogPath || "…" })}
          </span>
        </div>
        <button type="button" className="btn" onClick={() => onOpenCrashLog()}>
          {t("diag.crashBtn")}
        </button>
      </div>
    </section>
  );
}
