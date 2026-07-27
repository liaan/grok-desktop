import { useEffect, useRef } from "react";
import {
  PERMISSION_MODE_OPTIONS,
  type PermissionMode,
} from "../lib/permission-mode";

/**
 * App settings modal — appearance + agent safety.
 * Keeps the sidebar footer free of checkbox clutter.
 */
export function SettingsDialog({
  open,
  onClose,
  theme,
  privacyMode,
  permissionMode,
  allowOutsideProject,
  sandboxTerminal,
  sandboxStatus,
  onSetTheme,
  onSetPrivacyMode,
  onSetPermissionMode,
  onToggleAllowOutside,
  onSetSandboxTerminal,
}: {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  privacyMode: boolean;
  permissionMode: PermissionMode;
  allowOutsideProject: boolean;
  sandboxTerminal: boolean;
  sandboxStatus: string;
  onSetTheme: (theme: "dark" | "light") => void;
  onSetPrivacyMode: (next: boolean) => void;
  onSetPermissionMode: (mode: PermissionMode) => void;
  onToggleAllowOutside: () => void;
  /** Desired checked state from the checkbox (not a toggle). */
  onSetSandboxTerminal: (next: boolean) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const modeMeta =
    PERMISSION_MODE_OPTIONS.find((o) => o.value === permissionMode) ||
    PERMISSION_MODE_OPTIONS[0];

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-header">
          <h2 id="settings-title">Settings</h2>
          <button
            ref={closeRef}
            type="button"
            className="btn ghost btn-sm"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <section className="settings-section">
            <h3>Appearance</h3>
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
                  screenshots and demos only — does not change how the agent
                  works or what is stored on disk.
                </span>
              </div>
              <input
                type="checkbox"
                checked={privacyMode}
                onChange={(e) => onSetPrivacyMode(e.target.checked)}
              />
            </label>
          </section>

          <section className="settings-section">
            <h3>Agent safety</h3>

            <label className="settings-row settings-row-stack">
              <div className="settings-row-text">
                <span className="settings-label">Tool permission mode</span>
                <span className="settings-desc">{modeMeta.description}</span>
              </div>
              <select
                className="settings-select"
                value={permissionMode}
                aria-label="Tool permission mode"
                onChange={(e) =>
                  onSetPermissionMode(e.target.value as PermissionMode)
                }
              >
                {PERMISSION_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Sandbox terminal</span>
                <span className="settings-desc">
                  When on (recommended), tool shells run in a project filesystem
                  jail. Host secrets and the Docker daemon stay out of reach;
                  network still works. Backend: {sandboxStatus || "…"}.
                </span>
              </div>
              <input
                type="checkbox"
                checked={sandboxTerminal}
                onChange={(e) => onSetSandboxTerminal(e.target.checked)}
              />
            </label>
            <label className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Allow outside project</span>
                <span className="settings-desc">
                  When off (recommended), ACP file ops and terminal cwd must
                  stay inside the open project. Independent of terminal sandbox.
                  File browser stays project-scoped either way.
                </span>
              </div>
              <input
                type="checkbox"
                checked={allowOutsideProject}
                onChange={onToggleAllowOutside}
              />
            </label>
          </section>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
