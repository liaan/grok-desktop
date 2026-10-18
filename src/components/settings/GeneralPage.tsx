import { useEffect, useState } from "react";
import type { EditorListResult } from "../../vite-env";
import { useI18n } from "../../lib/i18n";

export function GeneralPage({
  theme,
  privacyMode,
  onSetTheme,
  onSetPrivacyMode,
}: {
  theme: "dark" | "light";
  privacyMode: boolean;
  onSetTheme: (theme: "dark" | "light") => void;
  onSetPrivacyMode: (next: boolean) => void;
}) {
  const [editors, setEditors] = useState<EditorListResult | null>(null);
  const { t, pref, setPref } = useI18n();

  useEffect(() => {
    let cancelled = false;
    void window.grokDesktop.listEditors().then((list) => {
      if (!cancelled) setEditors(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="settings-section">
      <label className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">{t("general.language")}</span>
          <span className="settings-desc">{t("general.languageDesc")}</span>
        </div>
        <select
          className="settings-select"
          aria-label={t("general.language")}
          value={pref}
          onChange={(e) =>
            setPref(e.target.value as "system" | "en" | "zh-CN")
          }
        >
          <option value="system">{t("general.followSystem")}</option>
          <option value="en">{t("general.english")}</option>
          <option value="zh-CN">{t("general.zh")}</option>
        </select>
      </label>

      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("general.theme")}</span>
          <span className="settings-desc">{t("general.themeDesc")}</span>
        </div>
        <div className="theme-toggle" role="group" aria-label={t("general.themeAria")}>
          <button
            type="button"
            className={`theme-opt ${theme === "dark" ? "active" : ""}`}
            onClick={() => onSetTheme("dark")}
          >
            {t("general.night")}
          </button>
          <button
            type="button"
            className={`theme-opt ${theme === "light" ? "active" : ""}`}
            onClick={() => onSetTheme("light")}
          >
            {t("general.day")}
          </button>
        </div>
      </label>

      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("general.privacy")}</span>
          <span className="settings-desc">{t("general.privacyDesc")}</span>
        </div>
        <input
          type="checkbox"
          checked={privacyMode}
          onChange={(e) => onSetPrivacyMode(e.target.checked)}
        />
      </label>

      <label className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">{t("general.editor")}</span>
          <span className="settings-desc">{t("general.editorDesc")}</span>
        </div>
        <select
          className="settings-select"
          value={editors?.preferred || "auto"}
          disabled={!editors}
          onChange={(e) => {
            const id = e.target.value;
            void window.grokDesktop.setExternalEditor(id).then((list) => {
              setEditors(list);
            });
          }}
        >
          <option value="auto">
            {t("general.auto")}
            {editors?.resolvedLabel ? ` (${editors.resolvedLabel})` : ""}
          </option>
          {(editors?.editors || []).map((ed) => (
            <option key={ed.id} value={ed.id} disabled={!ed.available}>
              {ed.label}
              {ed.available ? "" : ` — ${t("general.notFound")}`}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
