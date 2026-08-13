import { memo, useCallback, useEffect, useRef, useState } from "react";
import { normalizePathKey } from "../lib/path-utils";
import type { BackgroundTask } from "../lib/background-tasks";
import { hasAnyTasks, runningTaskCount } from "../lib/background-tasks";
import { usePrivacy } from "../lib/privacy-context";
import { stripAnsi } from "../lib/tool-display";
import { FileBrowser, useProjectFiles } from "./files/FileBrowser";
import { FilePeek } from "./files/FilePeek";
import { useFileDocument } from "./files/useFileDocument";
import { joinProjectPath, type FileEntry, type GitStatusEntry } from "./files/types";

type PanelTab = "files" | "changes";

/**
 * Right rail: project file browser + git Changes + background Tasks dock.
 * Tool approvals live inline in the chat timeline (not here).
 */
export const SidePanel = memo(function SidePanel({
  project,
  backgroundTasks,
  sessionMode,
  onDirtyChange,
  inert: shellInert,
}: {
  project: string | null;
  backgroundTasks: BackgroundTask[];
  /** e.g. "plan" when plan mode is active */
  sessionMode: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  inert?: boolean;
}) {
  const { redact } = usePrivacy();
  const running = runningTaskCount(backgroundTasks);
  const hasTasks = hasAnyTasks(backgroundTasks);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("files");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editorLabel, setEditorLabel] = useState("editor");
  const prevRunning = useRef(0);
  const copiedTimer = useRef<number | null>(null);

  const files = useProjectFiles(project);
  const reloadChanges = useCallback(() => {
    if (project) void files.loadChanges(project);
  }, [project, files.loadChanges]);

  const peek = useFileDocument({
    project,
    onDirtyChange,
    onAfterSave: reloadChanges,
  });

  const copyPath = useCallback(async (absPath: string) => {
    try {
      await navigator.clipboard.writeText(absPath);
      setCopiedKey(absPath);
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => {
        setCopiedKey(null);
        copiedTimer.current = null;
      }, 1400);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setTab("files");
  }, [project]);

  useEffect(() => {
    const refreshEditors = () => {
      void window.grokDesktop.listEditors().then((r) => {
        setEditorLabel(r.resolvedLabel || "editor");
      });
    };
    refreshEditors();
    window.addEventListener("focus", refreshEditors);
    return () => {
      window.removeEventListener("focus", refreshEditors);
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (running > 0 && running >= prevRunning.current) {
      setTasksOpen(true);
    }
    if (!hasTasks) {
      setTasksOpen(false);
    }
    prevRunning.current = running;
  }, [running, hasTasks]);

  const tasksLabel = running
    ? `Tasks (${running})`
    : hasTasks
      ? `Tasks (${backgroundTasks.length})`
      : "Tasks";

  const changesLabel =
    files.changes.length > 0 ? `Changes (${files.changes.length})` : "Changes";

  const selectFile = (file: FileEntry) => {
    if (file.isDirectory) {
      void files.loadDir(file.path);
      return;
    }
    if (
      peek.doc?.kind === "file" &&
      normalizePathKey(peek.doc.absPath) === normalizePathKey(file.path)
    ) {
      return;
    }
    peek.openPeek({ kind: "file", path: file.path, absPath: file.path });
  };

  const selectChange = (entry: GitStatusEntry) => {
    if (!project) return;
    const absPath = joinProjectPath(project, entry.path);
    if (entry.untracked) {
      peek.openPeek({ kind: "file", path: entry.path, absPath });
      return;
    }
    peek.openPeek({
      kind: "diff",
      path: entry.path,
      absPath,
      staged: entry.unstaged ? false : entry.staged,
    });
  };

  return (
    <aside className="panel" inert={shellInert || undefined}>
      <div className="panel-tabs" role="tablist" aria-label="Side panel">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "files"}
          className={tab === "files" ? "active" : ""}
          onClick={() => {
            if (tab === "files") return;
            if (!peek.confirmLeave()) return;
            setTab("files");
            peek.reset();
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
            if (tab === "changes") {
              if (project) void files.loadChanges(project);
              return;
            }
            if (!peek.confirmLeave()) return;
            setTab("changes");
            peek.reset();
            if (project) void files.loadChanges(project);
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
          ) : (
            <FileBrowser
              tab={tab}
              project={project}
              browseCwd={files.browseCwd}
              files={files.files}
              filesError={files.filesError}
              filesLoading={files.filesLoading}
              changes={files.changes}
              changesError={files.changesError}
              changesLoading={files.changesLoading}
              selectedAbsPath={peek.doc?.absPath ?? null}
              selectedRelPath={peek.doc?.path ?? null}
              editorLabel={editorLabel}
              copiedKey={copiedKey}
              openError={peek.openError}
              onSelectFile={selectFile}
              onSelectChange={selectChange}
              onOpenEditor={(abs) => void peek.openEditor(abs)}
              onCopyPath={(abs) => void copyPath(abs)}
              onNavigate={(dir) => void files.loadDir(dir)}
              isNavQuiet={files.isNavQuiet}
            />
          )}
        </div>
        {peek.doc && project ? (
          <FilePeek
            doc={peek.doc}
            editorLabel={editorLabel}
            copied={copiedKey === peek.doc.absPath}
            saving={peek.saving}
            saveError={peek.saveError}
            openError={peek.openError}
            onDraftChange={peek.setDraft}
            onSave={() => void peek.savePeek()}
            onOpenEditor={() => void peek.openEditor(peek.doc!.absPath)}
            onCopyPath={() => void copyPath(peek.doc!.absPath)}
            onClose={peek.closePeek}
          />
        ) : null}
      </div>

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
