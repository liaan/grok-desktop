import { useI18n } from "../../lib/i18n";

export function UpdatesPage({
  allowPrerelease,
  onSetAllowPrerelease,
}: {
  allowPrerelease: boolean;
  onSetAllowPrerelease: (next: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="settings-section">
      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("updates.preview")}</span>
          <span className="settings-desc">{t("updates.desc")}</span>
        </div>
        <input
          type="checkbox"
          checked={allowPrerelease}
          onChange={(e) => onSetAllowPrerelease(e.target.checked)}
        />
      </label>
    </section>
  );
}
