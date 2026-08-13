import { useEffect, useState } from "react";
import type { EditorListResult } from "../../vite-env";

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
      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Theme</span>
          <span className="settings-desc">
            Night is the default dark UI. Day is a light theme.
          </span>
        </div>
        <div className="theme-toggle" role="group" aria-label="Theme">
          <button
            type="button"
            className={`theme-opt ${theme === "dark" ? "active" : ""}`}
            onClick={() => onSetTheme("dark")}
          >
            Night
          </button>
          <button
            type="button"
            className={`theme-opt ${theme === "light" ? "active" : ""}`}
            onClick={() => onSetTheme("light")}
          >
            Day
          </button>
        </div>
      </label>

      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Privacy mode</span>
          <span className="settings-desc">
            Hide your home directory in the UI (paths show as ~/…). For
            screenshots and demos only — does not change how the agent works or
            what is stored on disk.
          </span>
        </div>
        <input
          type="checkbox"
          checked={privacyMode}
          onChange={(e) => onSetPrivacyMode(e.target.checked)}
        />
      </label>

      <label className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">External editor</span>
          <span className="settings-desc">
            Files and Changes open here — not the browser default for HTML or
            Markdown. Auto picks Cursor, VS Code, Zed, then a system text
            editor.
          </span>
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
            Auto
            {editors?.resolvedLabel ? ` (${editors.resolvedLabel})` : ""}
          </option>
          {(editors?.editors || []).map((ed) => (
            <option key={ed.id} value={ed.id} disabled={!ed.available}>
              {ed.label}
              {ed.available ? "" : " — not found"}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
