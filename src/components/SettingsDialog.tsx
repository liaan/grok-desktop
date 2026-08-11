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
  codingDataOptIn,
  codingDataNote,
  permissionMode,
  allowOutsideProject,
  sandboxTerminal,
  sandboxStatus,
  debugLogging,
  debugLogPath,
  onSetTheme,
  onSetPrivacyMode,
  onSetCodingDataOptIn,
  onSetPermissionMode,
  onToggleAllowOutside,
  onSetSandboxTerminal,
  onSetDebugLogging,
  onOpenDebugLog,
}: {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  privacyMode: boolean;
  /** SpaceXAI coding-data share (default opt-in). */
  codingDataOptIn: boolean;
  codingDataNote?: string;
  permissionMode: PermissionMode;
  allowOutsideProject: boolean;
  sandboxTerminal: boolean;
  sandboxStatus: string;
  debugLogging: boolean;
  debugLogPath: string;
  onSetTheme: (theme: "dark" | "light") => void;
  onSetPrivacyMode: (next: boolean) => void;
  onSetCodingDataOptIn: (next: boolean) => void;
  onSetPermissionMode: (mode: PermissionMode) => void;
  onToggleAllowOutside: () => void;
  /** Desired checked state from the checkbox (not a toggle). */
  onSetSandboxTerminal: (next: boolean) => void;
  onSetDebugLogging: (next: boolean) => void;
  onOpenDebugLog: () => void;
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
            <h3>Coding data, retention, and training</h3>
            <div className="settings-row settings-row-stack">
              <div className="settings-row-text">
                <span className="settings-label">Share coding data</span>
                <span className="settings-desc">
                  Opt in to provide SpaceXAI the ability to retain and train on
                  coding data (prompts, traces, metrics) for training and
                  debugging. Simple product metrics may still be collected.
                  Same setting as CLI{" "}
                  <code>/privacy</code>. Default is <strong>Opt in</strong>.
                  Re-open the project after changing so the agent process picks
                  it up.
                </span>
                {codingDataNote ? (
                  <span className="settings-desc settings-note">
                    {codingDataNote}
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
                  stay inside the open project or a{" "}
                  <strong>linked git worktree</strong> of this repo (sibling
                  checkouts from <code>git worktree add</code>). Independent of
                  terminal sandbox. File browser stays project-scoped either
                  way. Turn on only for paths that are not worktrees of this
                  repo.
                </span>
              </div>
              <input
                type="checkbox"
                checked={allowOutsideProject}
                onChange={onToggleAllowOutside}
              />
            </label>
          </section>

          <section className="settings-section">
            <h3>Diagnostics</h3>
            <label className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Debug logging</span>
                <span className="settings-desc">
                  Write tool, hook, terminal, and ACP events to a local JSONL
                  log. Use when tools stick on pending / in_progress. Env{" "}
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
              <button
                type="button"
                className="btn"
                onClick={() => onOpenDebugLog()}
              >
                Open log
              </button>
            </div>
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
