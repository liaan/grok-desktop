import { useEffect, useRef, useState } from "react";
import type { AuthStatus, BackboneSummary } from "../vite-env";

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
  platform?: string;
  onRefresh: () => void;
  onLogin: (deviceAuth?: boolean) => void;
  onCancelLogin: () => void;
  onLogout: () => void;
  onSetApiKey: (key: string) => void;
  onOpenInstallDocs: () => void;
  onOpenMcpSettings?: () => void;
};

export function AuthGate({
  auth,
  backbone,
  busy,
  message,
  platform,
  onRefresh,
  onLogin,
  onCancelLogin,
  onLogout,
  onSetApiKey,
  onOpenInstallDocs,
  onOpenMcpSettings,
}: Props) {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [polling, setPolling] = useState(false);
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        <p className="auth-muted">Checking Grok login…</p>
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
        <h3>Install Grok Build</h3>
        <p>
          Grok Desktop uses the same agent backbone as the CLI. Install Grok
          Build once, then sign in here — no terminal required after that.
        </p>
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
            Open install guide
          </button>
          <button
            className="btn"
            onClick={() => {
              onRefresh();
              startBinaryPoll();
            }}
            disabled={busy}
          >
            I installed it — refresh
          </button>
        </div>
        <p className="auth-muted">
          Looking for binary: <code>{auth.binary}</code>
        </p>
        {polling ? (
          <p className="auth-muted">
            Checking every 2 seconds for about a minute so a Dock-launched app
            can pick up ~/.grok/bin/grok without a restart.
          </p>
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
            <div className="auth-label">Signed in</div>
            <div className="auth-value">
              {auth.displayName || auth.email || "Grok account"}
              {auth.method ? (
                <span className="auth-pill">{auth.method}</span>
              ) : null}
            </div>
            {auth.email && auth.displayName !== auth.email ? (
              <div className="auth-muted">{auth.email}</div>
            ) : null}
          </div>
          <button className="btn" onClick={onLogout} disabled={busy}>
            Sign out
          </button>
        </div>

        {backbone?.ok ? (
          <div className="auth-backbone">
            <div>
              <strong>{backbone.skills.length}</strong> skills
              <span className="auth-muted"> · same as CLI</span>
            </div>
            <div>
              {onOpenMcpSettings ? (
                <button
                  type="button"
                  className="auth-link"
                  onClick={onOpenMcpSettings}
                >
                  <strong>{backbone.mcpServers.length}</strong> MCP
                  {backbone.mcpServers.length === 1 ? "" : "s"}
                </button>
              ) : (
                <>
                  <strong>{backbone.mcpServers.length}</strong> MCP
                  {backbone.mcpServers.length === 1 ? "" : "s"}
                </>
              )}
              {backbone.mcpServers.length > 0 ? (
                <span className="auth-muted">
                  {" "}
                  · {backbone.mcpServers.map((m) => m.name).join(", ")}
                </span>
              ) : (
                <span className="auth-muted">
                  {" "}
                  · add in Settings — no terminal
                </span>
              )}
            </div>
            {versionLabel ? (
              <div className="auth-muted">Grok {versionLabel}</div>
            ) : null}
            <div className="auth-muted">
              Path: <code>{auth.binary}</code>
            </div>
          </div>
        ) : backbone && !backbone.ok ? (
          <p className="auth-muted">
            Could not list skills/MCP yet: {backbone.error}
          </p>
        ) : (
          <p className="auth-muted">Loading skills &amp; MCP from ~/.grok…</p>
        )}
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h3>{auth.expired ? "Session expired" : "Sign in to Grok"}</h3>
      <p>
        Uses the official Grok browser login (same credentials as the CLI).
        Your skills, MCP servers, and config stay in <code>~/.grok</code> —
        this app only opens the sign-in flow.
      </p>
      {versionLabel ? (
        <p className="auth-muted">
          Grok {versionLabel} · <code>{auth.binary}</code>
        </p>
      ) : (
        <p className="auth-muted">
          Binary: <code>{auth.binary}</code>
        </p>
      )}

      <div className="auth-actions">
        <button
          className="btn primary"
          onClick={() => onLogin(false)}
          disabled={busy || auth.loginInProgress}
        >
          {auth.loginInProgress || busy
            ? "Waiting for browser…"
            : "Sign in with browser"}
        </button>
        {(busy || auth.loginInProgress) && (
          <button className="btn" onClick={onCancelLogin}>
            Cancel
          </button>
        )}
        <button className="btn" onClick={() => onLogin(true)} disabled={busy}>
          Device code…
        </button>
        <button className="btn" onClick={onRefresh} disabled={busy}>
          Refresh status
        </button>
      </div>

      {message ? <pre className="auth-output">{message}</pre> : null}

      <div className="auth-divider">or</div>

      <button className="btn block" onClick={() => setShowKey((v) => !v)}>
        {showKey ? "Hide API key option" : "Use API key instead"}
      </button>

      {showKey ? (
        <div className="auth-key-box">
          <p className="auth-muted">
            From console.x.ai — used only for this app session (not written to
            disk). Session login still takes precedence if present.
          </p>
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
            Continue with API key
          </button>
        </div>
      ) : null}
    </div>
  );
}
