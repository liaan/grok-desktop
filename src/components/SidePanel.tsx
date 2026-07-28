import { useCallback, useEffect, useRef, useState } from "react";
import {
  basen,
  isLexicallyUnder,
  normalizePathKey,
  parentDir,
  relativeDisplay,
} from "../lib/path-utils";
import type { BackgroundTask } from "../lib/background-tasks";
import { hasAnyTasks, runningTaskCount } from "../lib/background-tasks";
import { usePrivacy } from "../lib/privacy-context";

type FileEntry = { name: string; isDirectory: boolean; path: string };

/**
 * Right rail: project file browser + background Tasks dock.
 * Tool approvals live inline in the chat timeline (not here).
 */
export function SidePanel({
  project,
  backgroundTasks,
  sessionMode,
}: {
  project: string | null;
  backgroundTasks: BackgroundTask[];
  /** e.g. "plan" when plan mode is active */
  sessionMode: string | null;
}) {
  const { redact } = usePrivacy();
  const running = runningTaskCount(backgroundTasks);
  const hasTasks = hasAnyTasks(backgroundTasks);
  /** Expanded when there is work; user can collapse. Auto-expand when new running tasks. */
  const [tasksOpen, setTasksOpen] = useState(false);
  const [browseCwd, setBrowseCwd] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  /** Monotonic id so out-of-order listDir results are ignored. */
  const loadSeq = useRef(0);
  const prevRunning = useRef(0);

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

  // Rise and expand the dock when background work appears
  useEffect(() => {
    if (running > 0 && running >= prevRunning.current) {
      setTasksOpen(true);
    }
    if (!hasTasks) {
      setTasksOpen(false);
    }
    prevRunning.current = running;
  }, [running, hasTasks]);

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

  const tasksLabel = running
    ? `Tasks (${running})`
    : hasTasks
      ? `Tasks (${backgroundTasks.length})`
      : "Tasks";

  return (
    <aside className="panel">
      <div className="panel-header">
        <div className="panel-header-title">Files</div>
      </div>
      <div className="panel-body">
        {sessionMode === "plan" ? (
          <div className="mode-banner plan-mode-banner" role="status">
            Plan mode active — file edits blocked until you approve a plan
          </div>
        ) : null}
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
      </div>

      {/* Bottom dock: greyed when empty; rises when there is background work */}
      <div
        className={[
          "tasks-dock",
          hasTasks ? "tasks-dock-has-items" : "tasks-dock-empty",
          running > 0 ? "tasks-dock-running" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          type="button"
          className="tasks-dock-header"
          disabled={!hasTasks}
          aria-expanded={tasksOpen && hasTasks}
          aria-controls={tasksOpen && hasTasks ? "tasks-dock-body" : undefined}
          title={
            hasTasks
              ? tasksOpen
                ? "Collapse background tasks"
                : "Expand background tasks"
              : "No background tasks"
          }
          onClick={() => {
            if (!hasTasks) return;
            setTasksOpen((o) => !o);
          }}
        >
          <span className="tasks-dock-label">{tasksLabel}</span>
          {hasTasks ? (
            <span className="tasks-dock-chevron" aria-hidden>
              {tasksOpen ? "▾" : "▴"}
            </span>
          ) : null}
        </button>
        {tasksOpen && hasTasks ? (
          <div
            id="tasks-dock-body"
            className="tasks-dock-body"
            role="region"
            aria-label="Background tasks"
          >
            {backgroundTasks.map((t) => (
              <div key={t.id} className={`task-card status-${t.status}`}>
                <div className="task-card-top">
                  <span className="task-kind">{t.kind}</span>
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
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
