import { useCallback, useEffect, useRef, useState } from "react";
import {
  basen,
  isLexicallyUnder,
  normalizePathKey,
  parentDir,
  relativeDisplay,
} from "../lib/path-utils";
import type { PermissionRequest } from "../vite-env";
import { formatOptionLabel } from "../lib/timeline";
import type { BackgroundTask } from "../lib/background-tasks";
import { runningTaskCount } from "../lib/background-tasks";
import { usePrivacy } from "../lib/privacy-context";
import { buildToolCard, ToolCardView } from "./ToolCardView";

type FileEntry = { name: string; isDirectory: boolean; path: string };

export function SidePanel({
  project,
  permissions,
  backgroundTasks,
  sessionMode,
  onPermission,
  onAllowAllPermissions,
}: {
  project: string | null;
  permissions: PermissionRequest[];
  backgroundTasks: BackgroundTask[];
  /** e.g. "plan" when plan mode is active */
  sessionMode: string | null;
  onPermission: (reqId: string, optionId: string | "cancelled") => void;
  /** Approve every open request (multi-edit batches) */
  onAllowAllPermissions?: () => void;
}) {
  const { redact } = usePrivacy();
  const [tab, setTab] = useState<"files" | "approvals" | "tasks">("approvals");
  const running = runningTaskCount(backgroundTasks);
  const [browseCwd, setBrowseCwd] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  /** Monotonic id so out-of-order listDir results are ignored. */
  const loadSeq = useRef(0);

  const loadDir = useCallback(async (dir: string) => {
    const seq = ++loadSeq.current;
    setFilesLoading(true);
    setFilesError(null);
    try {
      const list = await window.grokDesktop.listDir(dir);
      if (seq !== loadSeq.current) return;
      setBrowseCwd(dir);
      setFiles(list);
      setFilesError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setFilesError(err instanceof Error ? err.message : String(err));
      // Keep previous listing so a failed drill-down does not blank the panel.
    } finally {
      if (seq === loadSeq.current) setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    // Invalidate in-flight loads when project changes
    loadSeq.current += 1;
    if (!project) {
      setBrowseCwd(null);
      setFiles([]);
      setFilesError(null);
      setFilesLoading(false);
      return;
    }
    // Drop previous project's tree before loading the new root
    setBrowseCwd(project);
    setFiles([]);
    setFilesError(null);
    void loadDir(project);
  }, [project, loadDir]);

  useEffect(() => {
    if (permissions.length > 0) setTab("approvals");
  }, [permissions.length]);

  useEffect(() => {
    if (running > 0 && permissions.length === 0) setTab("tasks");
  }, [running, permissions.length]);

  const atProjectRoot =
    Boolean(project && browseCwd) &&
    normalizePathKey(project!) === normalizePathKey(browseCwd!);
  const upPath =
    browseCwd && project && !atProjectRoot ? parentDir(browseCwd) : null;
  const canGoUp =
    upPath != null && project != null && isLexicallyUnder(project, upPath);

  const pathLabel =
    project && browseCwd
      ? atProjectRoot
        ? basen(project)
        : relativeDisplay(project, browseCwd)
      : project
        ? basen(project)
        : "";

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button
          type="button"
          className={tab === "approvals" ? "active" : ""}
          onClick={() => setTab("approvals")}
        >
          Approvals{permissions.length ? ` (${permissions.length})` : ""}
        </button>
        <button
          type="button"
          className={tab === "tasks" ? "active" : ""}
          onClick={() => setTab("tasks")}
        >
          Tasks{running ? ` (${running})` : ""}
        </button>
        <button
          type="button"
          className={tab === "files" ? "active" : ""}
          onClick={() => setTab("files")}
        >
          Files
        </button>
      </div>
      <div className="panel-body">
        {sessionMode === "plan" ? (
          <div className="mode-banner plan-mode-banner" role="status">
            Plan mode active — file edits blocked until you approve a plan
          </div>
        ) : null}
        {tab === "tasks" && (
          <>
            {backgroundTasks.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Background commands and subagents appear here while they run.
              </p>
            ) : (
              backgroundTasks.map((t) => (
                <div
                  key={t.id}
                  className={`task-card status-${t.status}`}
                >
                  <div className="task-card-top">
                    <span className={`task-kind`}>{t.kind}</span>
                    <span className={`task-status status-${t.status}`}>
                      {t.status}
                    </span>
                  </div>
                  <h3 className="task-title" title={redact(t.title)}>
                    {redact(t.title)}
                  </h3>
                  {t.detail ? (
                    <div className="task-detail" title={redact(t.detail)}>
                      {redact(t.detail)}
                    </div>
                  ) : null}
                  {t.command && t.command !== t.title ? (
                    <pre className="task-cmd">{redact(t.command)}</pre>
                  ) : null}
                  {t.outputSnippet ? (
                    <pre className="task-out">{redact(t.outputSnippet)}</pre>
                  ) : null}
                  {t.exitCode != null ? (
                    <div className="task-meta">exit {t.exitCode}</div>
                  ) : null}
                </div>
              ))
            )}
          </>
        )}
        {tab === "approvals" && (
          <>
            {permissions.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Tool approvals appear here when the agent needs permission.
              </p>
            ) : (
              <>
                {permissions.length > 1 && onAllowAllPermissions ? (
                  <div className="perm-batch-actions">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => onAllowAllPermissions()}
                    >
                      Allow all ({permissions.length})
                    </button>
                    <p className="perm-batch-hint">
                      Each tool is a separate approval. Allow all grants every
                      open request so multi-edit batches do not stall.
                    </p>
                  </div>
                ) : null}
                {permissions.map((p) => {
                  const tool = p.params?.toolCall;
                  const options = p.params?.options?.length
                    ? p.params.options
                    : [
                        { optionId: "allow-once", name: "Allow once" },
                        { optionId: "reject", name: "Reject" },
                      ];
                  const card = buildToolCard({
                    title: tool?.title,
                    kind: tool?.kind,
                    raw: tool?.rawInput,
                  });
                  const meta = [
                    tool?.kind || "tool",
                    tool?.toolCallId
                      ? `${String(tool.toolCallId).slice(0, 18)}…`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <div key={p.reqId} className="perm-card">
                      <ToolCardView card={card} meta={meta} />
                      <div className="perm-actions">
                        {options.map((opt) => (
                          <button
                            key={opt.optionId}
                            type="button"
                            className={
                              opt.optionId.includes("allow") ||
                              /yes|proceed|approve/i.test(opt.name || "")
                                ? "btn primary"
                                : "btn"
                            }
                            onClick={() => onPermission(p.reqId, opt.optionId)}
                          >
                            {formatOptionLabel(opt.optionId, opt.name)}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn danger"
                          onClick={() => onPermission(p.reqId, "cancelled")}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
        {tab === "files" && (
          <>
            {!project ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Open a project to browse files.
              </p>
            ) : (
              <>
                <div
                  className="file-browser-path"
                  title={redact(browseCwd || project || "")}
                >
                  {canGoUp ? (
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      title="Up one folder"
                      onClick={() => upPath && void loadDir(upPath)}
                    >
                      ↑
                    </button>
                  ) : null}
                  <span className="file-browser-label">{pathLabel}</span>
                </div>
                {filesLoading && files.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    Loading…
                  </p>
                ) : null}
                {filesError ? (
                  <p style={{ color: "var(--danger, #f87171)", fontSize: 13 }}>
                    {filesError}
                  </p>
                ) : null}
                {!filesLoading && !filesError && files.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    No files (or empty folder).
                  </p>
                ) : null}
                {files.map((f) => (
                  <div
                    key={f.path}
                    className={`file-row ${f.isDirectory ? "is-dir" : "is-file"}`}
                  >
                    <button
                      type="button"
                      className={`file-item ${f.isDirectory ? "file-item-dir" : "file-item-file"}`}
                      title={
                        f.isDirectory
                          ? `Open folder: ${redact(f.path)}`
                          : `Open: ${redact(f.path)}`
                      }
                      onClick={() =>
                        f.isDirectory
                          ? void loadDir(f.path)
                          : void window.grokDesktop.openPath(f.path)
                      }
                    >
                      <span className="file-item-icon" aria-hidden>
                        {f.isDirectory ? "📁" : "📄"}
                      </span>
                      <span className="file-item-name">{f.name}</span>
                    </button>
                    {!f.isDirectory ? (
                      <button
                        type="button"
                        className="btn ghost btn-sm file-reveal"
                        title="Show in folder"
                        aria-label={`Show ${f.name} in folder`}
                        onClick={() => void window.grokDesktop.showItem(f.path)}
                      >
                        ↗
                      </button>
                    ) : null}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
