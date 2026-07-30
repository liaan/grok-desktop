import { memo } from "react";
import type { AuthStatus, BackboneSummary, SessionSummary } from "../vite-env";
import type { ConnState } from "../lib/conn";
import { basen } from "../lib/path-utils";
import { formatSessionWhen } from "../lib/time";
import { usePrivacy } from "../lib/privacy-context";
import { BrandMark, Spinner } from "./BrandMark";

export const AppSidebar = memo(function AppSidebar({
  infoVersion,
  grokBinary,
  auth,
  backbone,
  project,
  sessionId,
  sessions,
  recentProjects,
  conn,
  isOpening,
  authBusy,
  onPickProject,
  onOpenProject,
  onOpenSession,
  onLogout,
}: {
  infoVersion?: string;
  grokBinary?: string | null;
  auth: AuthStatus | null;
  backbone: BackboneSummary | null;
  project: string;
  sessionId: string | null;
  sessions: SessionSummary[];
  recentProjects: string[];
  conn: ConnState;
  isOpening: boolean;
  authBusy: boolean;
  onPickProject: () => void;
  onOpenProject: (cwd: string) => void;
  onOpenSession: (opts: { mode: "new" | "resume"; sessionId?: string }) => void;
  onLogout: () => void;
}) {
  const { redact } = usePrivacy();
  const busyGate = isOpening || conn === "busy";

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark size={32} />
        <div className="brand-text">
          <h1>Grok Desktop</h1>
          <p>xAI · Grok Build GUI</p>
        </div>
      </div>

      <div className="sidebar-section">
        <button
          className="btn primary block"
          type="button"
          onClick={onPickProject}
          disabled={busyGate}
        >
          {isOpening ? (
            <span className="btn-inline">
              <Spinner size={14} />
              Opening…
            </span>
          ) : (
            "Open project…"
          )}
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
            type="button"
            style={{ marginTop: 8 }}
            onClick={onLogout}
            disabled={authBusy || isOpening}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <h2>Chats</h2>
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={busyGate}
              title={
                conn === "busy"
                  ? "Stop the current turn before starting a new chat"
                  : "Start a new chat (same as CLI /new)"
              }
              onClick={() => onOpenSession({ mode: "new" })}
            >
              New
            </button>
          </div>
          <div className="recent-list session-list">
            {sessions.length === 0 ? (
              <p className="sidebar-hint">
                No saved chats yet for this project.
              </p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`recent-item ${s.id === sessionId ? "active" : ""}`}
                  disabled={busyGate}
                  title={s.id}
                  onClick={() =>
                    onOpenSession({ mode: "resume", sessionId: s.id })
                  }
                >
                  <span className="name">{s.title || "(no summary)"}</span>
                  <span className="path">
                    {formatSessionWhen(s.lastActiveAt || s.updatedAt)}
                    {s.numChatMessages ? ` · ${s.numChatMessages} msgs` : ""}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <h2>Recent projects</h2>
          <div className="recent-list">
            {recentProjects.map((p) => (
              <button
                key={p}
                type="button"
                className={`recent-item ${p === project ? "active" : ""}`}
                disabled={busyGate}
                onClick={() => onOpenProject(p)}
              >
                <span className="name">{basen(p)}</span>
                <span className="path">{redact(p)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-meta" title={sessionId || undefined}>
          Session: {sessionId ? sessionId.slice(0, 8) : "—"}…
        </div>
        <div className="sidebar-meta">App v{infoVersion || "…"}</div>
        <div
          className="sidebar-meta"
          title={redact(grokBinary || "") || undefined}
        >
          Binary: {redact(grokBinary)}
        </div>
      </div>
    </aside>
  );
});
