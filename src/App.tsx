import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageList } from "./components/MessageList";
import { SidePanel } from "./components/SidePanel";
import { applySessionUpdate, uid } from "./lib/timeline";
import type { PermissionRequest, TimelineItem } from "./vite-env";

type ConnState = "idle" | "connecting" | "online" | "busy" | "error";

function basename(p: string) {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

export default function App() {
  const [info, setInfo] = useState<Awaited<
    ReturnType<typeof window.grokDesktop.getInfo>
  > | null>(null);
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

  useEffect(() => {
    window.grokDesktop.getInfo().then((i) => {
      setInfo(i);
      setAlwaysApprove(i.alwaysApprove);
    });
  }, []);

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

  const openProject = useCallback(async (cwd: string) => {
    setConn("connecting");
    setError(null);
    setItems([]);
    setPermissions([]);
    try {
      const res = await window.grokDesktop.openProject(cwd);
      setProject(res.cwd);
      setSessionId(res.sessionId);
      setConn("online");
      setItems([
        {
          id: uid("sys"),
          kind: "system",
          text: `Connected to Grok agent backbone\nProject: ${res.cwd}\nSession: ${res.sessionId}\nBinary: ${res.grokBinary}`,
          at: Date.now(),
        },
      ]);
      const i = await window.grokDesktop.getInfo();
      setInfo(i);
    } catch (e: any) {
      setConn("error");
      setError(e?.message || String(e));
    }
  }, []);

  const pickProject = async () => {
    const cwd = await window.grokDesktop.pickProject();
    if (cwd) await openProject(cwd);
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
      setConn("error");
      setError(e?.message || String(e));
      setItems((prev) => [
        ...prev,
        {
          id: uid("sys"),
          kind: "system",
          text: `Error: ${e?.message || String(e)}`,
          at: Date.now(),
        },
      ]);
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
                <p>Codex-style GUI · Grok agent backbone</p>
              </div>
            </div>
            <p style={{ marginTop: 16 }}>
              Full desktop UI that spawns <code>grok agent stdio</code> and speaks
              ACP. Your models, login, skills, and MCP configs from{" "}
              <code>~/.grok</code> still apply — only the face changes.
            </p>
            <ul className="checklist">
              <li>Project workspace picker & recent folders</li>
              <li>Streaming chat, thoughts, plans, tool cards</li>
              <li>Click-to-approve tool permissions</li>
              <li>Same Grok binary / skills / MCP backbone</li>
            </ul>
            <div className="welcome-actions">
              <button className="btn primary" onClick={pickProject}>
                Open project…
              </button>
              {(info?.recentProjects || []).slice(0, 3).map((p) => (
                <button key={p} className="btn" onClick={() => openProject(p)}>
                  {basename(p)}
                </button>
              ))}
            </div>
            {error && (
              <p style={{ color: "var(--danger)", marginTop: 16 }}>{error}</p>
            )}
            <p style={{ marginTop: 18, fontSize: 12, color: "var(--text-muted)" }}>
              Backbone binary: {info?.grokBinary || "detecting…"}
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
              <span className={`status-dot ${conn === "online" || conn === "busy" ? (conn === "busy" ? "busy" : "online") : conn === "error" ? "error" : ""}`} />
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
          <div
            style={{
              padding: "8px 16px",
              background: "rgba(248,113,113,0.1)",
              color: "#fecaca",
              borderBottom: "1px solid rgba(248,113,113,0.25)",
              fontSize: 13,
            }}
          >
            {error}
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
                Powered by local <code>grok agent stdio</code> · ACP
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
