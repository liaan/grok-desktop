import { useEffect, useRef, useState } from "react";
import type { AuthStatus, BackboneSummary, LoginProgress } from "../vite-env";
import { useI18n } from "../lib/i18n";

const BINARY_POLL_MS = 2000;
const BINARY_POLL_FOR_MS = 60_000;

const INSTALL_STEPS: Array<{ id: string; label: string; cmd: string }> = [
  {
    id: "win32",
    label: "Windows (PowerShell)",
    cmd: "irm https://x.ai/cli/install.ps1 | iex",
  },
  {
    id: "darwin",
    label: "macOS",
    cmd: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
  {
    id: "linux",
    label: "Linux",
    cmd: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
];

type Props = {
  auth: AuthStatus | null;
  backbone: BackboneSummary | null;
  busy: boolean;
  message: string | null;
  loginProgress?: LoginProgress | null;
  loginDeviceAuth?: boolean;
  platform?: string;
  onRefresh: () => void;
  onLogin: (deviceAuth?: boolean) => void;
  onCancelLogin: () => void;
  onSubmitLoginCode?: (code: string) => void;
  onLogout: () => void;
  onSetApiKey: (key: string) => void;
  onOpenInstallDocs: () => void;
  onOpenSettingsSection?: (section: "mcp" | "plugins" | "skills") => void;
};

export function AuthGate({
  auth,
  backbone,
  busy,
  message,
  loginProgress,
  loginDeviceAuth,
  platform,
  onRefresh,
  onLogin,
  onCancelLogin,
  onSubmitLoginCode,
  onLogout,
  onSetApiKey,
  onOpenInstallDocs,
  onOpenSettingsSection,
}: Props) {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { t } = useI18n();

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startBinaryPoll = () => {
    stopPoll();
    setPolling(true);
    const started = Date.now();
    pollRef.current = setInterval(() => {
      if (Date.now() - started >= BINARY_POLL_FOR_MS) {
        stopPoll();
        setPolling(false);
        return;
      }
      onRefresh();
    }, BINARY_POLL_MS);
  };

  useEffect(() => {
    return () => stopPoll();
  }, []);

  useEffect(() => {
    if (auth?.binaryFound) {
      stopPoll();
      setPolling(false);
    }
  }, [auth?.binaryFound]);

  useEffect(() => {
    if (!auth?.binaryFound) {
      setEngineVersion(null);
      return;
    }
    let cancelled = false;
    void window.grokDesktop.getGrokEngine().then((info) => {
      if (!cancelled && info.version) setEngineVersion(info.version);
    });
    return () => {
      cancelled = true;
    };
  }, [auth?.binaryFound, auth?.binary]);

  if (!auth) {
    return (
      <div className="auth-card">
        <p className="auth-muted">{t("auth.starting")}</p>
      </div>
    );
  }

  if (!auth.binaryFound) {
    const currentOs = platform || "";
    const steps = [
      ...INSTALL_STEPS.filter((s) => s.id === currentOs),
      ...INSTALL_STEPS.filter((s) => s.id !== currentOs),
    ];
    return (
      <div className="auth-card">
        <h3>{t("auth.install")}</h3>
        <p>{t("auth.installLead")}</p>
        <div className="auth-steps">
          {steps.map((step) => (
            <div
              key={step.id}
              className={
                step.id === currentOs ? "auth-step is-current" : "auth-step"
              }
            >
              <div className="auth-label">{step.label}</div>
              <pre className="auth-step-cmd">{step.cmd}</pre>
            </div>
          ))}
        </div>
        <div className="auth-actions">
          <button
            className="btn primary"
            onClick={() => {
              onOpenInstallDocs();
              onRefresh();
              startBinaryPoll();
            }}
          >
            {t("auth.openGuide")}
          </button>
          <button
            className="btn"
            onClick={() => {
              onRefresh();
              startBinaryPoll();
            }}
            disabled={busy}
          >
            {t("auth.installedRefresh")}
          </button>
        </div>
        <p className="auth-muted">
          {t("auth.lookingBinary")} <code>{auth.binary}</code>
        </p>
        {polling ? (
          <p className="auth-muted">{t("auth.checkingPoll")}</p>
        ) : null}
      </div>
    );
  }

  const versionLabel = engineVersion || backbone?.grokVersion || null;

  if (auth.authenticated && !auth.expired) {
    return (
      <div className="auth-card auth-ok">
        <div className="auth-row">
          <div>
            <div className="auth-label">{t("auth.signedIn")}</div>
            <div className="auth-value">
              {auth.displayName || auth.email || t("auth.accountFallback")}
              {auth.method ? (
                <span className="auth-pill">{auth.method}</span>
              ) : null}
            </div>
            {auth.email && auth.displayName !== auth.email ? (
              <div className="auth-muted">{auth.email}</div>
            ) : null}
          </div>
          <button className="btn" onClick={onLogout} disabled={busy}>
            {t("auth.signOut")}
          </button>
        </div>

        {backbone?.ok ? (
          <div className="auth-backbone">
            <div>
              {onOpenSettingsSection ? (
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => onOpenSettingsSection("skills")}
                >
                  <strong>{backbone.skills.length}</strong>
                  {t("auth.skillsSuffix")}
                </button>
              ) : (
                <>
                  <strong>{backbone.skills.length}</strong>
                  {t("auth.skillsSuffix")}
                </>
              )}
              <span className="auth-muted"> · {t("auth.sameAsCli")}</span>
            </div>
            <div>
              {onOpenSettingsSection ? (
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => onOpenSettingsSection("mcp")}
                >
                  <strong>{backbone.mcpServers.length}</strong>
                  {t(
                    backbone.mcpServers.length === 1
                      ? "auth.mcpSuffix"
                      : "auth.mcpSuffixS",
                  )}
                </button>
              ) : (
                <>
                  <strong>{backbone.mcpServers.length}</strong>
                  {t(
                    backbone.mcpServers.length === 1
                      ? "auth.mcpSuffix"
                      : "auth.mcpSuffixS",
                  )}
                </>
              )}
              {backbone.mcpServers.length > 0 ? (
                <span className="auth-muted">
                  {" "}
                  · {backbone.mcpServers.map((m) => m.name).join(", ")}
                </span>
              ) : (
                <span className="auth-muted"> · {t("auth.addInSettings")}</span>
              )}
            </div>
            <div>
              {onOpenSettingsSection ? (
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => onOpenSettingsSection("plugins")}
                >
                  <strong>{backbone.plugins.length}</strong>
                  {t(
                    backbone.plugins.length === 1
                      ? "auth.pluginSuffix"
                      : "auth.pluginSuffixS",
                  )}
                </button>
              ) : (
                <>
                  <strong>{backbone.plugins.length}</strong>
                  {t(
                    backbone.plugins.length === 1
                      ? "auth.pluginSuffix"
                      : "auth.pluginSuffixS",
                  )}
                </>
              )}
              {backbone.plugins.length > 0 ? (
                <span className="auth-muted">
                  {" "}
                  · {backbone.plugins.map((p) => p.name).join(", ")}
                </span>
              ) : (
                <span className="auth-muted">
                  {" "}
                  · {t("auth.installFromGit")}
                </span>
              )}
            </div>
            {versionLabel ? (
              <div className="auth-muted">
                {t("auth.grokVersion", { version: versionLabel })}
              </div>
            ) : null}
            <div className="auth-muted">
              {t("auth.pathLabel")} <code>{auth.binary}</code>
            </div>
          </div>
        ) : backbone && !backbone.ok ? (
          <p className="auth-muted">
            {t("auth.listFailed", { error: backbone.error ?? "" })}
          </p>
        ) : (
          <p className="auth-muted">{t("auth.loadingBackbone")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h3>{auth.expired ? t("auth.expired") : t("auth.signInTitle")}</h3>
      <p>{t("auth.lead")}</p>
      {versionLabel ? (
        <p className="auth-muted">
          {t("auth.grokWithPath", { version: versionLabel, path: auth.binary })}
        </p>
      ) : (
        <p className="auth-muted">
          {t("auth.binaryLabel")} <code>{auth.binary}</code>
        </p>
      )}

      <div className="auth-actions">
        <button
          className="btn primary"
          onClick={() => onLogin(false)}
          disabled={busy || auth.loginInProgress}
        >
          {auth.loginInProgress || busy
            ? t("auth.waitingSignIn")
            : t("auth.signInBrowser")}
        </button>
        {(busy || auth.loginInProgress) && (
          <button className="btn" onClick={onCancelLogin}>
            {t("auth.cancel")}
          </button>
        )}
        <button
          className="btn"
          onClick={() => onLogin(true)}
          disabled={busy || auth.loginInProgress}
        >
          {t("auth.deviceCodeBtn")}
        </button>
        <button className="btn" onClick={onRefresh} disabled={busy}>
          {t("auth.refresh")}
        </button>
      </div>

      {(busy || auth.loginInProgress) && (
        <LoginAssist
          url={loginProgress?.url || null}
          userCode={loginProgress?.userCode || null}
          showPaste={
            loginDeviceAuth !== true && loginProgress?.deviceAuth !== true
          }
          copied={copied}
          loginCode={loginCode}
          onLoginCode={setLoginCode}
          onCopy={async () => {
            const url = loginProgress?.url;
            if (!url) return;
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
          onOpen={() => {
            const url = loginProgress?.url;
            if (url) void window.grokDesktop.openExternal(url);
          }}
          onSubmit={() => {
            const code = loginCode.trim();
            if (!code || !onSubmitLoginCode) return;
            onSubmitLoginCode(code);
            setLoginCode("");
          }}
        />
      )}

      {message ? <pre className="auth-output">{message}</pre> : null}

      <div className="auth-divider">{t("auth.or")}</div>

      <button className="btn block" onClick={() => setShowKey((v) => !v)}>
        {showKey ? t("auth.hideKey") : t("auth.useKey")}
      </button>

      {showKey ? (
        <div className="auth-key-box">
          <p className="auth-muted">{t("auth.keyHint")}</p>
          <input
            type="password"
            className="auth-input"
            placeholder="xai-…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <button
            className="btn primary block"
            disabled={!apiKey.trim() || busy}
            onClick={() => onSetApiKey(apiKey.trim())}
          >
            {t("auth.continueKey")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LoginAssist({
  url,
  userCode,
  showPaste,
  copied,
  loginCode,
  onLoginCode,
  onCopy,
  onOpen,
  onSubmit,
}: {
  url: string | null;
  userCode: string | null;
  showPaste: boolean;
  copied: boolean;
  loginCode: string;
  onLoginCode: (value: string) => void;
  onCopy: () => void;
  onOpen: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="auth-login-assist">
      {url ? (
        <div className="auth-url-box">
          <div className="auth-label">{t("auth.url")}</div>
          <p className="auth-muted">{t("auth.urlHint")}</p>
          <code className="auth-url">{url}</code>
          <div className="auth-actions">
            <button className="btn" type="button" onClick={onCopy}>
              {copied ? t("auth.copied") : t("auth.copyUrl")}
            </button>
            <button className="btn" type="button" onClick={onOpen}>
              {t("auth.openBrowser")}
            </button>
          </div>
        </div>
      ) : (
        <p className="auth-muted">
          {t("auth.waitingUrl")} <code>grok login --oauth</code>
        </p>
      )}

      {userCode ? (
        <div className="auth-user-code">
          <div className="auth-label">{t("auth.device")}</div>
          <code>{userCode}</code>
          <p className="auth-muted">{t("auth.deviceHint")}</p>
        </div>
      ) : null}

      {showPaste ? (
      <div className="auth-code-box">
        <div className="auth-label">{t("auth.pasteLabel")}</div>
        <p className="auth-muted">{t("auth.pasteHint")}</p>
        <input
          type="text"
          className="auth-input"
          placeholder={t("auth.paste")}
          value={loginCode}
          onChange={(e) => onLoginCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="btn primary block"
          type="button"
          disabled={!loginCode.trim()}
          onClick={onSubmit}
        >
          {t("auth.submitCode")}
        </button>
      </div>
      ) : null}
    </div>
  );
}
