import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthGate } from "./components/AuthGate";
import { MessageList } from "./components/MessageList";
import { SidePanel } from "./components/SidePanel";
import { applySessionUpdate, uid } from "./lib/timeline";
import type {
  AppInfo,
  AuthStatus,
  BackboneSummary,
  PermissionRequest,
  TimelineItem,
} from "./vite-env";

type ConnState = "idle" | "connecting" | "online" | "busy" | "error";

function basename(p: string) {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

function isAuthError(msg: string) {
  return /auth|login|unauthor|401|credential|sign in|sign-in/i.test(msg);
}

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [backbone, setBackbone] = useState<BackboneSummary | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState("");
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [alwaysApprove, setAlwaysApprove] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);

  const refreshAuth = useCallback(async () => {
    const status = await window.grokDesktop.getAuthStatus();
    setAuth(status);
    return status;
  }, []);

  const refreshBackbone = useCallback(async (cwd?: string) => {
    const summary = await window.grokDesktop.inspectBackbone(cwd);
    setBackbone(summary);
    return summary;
  }, []);

  const bootstrap = useCallback(async () => {
    const i = await window.grokDesktop.getInfo();
    setInfo(i);
    setAlwaysApprove(i.alwaysApprove);
    setAuth(i.auth);
    if (i.auth.authenticated && !i.auth.expired) {
      void refreshBackbone(i.lastProject || undefined);
    }
  }, [refreshBackbone]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const offs = [
      window.grokDesktop.on("agent:session-update", (params) => {
        setItems((prev) => applySessionUpdate(prev, params));
      }),
      window.grokDesktop.on("agent:permission-request", (payload) => {
        setPermissions((prev) => [...prev, payload as PermissionRequest]);
      }),
      window.grokDesktop.on("agent:error", (payload) => {
        setConn("error");
        setError(payload?.message || "Agent error");
      }),
      window.grokDesktop.on("agent:exit", () => {
        setConn("error");
        setSessionId(null);
        setError("Agent process exited");
      }),
      window.grokDesktop.on("agent:ready", (payload) => {
        setSessionId(payload?.sessionId ?? null);
        setConn("online");
        setError(null);
      }),
      window.grokDesktop.on("agent:stderr", () => {
        /* available for debug panel later */
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, permissions]);

  const signedIn = Boolean(auth?.authenticated && !auth?.expired);

  const openProject = useCallback(
    async (cwd: string) => {
      const status = auth || (await refreshAuth());
      if (!status.authenticated || status.expired) {
        setError("Sign in to Grok before opening a project.");
        return;
      }

      setConn("connecting");
      setError(null);
      setItems([]);
      setPermissions([]);
      try {
        const res = await window.grokDesktop.openProject(cwd);
        setProject(res.cwd);
        setSessionId(res.sessionId);
        setConn("online");
        const bb = await refreshBackbone(res.cwd);
        const skillN = bb.ok ? bb.skills.length : "?";
        const mcpN = bb.ok ? bb.mcpServers.length : "?";
        const mcpNames =
          bb.ok && bb.mcpServers.length
            ? bb.mcpServers.map((m) => m.name).join(", ")
            : "none from config";
        setItems([
          {
            id: uid("sys"),
            kind: "system",
            text: [
              "Connected to Grok agent backbone (same as CLI)",
              `Project: ${res.cwd}`,
              `Session: ${res.sessionId}`,
              `Binary: ${res.grokBinary}`,
              `Skills: ${skillN} · MCP: ${mcpN} (${mcpNames})`,
            ].join("\n"),
            at: Date.now(),
          },
        ]);
        const i = await window.grokDesktop.getInfo();
        setInfo(i);
        setAuth(i.auth);
      } catch (e: any) {
        const msg = e?.message || String(e);
        setConn("error");
        setError(msg);
        if (isAuthError(msg)) {
          void refreshAuth();
        }
      }
    },
    [auth, refreshAuth, refreshBackbone],
  );

  const pickProject = async () => {
    if (!signedIn) {
      setError("Sign in to Grok first.");
      return;
    }
    const cwd = await window.grokDesktop.pickProject();
    if (cwd) await openProject(cwd);
  };

  const handleLogin = async (deviceAuth = false) => {
    setAuthBusy(true);
    setAuthMessage(
      deviceAuth
        ? "Starting device-code login…"
        : "Opening browser for Grok sign-in…",
    );
    setError(null);
    try {
      const result = await window.grokDesktop.login({ deviceAuth });
      if (result.status) setAuth(result.status);
      if (result.output) setAuthMessage(result.output);
      if (result.ok || result.status?.authenticated) {
        setAuthMessage(result.output || "Signed in successfully.");
        await refreshBackbone();
        await bootstrap();
      } else if (result.error) {
        setAuthMessage(result.error);
        setError(result.error);
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      setAuthMessage(msg);
      setError(msg);
    } finally {
      setAuthBusy(false);
      void refreshAuth();
    }
  };

  const handleCancelLogin = async () => {
    await window.grokDesktop.cancelLogin();
    setAuthBusy(false);
    setAuthMessage("Login cancelled.");
    void refreshAuth();
  };

  const handleLogout = async () => {
    setAuthBusy(true);
    try {
      const res = await window.grokDesktop.logout();
      if (res.status) setAuth(res.status);
      setAuthMessage(res.message || "Signed out");
      setBackbone(null);
      setProject(null);
      setSessionId(null);
      setItems([]);
      setConn("idle");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSetApiKey = async (key: string) => {
    setAuthBusy(true);
    setError(null);
    try {
      const res = await window.grokDesktop.setApiKey(key);
      setAuth(res.status);
      if (res.ok) {
        setAuthMessage("API key set for this session.");
        await refreshBackbone();
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const sendPrompt = async () => {
    const text = input.trim();
    if (!text || !project || busyRef.current) return;
    busyRef.current = true;
    setConn("busy");
    setInput("");
    setItems((prev) => [
      ...prev,
      { id: uid("user"), kind: "user", text, at: Date.now() },
    ]);
    try {
      await window.grokDesktop.prompt(text);
      setConn("online");
    } catch (e: any) {
      const msg = e?.message || String(e);
      setConn("error");
      setError(msg);
      setItems((prev) => [
        ...prev,
        {
          id: uid("sys"),
          kind: "system",
          text: `Error: ${msg}`,
          at: Date.now(),
        },
      ]);
      if (isAuthError(msg)) void refreshAuth();
    } finally {
      busyRef.current = false;
    }
  };

  const onPermission = async (
    reqId: string,
    optionId: string | "cancelled",
  ) => {
    const outcome =
      optionId === "cancelled"
        ? { outcome: { outcome: "cancelled" as const } }
        : {
            outcome: {
              outcome: "selected" as const,
              optionId,
            },
          };
    await window.grokDesktop.respondPermission(reqId, outcome);
    setPermissions((prev) => prev.filter((p) => p.reqId !== reqId));
  };

  const toggleAlways = async () => {
    const next = !alwaysApprove;
    await window.grokDesktop.setAlwaysApprove(next);
    setAlwaysApprove(next);
  };

  const statusLabel = useMemo(() => {
    if (conn === "online") return "Connected";
    if (conn === "busy") return "Working…";
    if (conn === "connecting") return "Starting agent…";
    if (conn === "error") return "Error";
    return "Idle";
  }, [conn]);

  if (!project) {
    return (
      <div className="app no-project">
        <div className="welcome">
          <div className="welcome-card">
            <div className="brand" style={{ border: "none", padding: 0 }}>
              <div className="brand-mark" />
              <div>
                <h1 style={{ fontSize: 22 }}>Grok Desktop</h1>
                <p>Desktop GUI · Grok agent backbone</p>
              </div>
            </div>
            <p style={{ marginTop: 16 }}>
              Graphical shell over the same agent as the CLI. Sign in once in
              the app, then open a project — skills and MCP from{" "}
              <code>~/.grok</code> load automatically (configure them in the
              CLI for now).
            </p>

            <AuthGate
              auth={auth}
              backbone={backbone}
              busy={authBusy}
              message={authMessage}
              onRefresh={() => {
                void refreshAuth().then((s) => {
                  if (s.authenticated && !s.expired) void refreshBackbone();
                });
              }}
              onLogin={(device) => void handleLogin(device)}
              onCancelLogin={() => void handleCancelLogin()}
              onLogout={() => void handleLogout()}
              onSetApiKey={(key) => void handleSetApiKey(key)}
              onOpenInstallDocs={() => void window.grokDesktop.openInstallDocs()}
            />

            <ul className="checklist">
              <li>Browser sign-in (no CLI required after Grok is installed)</li>
              <li>Skills &amp; MCP from your existing ~/.grok setup</li>
              <li>Streaming chat, thoughts, plans, tool approvals</li>
            </ul>

            <div className="welcome-actions">
              <button
                className="btn primary"
                onClick={pickProject}
                disabled={!signedIn}
                title={
                  signedIn ? "Open a project folder" : "Sign in to Grok first"
                }
              >
                Open project…
              </button>
              {signedIn &&
                (info?.recentProjects || []).slice(0, 3).map((p) => (
                  <button key={p} className="btn" onClick={() => openProject(p)}>
                    {basename(p)}
                  </button>
                ))}
            </div>
            {error && (
              <p style={{ color: "var(--danger)", marginTop: 16 }}>{error}</p>
            )}
            <p style={{ marginTop: 18, fontSize: 12, color: "var(--text-muted)" }}>
              Backbone: {info?.grokBinary || auth?.binary || "detecting…"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <h1>Grok Desktop</h1>
            <p>on Grok Build backbone</p>
          </div>
        </div>

        <div className="sidebar-section">
          <button className="btn primary block" onClick={pickProject}>
            Open project…
          </button>
        </div>

        <div className="sidebar-section">
          <h2>Account</h2>
          <div className="sidebar-account">
            <div className="name">
              {auth?.displayName || auth?.email || "Signed in"}
            </div>
            <div className="path">
              {backbone?.ok
                ? `${backbone.skills.length} skills · ${backbone.mcpServers.length} MCP`
                : auth?.method || "session"}
            </div>
            <button
              className="btn block"
              style={{ marginTop: 8 }}
              onClick={() => void handleLogout()}
              disabled={authBusy}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <h2>Recent</h2>
          <div className="recent-list">
            {(info?.recentProjects || []).map((p) => (
              <button
                key={p}
                className={`recent-item ${p === project ? "active" : ""}`}
                onClick={() => openProject(p)}
              >
                <span className="name">{basename(p)}</span>
                <span className="path">{p}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <label className="row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={alwaysApprove}
              onChange={toggleAlways}
            />
            Always approve tools
          </label>
          <div>Session: {sessionId ? sessionId.slice(0, 8) : "—"}…</div>
          <div title={info?.grokBinary}>Binary: {info?.grokBinary}</div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <div style={{ fontWeight: 650 }}>{basename(project)}</div>
            <div className="cwd" title={project}>
              {project}
            </div>
          </div>
          <div className="row">
            <span className="status-pill">
              <span
                className={`status-dot ${
                  conn === "online" || conn === "busy"
                    ? conn === "busy"
                      ? "busy"
                      : "online"
                    : conn === "error"
                      ? "error"
                      : ""
                }`}
              />
              {statusLabel}
            </span>
            {conn === "busy" && (
              <button
                className="btn danger"
                onClick={() => window.grokDesktop.cancel()}
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="error-banner">
            {error}
            {isAuthError(error) ? (
              <button
                className="btn"
                style={{ marginLeft: 12 }}
                onClick={() => {
                  setProject(null);
                  setError(null);
                }}
              >
                Sign in again
              </button>
            ) : null}
          </div>
        )}

        <div className="timeline">
          <MessageList items={items} bottomRef={bottomRef} />
        </div>

        <div className="composer">
          <div className="composer-box">
            <textarea
              value={input}
              placeholder="Ask Grok to build, fix, or explain… (Enter to send, Shift+Enter for newline)"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendPrompt();
                }
              }}
              disabled={conn === "connecting" || conn === "error"}
            />
            <div className="composer-actions">
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Same skills &amp; MCP as CLI · <code>grok agent stdio</code>
              </span>
              <button
                className="btn primary"
                onClick={() => void sendPrompt()}
                disabled={
                  !input.trim() || conn === "busy" || conn === "connecting"
                }
              >
                {conn === "busy" ? "Working…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </main>

      <SidePanel
        project={project}
        permissions={permissions}
        onPermission={onPermission}
      />
    </div>
  );
}
