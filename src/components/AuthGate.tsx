import { useEffect, useState } from "react";
import type { AuthStatus, BackboneSummary } from "../vite-env";

type Props = {
  auth: AuthStatus | null;
  backbone: BackboneSummary | null;
  busy: boolean;
  message: string | null;
  onRefresh: () => void;
  onLogin: (deviceAuth?: boolean) => void;
  onCancelLogin: () => void;
  onLogout: () => void;
  onSetApiKey: (key: string) => void;
  onOpenInstallDocs: () => void;
};

export function AuthGate({
  auth,
  backbone,
  busy,
  message,
  onRefresh,
  onLogin,
  onCancelLogin,
  onLogout,
  onSetApiKey,
  onOpenInstallDocs,
}: Props) {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!auth?.authenticated) return;
    // keep panel compact when signed in — parent may still show strip
  }, [auth?.authenticated]);

  if (!auth) {
    return (
      <div className="auth-card">
        <p className="auth-muted">Checking Grok login…</p>
      </div>
    );
  }

  if (!auth.binaryFound) {
    return (
      <div className="auth-card">
        <h3>Install Grok Build</h3>
        <p>
          Grok Desktop uses the same agent backbone as the CLI. Install Grok
          Build once, then sign in here — no terminal required after that.
        </p>
        <div className="auth-actions">
          <button className="btn primary" onClick={onOpenInstallDocs}>
            Open install guide
          </button>
          <button className="btn" onClick={onRefresh} disabled={busy}>
            I installed it — refresh
          </button>
        </div>
        <p className="auth-muted">
          Looking for binary: <code>{auth.binary}</code>
        </p>
      </div>
    );
  }

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
              <strong>{backbone.mcpServers.length}</strong> MCP
              {backbone.mcpServers.length === 1 ? "" : "s"}
              {backbone.mcpServers.length > 0 ? (
                <span className="auth-muted">
                  {" "}
                  · {backbone.mcpServers.map((m) => m.name).join(", ")}
                </span>
              ) : (
                <span className="auth-muted">
                  {" "}
                  · configure in CLI ~/.grok/config.toml
                </span>
              )}
            </div>
            {backbone.grokVersion ? (
              <div className="auth-muted">Grok {backbone.grokVersion}</div>
            ) : null}
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
        Uses the official Grok browser login (same as <code>grok login</code>).
        Your skills, MCP servers, and config stay in{" "}
        <code>~/.grok</code> — this app only opens the sign-in flow.
      </p>

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
