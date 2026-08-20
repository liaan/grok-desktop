import { memo, useCallback, useEffect, useRef, useState } from "react";
import type {
  AuthStatus,
  BackboneSummary,
  OpenCheckoutRow,
  SessionSummary,
} from "../vite-env";
import type { ConnState } from "../lib/conn";
import { basen, samePathKey } from "../lib/path-utils";
import { formatSessionWhen } from "../lib/time";
import { usePrivacy } from "../lib/privacy-context";
import { BrandMark, Spinner } from "./BrandMark";
import { ColToggle } from "./ColToggle";

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
  onNewWorktree,
  onOpenProject,
  openCheckouts = [],
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onLogout,
  onOpenSettingsSection,
  collapsed,
  onToggleCollapsed,
  inert: shellInert,
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
  onNewWorktree?: () => void;
  onOpenProject: (cwd: string) => void;
  openCheckouts?: OpenCheckoutRow[];
  onOpenSession: (opts: { mode: "new" | "resume"; sessionId?: string }) => void;
  onRenameSession?: (opts: {
    sessionId: string;
    title: string;
  }) => void | Promise<void>;
  onDeleteSession?: (opts: { sessionId: string }) => void | Promise<void>;
  onLogout: () => void;
  onOpenSettingsSection?: (section: "mcp" | "plugins" | "skills") => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  inert?: boolean;
}) {
  const { redact } = usePrivacy();
  const busyGate = isOpening || conn === "busy";
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [chatMenu, setChatMenu] = useState<{
    x: number;
    y: number;
    session: SessionSummary;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameBlurRef = useRef(false);

  useEffect(() => {
    if (!renamingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingId]);

  useEffect(() => {
    if (!chatMenu) return;
    const close = () => setChatMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [chatMenu]);

  const startRename = useCallback((s: SessionSummary) => {
    const current = (s.title || "").trim();
    setChatMenu(null);
    setRenamingId(s.id);
    setRenameDraft(current === "(no summary)" ? "" : current);
  }, []);

  const openChatMenu = useCallback(
    (e: { clientX: number; clientY: number; preventDefault: () => void }, s: SessionSummary) => {
      e.preventDefault();
      const pad = 8;
      const w = 180;
      const h = 88;
      setChatMenu({
        session: s,
        x: Math.min(e.clientX, window.innerWidth - w - pad),
        y: Math.min(e.clientY, window.innerHeight - h - pad),
      });
    },
    [],
  );

  const confirmDelete = useCallback(
    async (s: SessionSummary) => {
      setChatMenu(null);
      if (!onDeleteSession) return;
      const label = (s.title || "").trim() || "this chat";
      if (
        !window.confirm(
          `Delete “${label}”? This cannot be undone.`,
        )
      ) {
        return;
      }
      try {
        await onDeleteSession({ sessionId: s.id });
      } catch {
        /* App surfaces the error */
      }
    },
    [onDeleteSession],
  );

  const cancelRename = useCallback(() => {
    if (renameBusy) return;
    setRenamingId(null);
    setRenameDraft("");
  }, [renameBusy]);

  const commitRename = useCallback(async () => {
    if (!renamingId || !onRenameSession || renameBusy) return;
    const next = renameDraft.trim();
    const current = sessions.find((s) => s.id === renamingId);
    if (!next || next === (current?.title || "").trim()) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    try {
      await onRenameSession({ sessionId: renamingId, title: next });
      setRenamingId(null);
      setRenameDraft("");
    } catch {
      /* App surfaces the error; keep the editor open */
    } finally {
      setRenameBusy(false);
    }
  }, [
    cancelRename,
    onRenameSession,
    renameBusy,
    renameDraft,
    renamingId,
    sessions,
  ]);

  return (
    <aside
      className={"sidebar" + (collapsed ? " sidebar--collapsed" : "")}
      inert={shellInert || undefined}
    >
      <div className="brand">
        {collapsed ? (
          <>
            <ColToggle
              collapsed={collapsed}
              expandToward="right"
              labelExpand="Expand sidebar"
              labelCollapse="Collapse sidebar"
              onClick={onToggleCollapsed}
            />
            <button
              type="button"
              className="brand-mark-btn"
              title="Expand sidebar"
              onClick={onToggleCollapsed}
            >
              <BrandMark size={28} />
            </button>
          </>
        ) : (
          <>
            <BrandMark size={32} />
            <div className="brand-text">
              <h1>Grok Desktop</h1>
              <p>xAI · Grok Build GUI</p>
            </div>
            <ColToggle
              collapsed={collapsed}
              expandToward="right"
              labelExpand="Expand sidebar"
              labelCollapse="Collapse sidebar"
              onClick={onToggleCollapsed}
            />
          </>
        )}
      </div>

      {collapsed ? null : (
      <>
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
        {onNewWorktree ? (
          <button
            className="btn block"
            type="button"
            style={{ marginTop: 8 }}
            disabled={busyGate}
            title="Create a git worktree and open it in a new window"
            onClick={onNewWorktree}
          >
            New worktree…
          </button>
        ) : null}
      </div>

      <div className="sidebar-section">
        <h2>Account</h2>
        <div className="sidebar-account">
          <div className="name">
            {auth?.displayName || auth?.email || "Signed in"}
          </div>
          <div className="path">
            {backbone?.ok ? (
              onOpenSettingsSection ? (
                <span>
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => onOpenSettingsSection("skills")}
                  >
                    {backbone.skills.length} skills
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => onOpenSettingsSection("mcp")}
                  >
                    {backbone.mcpServers.length} MCP
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => onOpenSettingsSection("plugins")}
                  >
                    {backbone.plugins.length} plugin
                    {backbone.plugins.length === 1 ? "" : "s"}
                  </button>
                </span>
              ) : (
                `${backbone.skills.length} skills · ${backbone.mcpServers.length} MCP · ${backbone.plugins.length} plugin${backbone.plugins.length === 1 ? "" : "s"}`
              )
            ) : (
              auth?.method || "session"
            )}
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
              sessions.map((s) =>
                renamingId === s.id ? (
                  <form
                    key={s.id}
                    className="session-row session-row--editing"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void commitRename();
                    }}
                  >
                    <input
                      ref={renameInputRef}
                      className="session-rename-input"
                      value={renameDraft}
                      disabled={renameBusy}
                      maxLength={100}
                      aria-label="Chat title"
                      placeholder="Chat title"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          skipRenameBlurRef.current = true;
                          cancelRename();
                        }
                      }}
                      onBlur={() => {
                        if (skipRenameBlurRef.current) {
                          skipRenameBlurRef.current = false;
                          return;
                        }
                        void commitRename();
                      }}
                    />
                  </form>
                ) : (
                  <div
                    key={s.id}
                    className={
                      "session-row" + (s.id === sessionId ? " active" : "")
                    }
                  >
                    <button
                      type="button"
                      className={`recent-item ${s.id === sessionId ? "active" : ""}`}
                      disabled={busyGate}
                      title={`${s.title || s.id}\nRight-click for rename or delete`}
                      onClick={() =>
                        onOpenSession({ mode: "resume", sessionId: s.id })
                      }
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onRenameSession) startRename(s);
                      }}
                      onContextMenu={(e) => {
                        if (!onRenameSession && !onDeleteSession) return;
                        e.stopPropagation();
                        openChatMenu(e, s);
                      }}
                    >
                      <span className="name">{s.title || "(no summary)"}</span>
                      <span className="path">
                        {formatSessionWhen(s.lastActiveAt || s.updatedAt)}
                        {s.numChatMessages ? ` · ${s.numChatMessages} msgs` : ""}
                      </span>
                    </button>
                    {onRenameSession || onDeleteSession ? (
                      <button
                        type="button"
                        className="session-more-btn"
                        title="Chat options"
                        aria-label={`Options for ${s.title || "chat"}`}
                        disabled={renameBusy}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openChatMenu(e, s);
                        }}
                      >
                        <span aria-hidden>⋯</span>
                      </button>
                    ) : null}
                  </div>
                ),
              )
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
                <span className="name">
                  {basen(p)}
                  {openCheckouts.some((row) => samePathKey(row.cwd, p)) ? (
                    <span className="open-badge">open</span>
                  ) : null}
                </span>
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
      </>
      )}
      {chatMenu ? (
        <div
          className="ctx-menu"
          role="menu"
          style={{ left: chatMenu.x, top: chatMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {onRenameSession ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => startRename(chatMenu.session)}
            >
              Rename
            </button>
          ) : null}
          {onDeleteSession ? (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void confirmDelete(chatMenu.session)}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
});
