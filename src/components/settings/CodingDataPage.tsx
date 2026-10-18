import { useI18n } from "../../lib/i18n";

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
  const { t } = useI18n();
  return (
    <section className="settings-section">
      <div className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">{t("coding.share")}</span>
          <span className="settings-desc">{t("coding.desc")}</span>
          {codingDataNote ? (
            <span className="settings-desc settings-note">{codingDataNote}</span>
          ) : null}
          {offerRestart ? (
            <span className="settings-desc settings-note">
              {t("coding.restartNote")}
            </span>
          ) : null}
        </div>
        <div
          className="theme-toggle coding-data-toggle"
          role="radiogroup"
          aria-label={t("coding.aria")}
        >
          <button
            type="button"
            className={`theme-opt ${codingDataOptIn ? "active" : ""}`}
            aria-checked={codingDataOptIn}
            role="radio"
            onClick={() => onSetCodingDataOptIn(true)}
          >
            {t("coding.optIn")}
          </button>
          <button
            type="button"
            className={`theme-opt ${!codingDataOptIn ? "active" : ""}`}
            aria-checked={!codingDataOptIn}
            role="radio"
            onClick={() => onSetCodingDataOptIn(false)}
          >
            {t("coding.optOut")}
          </button>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("coding.restart")}</span>
          <span className="settings-desc">{t("coding.restartDesc")}</span>
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
