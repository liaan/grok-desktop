import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  basen,
  isLexicallyUnder,
  normalizePathKey,
  parentDir,
  relativeDisplay,
} from "../lib/path-utils";
import type { BackgroundTask } from "../lib/background-tasks";
import { hasAnyTasks, runningTaskCount } from "../lib/background-tasks";
import { fileFromDiffPayload, shouldRenderDiff } from "../lib/line-diff";
import { usePrivacy } from "../lib/privacy-context";
import { stripAnsi } from "../lib/tool-display";
import { DiffView } from "./DiffView";

type FileEntry = { name: string; isDirectory: boolean; path: string };
type GitStatusEntry = {
  path: string;
  origPath: string | null;
  index: string;
  worktree: string;
  status: string;
  untracked: boolean;
  staged: boolean;
  unstaged: boolean;
};
type PanelTab = "files" | "changes";
type PeekState =
  | { kind: "file"; path: string; absPath: string }
  | { kind: "diff"; path: string; absPath: string; staged: boolean };

const PEEK_CHAR_CAP = 200_000;

function joinProjectPath(root: string, rel: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const p = String(rel || "").replace(/\\/g, "/");
  if (!p) return r;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return rel;
  const sep = root.includes("\\") ? "\\" : "/";
  return `${r}${sep}${p.replace(/\//g, sep)}`;
}

/**
 * Right rail: project file browser + git Changes + background Tasks dock.
 * Tool approvals live inline in the chat timeline (not here).
 */
