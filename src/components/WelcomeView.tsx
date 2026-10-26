import type {
  AuthStatus,
  BackboneSummary,
  LoginProgress,
  OpenCheckoutRow,
} from "../vite-env";
import { basen, samePathKey } from "../lib/path-utils";
import { BrandMark, Spinner } from "./BrandMark";
import { AuthGate } from "./AuthGate";
import { useI18n } from "../lib/i18n";

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
  loginProgress,
  loginDeviceAuth,
  error,
  recentProjects,
  appVersion,
  grokBinary,
  onRefreshAuth,
  onLogin,
  onCancelLogin,
  onSubmitLoginCode,
  onLogout,
  onSetApiKey,
  onPickProject,
  onOpenProject,
  openCheckouts = [],
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
  loginProgress?: LoginProgress | null;
  loginDeviceAuth?: boolean;
  error: string | null;
  recentProjects: string[];
  appVersion?: string;
  grokBinary?: string | null;
  onRefreshAuth: () => void;
  onLogin: (deviceAuth?: boolean) => void;
  onCancelLogin: () => void;
  onSubmitLoginCode?: (code: string) => void;
  onLogout: () => void;
  onSetApiKey: (key: string) => void;
  onPickProject: () => void;
  onOpenProject: (cwd: string) => void;
  openCheckouts?: OpenCheckoutRow[];
  onOpenSettingsSection?: (section: "mcp" | "plugins" | "skills") => void;
  platform?: string;
  inert?: boolean;
}) {
  const { t } = useI18n();
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
              <p>{t("welcome.tagline")}</p>
            </div>
          </div>
          <p className="welcome-lead">{t("welcome.lead")}</p>
          {!auth && !isOpening ? (
            <div className="loading-banner" role="status" aria-live="polite">
              <Spinner size={18} />
              <div>
                <strong>{t("welcome.starting")}</strong>
                <span>{t("welcome.loading")}</span>
              </div>
            </div>
          ) : null}

          <AuthGate
            auth={auth}
            backbone={backbone}
            busy={authBusy || isOpening}
            message={authMessage}
            loginProgress={loginProgress}
            loginDeviceAuth={loginDeviceAuth}
            onRefresh={onRefreshAuth}
            onLogin={onLogin}
            onCancelLogin={onCancelLogin}
            onSubmitLoginCode={onSubmitLoginCode}
            onLogout={onLogout}
            onSetApiKey={onSetApiKey}
            onOpenInstallDocs={() => void window.grokDesktop.openInstallDocs()}
            onOpenSettingsSection={onOpenSettingsSection}
            platform={platform}
          />

          <ul className="checklist">
            <li>{t("welcome.b1")}</li>
            <li>{t("welcome.b2")}</li>
            <li>{t("welcome.b3")}</li>
          </ul>

          <div className="welcome-actions">
            <button
              className="btn primary"
              type="button"
              onClick={onPickProject}
              disabled={!signedIn || isOpening}
              title={
                signedIn ? t("welcome.open") : t("welcome.signInFirst")
              }
            >
              {isOpening ? (
                <>
                  <Spinner size={16} />
                  {t("sidebar.opening")}
                </>
              ) : (
                t("sidebar.openProject")
              )}
            </button>
            {signedIn &&
              recentProjects.slice(0, 6).map((p) => (
                <button
                  key={p}
                  className="btn"
                  type="button"
                  disabled={isOpening}
                  title={
                    openCheckouts.some((row) => samePathKey(row.cwd, p))
                      ? t("welcome.alreadyOpen")
                      : p
                  }
                  onClick={() => onOpenProject(p)}
                >
                  {basen(p)}
                  {openCheckouts.some((row) => samePathKey(row.cwd, p)) ? (
                    <span className="open-badge">{t("sidebar.openBadge")}</span>
                  ) : null}
                </button>
              ))}
          </div>

          {isOpening && (
            <div className="loading-banner" role="status" aria-live="polite">
              <Spinner size={18} />
              <div>
                <strong>{t("welcome.agent")}</strong>
                <span>
                  {openingLabel
                    ? t("welcome.connectingFor", { label: openingLabel })
                    : t("welcome.connecting")}
                </span>
              </div>
            </div>
          )}

          {error && <p className="welcome-error">{error}</p>}
          <p className="welcome-meta">
            App v{appVersion || "…"} · Backbone:{" "}
            {grokBinary || auth?.binary || t("welcome.detecting")}
          </p>
        </div>
      </div>
    </div>
  );
}
