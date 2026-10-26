import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  isLexicallyUnder,
  normalizePathKey,
  parentDir,
  relativeDisplay,
  samePathKey,
} from "../lib/path-utils";
import type { BackgroundTask } from "../lib/background-tasks";
import { hasAnyTasks, runningTaskCount } from "../lib/background-tasks";
import { usePrivacy } from "../lib/privacy-context";
import { stripAnsi } from "../lib/tool-display";
import { ColToggle } from "./ColToggle";
import { useI18n } from "../lib/i18n";
import { FileBrowser, useProjectFiles } from "./files/FileBrowser";
import { FilePeek } from "./files/FilePeek";
import { useFileDocument } from "./files/useFileDocument";
import {
  joinProjectPath,
  visibleGitChanges,
  type FileEntry,
  type GitStatusEntry,
} from "./files/types";

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
  collapsed,
  onToggleCollapsed,
  inert: shellInert,
}: {
  project: string | null;
  backgroundTasks: BackgroundTask[];
  /** e.g. "plan" when plan mode is active */
  sessionMode: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  inert?: boolean;
}) {
  const { redact } = usePrivacy();
  const { t } = useI18n();
  const running = runningTaskCount(backgroundTasks);
  const hasTasks = hasAnyTasks(backgroundTasks);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("files");
  const [hideIgnored, setHideIgnored] = useState(true);
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
    ? t("files.tasksCount", { n: running })
    : hasTasks
      ? t("files.tasksCount", { n: backgroundTasks.length })
      : t("files.tasks");

  const visibleChanges = visibleGitChanges(files.changes, hideIgnored);
  const changesLabel =
    visibleChanges.length > 0
      ? t("files.changesCount", { n: visibleChanges.length })
      : t("files.changes");

  const peekRef = useRef(peek);
  peekRef.current = peek;
  const browseRef = useRef(files.browseCwd);
  browseRef.current = files.browseCwd;
  const loadDirRef = useRef(files.loadDir);
  loadDirRef.current = files.loadDir;

  const openLinkedFile = useCallback(
    (absPath: string) => {
      if (!project || !isLexicallyUnder(project, absPath)) return false;
      const current = peekRef.current.doc;
      if (
        current?.kind === "file" &&
        normalizePathKey(current.absPath) === normalizePathKey(absPath)
      ) {
        return true;
      }
      const opened = peekRef.current.openPeek({
        kind: "file",
        path: relativeDisplay(project, absPath),
        absPath,
      });
      if (!opened) return false;
      const parent = parentDir(absPath);
      const browseCwd = browseRef.current;
      if (
        parent &&
        browseCwd &&
        !samePathKey(parent, browseCwd) &&
        isLexicallyUnder(project, parent)
      ) {
        void loadDirRef.current(parent);
      }
      return true;
    },
    [project],
  );

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
    if (entry.untracked || entry.ignored) {
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
    <aside
      className={"panel" + (collapsed ? " panel--collapsed" : "")}
      inert={shellInert || undefined}
    >
      <div className="panel-tabs" role="tablist" aria-label={t("panel.aria")}>
        <ColToggle
          collapsed={collapsed}
          expandToward="left"
          labelExpand={t("panel.expand")}
          labelCollapse={t("panel.collapse")}
          onClick={onToggleCollapsed}
        />
        {collapsed ? (
          running > 0 ? (
            <span
              className="rail-badge"
              title={t(running === 1 ? "panel.runningOne" : "panel.running", {
                n: running,
              })}
            >
              {running}
            </span>
          ) : null
        ) : (
          <>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "files"}
          className={tab === "files" ? "active" : ""}
          onClick={() => {
            if (tab === "files") {
              if (project) void files.reloadCurrent();
              return;
            }
            if (!peek.confirmLeave()) return;
            setTab("files");
            peek.reset();
          }}
        >
          {t("files.files")}
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
          </>
        )}
      </div>
      {collapsed ? null : (
      <>
      <div className="panel-main">
        <div className="panel-body">
          {sessionMode === "plan" ? (
            <div className="mode-banner plan-mode-banner" role="status">
              Plan mode — file edits blocked until you approve a plan
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
              onRefresh={() => {
                if (tab === "files") void files.reloadCurrent();
                else if (project) void files.loadChanges(project);
              }}
              hideIgnored={hideIgnored}
              onHideIgnoredChange={setHideIgnored}
              isNavQuiet={files.isNavQuiet}
            />
          )}
        </div>
        {peek.doc && project ? (
          <FilePeek
            doc={peek.doc}
            project={project}
            editorLabel={editorLabel}
            copied={copiedKey === peek.doc.absPath}
            saving={peek.saving}
            saveError={peek.saveError}
            openError={peek.openError}
            onDraftChange={peek.setDraft}
            onSave={() => void peek.savePeek()}
            onOpenEditor={() => void peek.openEditor(peek.doc!.absPath)}
            onOpenLinkedFile={openLinkedFile}
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
                ? t("panel.collapseTasks")
                : t("panel.expandTasks")
              : t("panel.noTasks")
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
            aria-label={t("panel.tasks")}
          >
            {backgroundTasks.map((task) => (
              <div key={task.id} className={`task-card status-${task.status}`}>
                <div className="task-card-top">
                  <span className="task-kind">{task.kind}</span>
                  <span className={`task-status status-${task.status}`}>
                    {String(task.status) === "running"
                      ? t("task.running")
                      : String(task.status) === "completed"
                        ? t("task.completed")
                        : String(task.status) === "failed"
                          ? t("task.failed")
                          : String(task.status) === "cancelled"
                            ? t("task.cancelled")
                            : task.status}
                  </span>
                </div>
                <h3 className="task-title" title={redact(task.title)}>
                  {redact(task.title)}
                </h3>
                {task.detail ? (
                  <div className="task-detail" title={redact(task.detail)}>
                    {redact(task.detail)}
                  </div>
                ) : null}
                {task.command && task.command !== task.title ? (
                  <pre className="task-cmd">{redact(task.command)}</pre>
                ) : null}
                {task.outputSnippet ? (
                  <pre className="task-out">
                    {redact(stripAnsi(task.outputSnippet))}
                  </pre>
                ) : null}
                {task.exitCode != null ? (
                  <div className="task-meta">
                    {t("task.exit", { code: task.exitCode })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      </>
      )}
    </aside>
  );
});
