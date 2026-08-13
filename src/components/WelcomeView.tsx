import type { AuthStatus, BackboneSummary } from "../vite-env";
import { basen } from "../lib/path-utils";
import { BrandMark, Spinner } from "./BrandMark";
import { AuthGate } from "./AuthGate";

/**
 * No-project landing: auth + open project.
 */
export function WelcomeView({
  platformClass,
  isOpening,
  openingLabel,
  signedIn,
  auth,
  backbone,
  authBusy,
  authMessage,
  error,
  recentProjects,
  appVersion,
  grokBinary,
  onRefreshAuth,
  onLogin,
  onCancelLogin,
  onLogout,
  onSetApiKey,
  onPickProject,
  onOpenProject,
  onOpenSettingsSection,
  platform,
  inert: shellInert,
}: {
  platformClass: string;
  isOpening: boolean;
  openingLabel: string | null;
  signedIn: boolean;
  auth: AuthStatus | null;
  backbone: BackboneSummary | null;
  authBusy: boolean;
  authMessage: string | null;
  error: string | null;
  recentProjects: string[];
  appVersion?: string;
  grokBinary?: string | null;
  onRefreshAuth: () => void;
  onLogin: (deviceAuth: boolean) => void;
  onCancelLogin: () => void;
  onLogout: () => void;
  onSetApiKey: (key: string) => void;
  onPickProject: () => void;
  onOpenProject: (cwd: string) => void;
  onOpenSettingsSection?: (section: "mcp" | "plugins" | "skills") => void;
  platform?: string;
  inert?: boolean;
}) {
  return (
    <div
      className={`app no-project ${platformClass}`.trim()}
      inert={shellInert || undefined}
    >
      <div className="titlebar-drag welcome-drag" aria-hidden />
      <div className="welcome">
        <div className={`welcome-card ${isOpening ? "is-loading" : ""}`}>
          <div className="brand brand-welcome">
            <BrandMark size={40} />
            <div className="brand-text">
              <h1>Grok Desktop</h1>
              <p>xAI · Desktop GUI · Grok Build backbone</p>
            </div>
          </div>
          <p className="welcome-lead">
            Graphical shell over the same agent as the CLI. Sign in once in the
            app, then open a project — skills, plugins, and MCP from{" "}
            <code>~/.grok</code> load automatically. Manage them in Settings —
            no terminal.
          </p>

          <AuthGate
            auth={auth}
            backbone={backbone}
            busy={authBusy || isOpening}
            message={authMessage}
            onRefresh={onRefreshAuth}
            onLogin={onLogin}
            onCancelLogin={onCancelLogin}
            onLogout={onLogout}
            onSetApiKey={onSetApiKey}
            onOpenInstallDocs={() => void window.grokDesktop.openInstallDocs()}
            onOpenSettingsSection={onOpenSettingsSection}
            platform={platform}
          />

          <ul className="checklist">
            <li>Browser sign-in (no CLI required after Grok is installed)</li>
            <li>Skills, plugins &amp; MCP from your existing ~/.grok setup</li>
            <li>Streaming chat, thoughts, plans, tool approvals</li>
          </ul>

          <div className="welcome-actions">
            <button
              className="btn primary"
              type="button"
              onClick={onPickProject}
              disabled={!signedIn || isOpening}
              title={
                signedIn ? "Open a project folder" : "Sign in to Grok first"
              }
            >
              {isOpening ? (
                <>
                  <Spinner size={16} />
                  Opening…
                </>
              ) : (
                "Open project…"
              )}
            </button>
            {signedIn &&
              recentProjects.slice(0, 3).map((p) => (
                <button
                  key={p}
                  className="btn"
                  type="button"
                  disabled={isOpening}
                  onClick={() => onOpenProject(p)}
                >
                  {basen(p)}
                </button>
              ))}
          </div>

          {isOpening && (
            <div className="loading-banner" role="status" aria-live="polite">
              <Spinner size={18} />
              <div>
                <strong>Starting Grok agent…</strong>
                <span>
                  Connecting to backbone
                  {openingLabel ? ` for ${openingLabel}` : ""}
                </span>
              </div>
            </div>
          )}

          {error && <p className="welcome-error">{error}</p>}
          <p className="welcome-meta">
            App v{appVersion || "…"} · Backbone:{" "}
            {grokBinary || auth?.binary || "detecting…"}
          </p>
        </div>
      </div>
    </div>
  );
}