export const SidePanel = memo(function SidePanel({
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
  const [tab, setTab] = useState<PanelTab>("files");
  const [browseCwd, setBrowseCwd] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [changes, setChanges] = useState<GitStatusEntry[]>([]);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [peek, setPeek] = useState<PeekState | null>(null);
  const [peekText, setPeekText] = useState<string | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [peekLoading, setPeekLoading] = useState(false);
  /** Monotonic id so out-of-order listDir results are ignored. */
  const loadSeq = useRef(0);
  const changesSeq = useRef(0);
  const peekSeq = useRef(0);
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

  const loadChanges = useCallback(async (cwd: string) => {
    const seq = ++changesSeq.current;
    setChangesLoading(true);
    try {
      const res = await window.grokDesktop.getGitStatus(cwd);
      if (seq !== changesSeq.current) return;
      setChanges(res?.files ?? []);
      setChangesError(null);
    } catch (err) {
      if (seq !== changesSeq.current) return;
      setChangesError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === changesSeq.current) setChangesLoading(false);
    }
  }, []);

  const openPeek = useCallback((next: PeekState) => {
    setPeek(next);
  }, []);

  useEffect(() => {
    // Invalidate in-flight loads when project changes
    loadSeq.current += 1;
    changesSeq.current += 1;
    peekSeq.current += 1;
    setTab("files");
    setPeek(null);
    setPeekText(null);
    setPeekError(null);
    setPeekLoading(false);
    setChanges([]);
    setChangesError(null);
    setChangesLoading(false);
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
    if (!project) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await loadChanges(project);
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [project, loadChanges]);

  useEffect(() => {
    if (!peek || !project) {
      setPeekText(null);
      setPeekError(null);
      setPeekLoading(false);
      return;
    }
    const seq = ++peekSeq.current;
    setPeekLoading(true);
    setPeekError(null);
    setPeekText(null);
    const run = async () => {
      try {
        if (peek.kind === "file") {
          const text = await window.grokDesktop.readFile(peek.absPath);
          if (seq !== peekSeq.current) return;
          setPeekText(text);
        } else {
          const res = await window.grokDesktop.getGitDiff(peek.path, {
            staged: peek.staged,
          });
          if (seq !== peekSeq.current) return;
          setPeekText(res?.diff ?? "");
        }
      } catch (err) {
        if (seq !== peekSeq.current) return;
        setPeekError(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === peekSeq.current) setPeekLoading(false);
      }
    };
    void run();
  }, [peek, project]);

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

  const changesLabel =
    changes.length > 0 ? `Changes (${changes.length})` : "Changes";

  const peekDiff = useMemo(() => {
    if (!peek || peek.kind !== "diff" || peekText == null) return null;
    return {
      files: [fileFromDiffPayload({ path: peek.path, patch: peekText })],
    };
  }, [peek, peekText]);

  const peekFileText = useMemo(() => {
    if (peekText == null) return null;
    if (peekText.includes("\u0000")) return null;
    if (peekText.length > PEEK_CHAR_CAP) {
      return `${peekText.slice(0, PEEK_CHAR_CAP)}\n… (truncated)`;
    }
    return peekText;
  }, [peekText]);
  const peekIsBinary = Boolean(peekText && peekText.includes("\u0000"));

  const selectFile = (file: FileEntry) => {
    if (file.isDirectory) {
      void loadDir(file.path);
      return;
    }
    openPeek({ kind: "file", path: file.path, absPath: file.path });
  };

  const selectChange = (entry: GitStatusEntry) => {
    if (!project) return;
    const absPath = joinProjectPath(project, entry.path);
    if (entry.untracked) {
      openPeek({ kind: "file", path: entry.path, absPath });
      return;
    }
    openPeek({
      kind: "diff",
      path: entry.path,
      absPath,
      staged: entry.unstaged ? false : entry.staged,
    });
  };

  return (
    <aside className="panel">
      <div className="panel-tabs" role="tablist" aria-label="Side panel">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "files"}
          className={tab === "files" ? "active" : ""}
          onClick={() => {
            setTab("files");
            setPeek(null);
          }}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "changes"}
          className={tab === "changes" ? "active" : ""}
          onClick={() => {
            setTab("changes");
            setPeek(null);
            if (project) void loadChanges(project);
          }}
        >
          {changesLabel}
        </button>
      </div>
      <div className="panel-main">
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
          ) : tab === "files" ? (
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
              {files.map((f) => {
                const selected =
                  peek != null &&
                  !f.isDirectory &&
                  normalizePathKey(peek.absPath) === normalizePathKey(f.path);
                return (
                  <div
                    key={f.path}
                    className={`file-row ${f.isDirectory ? "is-dir" : "is-file"}${selected ? " is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      className={`file-item ${f.isDirectory ? "file-item-dir" : "file-item-file"}`}
                      title={
                        f.isDirectory
                          ? `Open folder: ${redact(f.path)}`
                          : `Peek: ${redact(f.path)}`
                      }
                      onClick={() => selectFile(f)}
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
                );
              })}
            </>
          ) : (
            <>
              {changesLoading && changes.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  Loading…
                </p>
              ) : null}
              {changesError ? (
                <p style={{ color: "var(--danger, #f87171)", fontSize: 13 }}>
                  {changesError}
                </p>
              ) : null}
              {!changesLoading && !changesError && changes.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  No local changes.
                </p>
              ) : null}
              {changes.map((entry) => {
                const selected =
                  peek != null &&
                  normalizePathKey(peek.path) === normalizePathKey(entry.path);
                const badge =
                  entry.status === "?" ? "?" : entry.status || "M";
                return (
                  <div
                    key={`${entry.index}${entry.worktree}:${entry.path}`}
                    className={`file-row is-file${selected ? " is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="file-item file-item-file"
                      title={redact(entry.path)}
                      onClick={() => selectChange(entry)}
                    >
                      <span
                        className={`change-badge change-badge-${badge === "?" ? "untracked" : badge}`}
                        aria-label={
                          entry.untracked
                            ? "Untracked"
                            : badge === "D"
                              ? "Deleted"
                              : badge === "A"
                                ? "Added"
                                : badge === "R"
                                  ? "Renamed"
                                  : "Modified"
                        }
                      >
                        {badge}
                      </span>
                      <span className="file-item-name">{entry.path}</span>
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm file-reveal"
                      title="Show in folder"
                      aria-label={`Show ${entry.path} in folder`}
                      onClick={() =>
                        void window.grokDesktop.showItem(
                          joinProjectPath(project, entry.path),
                        )
                      }
                    >
                      ↗
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
        {peek && project ? (
          <div className="file-peek">
            <div className="file-peek-header">
              <span
                className="file-peek-title"
                title={redact(peek.path)}
              >
                {basen(peek.path)}
              </span>
              <button
                type="button"
                className="btn ghost btn-sm"
                title="Open in editor"
                onClick={() => void window.grokDesktop.openPath(peek.absPath)}
              >
                Open in editor
              </button>
              <button
                type="button"
                className="btn ghost btn-sm file-reveal"
                title="Show in folder"
                aria-label={`Show ${basen(peek.path)} in folder`}
                onClick={() => void window.grokDesktop.showItem(peek.absPath)}
              >
                ↗
              </button>
              <button
                type="button"
                className="btn ghost btn-sm"
                title="Close peek"
                aria-label="Close peek"
                onClick={() => setPeek(null)}
              >
                ×
              </button>
            </div>
            <div className="file-peek-body">
              {peekLoading ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  Loading…
                </p>
              ) : peekError && peekError !== "Binary file" ? (
                <p style={{ color: "var(--danger, #f87171)", fontSize: 13 }}>
                  {peekError}
                </p>
              ) : peek.kind === "diff" && peekDiff && shouldRenderDiff(peekDiff) ? (
                <DiffView diff={peekDiff} className="file-peek-diff" />
              ) : peek.kind === "diff" ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  No textual diff.
                </p>
              ) : peekIsBinary || peekError === "Binary file" ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  Binary file.
                </p>
              ) : peekFileText != null ? (
                <pre className="file-peek-text">{redact(peekFileText)}</pre>
              ) : null}
            </div>
          </div>
        ) : null}
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
                  <pre className="task-out">
                    {redact(stripAnsi(t.outputSnippet))}
                  </pre>
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
});
