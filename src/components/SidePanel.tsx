import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
type CtxMenu = {
  x: number;
  y: number;
  path: string;
  absPath: string;
  isDir: boolean;
};

const PEEK_CHAR_CAP = 200_000;

function joinProjectPath(root: string, rel: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const p = String(rel || "").replace(/\\/g, "/");
  if (!p) return r;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return rel;
  const sep = root.includes("\\") ? "\\" : "/";
  return `${r}${sep}${p.replace(/\//g, sep)}`;
}

function FileRowActions({
  absPath,
  name,
  editorLabel,
  copied,
  isDir,
  onEdit,
  onCopy,
}: {
  absPath: string;
  name: string;
  editorLabel: string;
  copied: boolean;
  isDir: boolean;
  onEdit: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="file-actions">
      {!isDir ? (
      <button
        type="button"
        className="btn ghost btn-sm file-action"
        title={`Open in ${editorLabel}`}
        aria-label={`Open ${name} in ${editorLabel}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        Edit
      </button>
      ) : null}
      <button
        type="button"
        className="btn ghost btn-sm file-action"
        title="Copy path"
        aria-label={`Copy path of ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        className="btn ghost btn-sm file-reveal"
        title="Show in folder"
        aria-label={`Show ${name} in folder`}
        onClick={(e) => {
          e.stopPropagation();
          void window.grokDesktop.showItem(absPath);
        }}
      >
        ↗
      </button>
    </div>
  );
}

/**
 * Right rail: project file browser + git Changes + background Tasks dock.
 * Tool approvals live inline in the chat timeline (not here).
 */
export const SidePanel = memo(function SidePanel({
  project,
  backgroundTasks,
  sessionMode,
  onDirtyChange,
}: {
  project: string | null;
  backgroundTasks: BackgroundTask[];
  /** e.g. "plan" when plan mode is active */
  sessionMode: string | null;
  onDirtyChange?: (dirty: boolean) => void;
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
  const [draft, setDraft] = useState("");
  const [savedText, setSavedText] = useState<string | null>(null);
  const [peekBinary, setPeekBinary] = useState(false);
  const [peekTruncated, setPeekTruncated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [editorLabel, setEditorLabel] = useState("editor");
  /** Monotonic id so out-of-order listDir results are ignored. */
  const loadSeq = useRef(0);
  const changesSeq = useRef(0);
  const peekSeq = useRef(0);
  const prevRunning = useRef(0);
  const copiedTimer = useRef<number | null>(null);
  /** Ignore click/dblclick after a folder navigate — listDir replaces rows
   *  inside the double-click window so the second event hits a new file. */
  const navQuietUntil = useRef(0);

  const isNavQuiet = () => Date.now() < navQuietUntil.current;

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
      navQuietUntil.current = Date.now() + 350;
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

  const dirty =
    peek?.kind === "file" &&
    !peekBinary &&
    !peekTruncated &&
    savedText != null &&
    draft !== savedText;

  const canEditFile =
    peek?.kind === "file" &&
    !peekBinary &&
    !peekTruncated &&
    !peekLoading &&
    !peekError;

  const confirmLeave = useCallback(() => {
    if (!dirty) return true;
    return window.confirm("Discard unsaved edits?");
  }, [dirty]);

  const openPeek = useCallback(
    (next: PeekState) => {
      if (!confirmLeave()) return;
      setSaveError(null);
      setOpenError(null);
      setPeek(next);
    },
    [confirmLeave],
  );

  const closePeek = useCallback(() => {
    if (!confirmLeave()) return;
    setPeek(null);
    setSaveError(null);
    setOpenError(null);
  }, [confirmLeave]);

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

  const openEditor = useCallback(
    async (absPath: string) => {
      if (
        dirty &&
        peek?.kind === "file" &&
        normalizePathKey(peek.absPath) === normalizePathKey(absPath)
      ) {
        if (
          !window.confirm(
            "This file has unsaved edits. Open the on-disk version anyway?",
          )
        ) {
          return;
        }
        try {
          const res = await window.grokDesktop.readFile(absPath);
          setDraft(res.text);
          setSavedText(res.text);
          setPeekText(res.text);
          setPeekBinary(res.binary);
          setPeekTruncated(res.truncated);
        } catch {
          /* still open the editor; next save will error if unreadable */
        }
      }
      setOpenError(null);
      try {
        await window.grokDesktop.openInEditor(absPath);
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : String(err));
      }
    },
    [dirty, peek],
  );

  const savePeek = useCallback(async () => {
    if (!peek || peek.kind !== "file" || !canEditFile) return;
    setSaving(true);
    setSaveError(null);
    try {
      await window.grokDesktop.writeFile(peek.absPath, draft);
      setSavedText(draft);
      setPeekText(draft);
      if (project) void loadChanges(project);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [peek, canEditFile, draft, project, loadChanges]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!canEditFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.closest(".file-peek")) return;
      if (
        t.closest(".settings-page, .modal-backdrop, [role='dialog']") &&
        !t.closest(".file-peek")
      ) {
        return;
      }
      e.preventDefault();
      void savePeek();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEditFile, savePeek]);

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
    setDraft("");
    setSavedText(null);
    setPeekBinary(false);
    setPeekTruncated(false);
    setSaveError(null);
    setOpenError(null);
    setCtxMenu(null);
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
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!peek || !project) {
      setPeekText(null);
      setPeekError(null);
      setPeekLoading(false);
      setDraft("");
      setSavedText(null);
      setPeekBinary(false);
      setPeekTruncated(false);
      return;
    }
    const seq = ++peekSeq.current;
    setPeekLoading(true);
    setPeekError(null);
    setPeekText(null);
    setDraft("");
    setSavedText(null);
    setPeekBinary(false);
    setPeekTruncated(false);
    setSaveError(null);
    const run = async () => {
      try {
        if (peek.kind === "file") {
          const res = await window.grokDesktop.readFile(peek.absPath);
          if (seq !== peekSeq.current) return;
          setPeekText(res.text);
          setDraft(res.text);
          setSavedText(res.text);
          setPeekBinary(res.binary);
          setPeekTruncated(res.truncated);
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
  const peekIsBinary = peekBinary || Boolean(peekText && peekText.includes("\u0000"));

  const openFileMenu = (
    e: ReactMouseEvent,
    info: { path: string; absPath: string; isDir: boolean },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const w = 200;
    const h = 160;
    setCtxMenu({
      ...info,
      x: Math.min(e.clientX, window.innerWidth - w - pad),
      y: Math.min(e.clientY, window.innerHeight - h - pad),
    });
  };

  const selectFile = (file: FileEntry) => {
    if (file.isDirectory) {
      void loadDir(file.path);
      return;
    }
    if (
      peek?.kind === "file" &&
      normalizePathKey(peek.absPath) === normalizePathKey(file.path)
    ) {
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
            if (tab === "files") return;
            if (!confirmLeave()) return;
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
            if (tab === "changes") {
              if (project) void loadChanges(project);
              return;
            }
            if (!confirmLeave()) return;
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
              <p className="file-browser-hint">
                Click to edit here. Double-click opens in {editorLabel}.
              </p>
              {openError && tab === "files" ? (
                <p style={{ color: "var(--danger, #f87171)", fontSize: 12 }}>
                  {openError}
                </p>
              ) : null}
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
                    onContextMenu={(e) =>
                      openFileMenu(e, {
                        path: f.path,
                        absPath: f.path,
                        isDir: f.isDirectory,
                      })
                    }
                  >
                    <button
                      type="button"
                      className={`file-item ${f.isDirectory ? "file-item-dir" : "file-item-file"}`}
                      title={
                        f.isDirectory
                          ? `Open folder: ${redact(f.path)}`
                          : `Edit: ${redact(f.path)}`
                      }
                      onClick={(e) => {
                        if (isNavQuiet() || e.detail > 1) return;
                        selectFile(f);
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        if (isNavQuiet() || f.isDirectory) return;
                        void openEditor(f.path);
                      }}
                    >
                      <span className="file-item-icon" aria-hidden>
                        {f.isDirectory ? "📁" : "📄"}
                      </span>
                      <span className="file-item-name">{f.name}</span>
                    </button>
                    <FileRowActions
                      absPath={f.path}
                      name={f.name}
                      editorLabel={editorLabel}
                      copied={copiedKey === f.path}
                      isDir={f.isDirectory}
                      onEdit={() => void openEditor(f.path)}
                      onCopy={() => void copyPath(f.path)}
                    />
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {openError && tab === "changes" ? (
                <p style={{ color: "var(--danger, #f87171)", fontSize: 12 }}>
                  {openError}
                </p>
              ) : null}
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
                const abs = joinProjectPath(project, entry.path);
                return (
                  <div
                    key={`${entry.index}${entry.worktree}:${entry.path}`}
                    className={`file-row is-file${selected ? " is-selected" : ""}`}
                    onContextMenu={(e) =>
                      openFileMenu(e, {
                        path: entry.path,
                        absPath: abs,
                        isDir: false,
                      })
                    }
                  >
                    <button
                      type="button"
                      className="file-item file-item-file"
                      title={redact(entry.path)}
                      onClick={(e) => {
                        if (e.detail > 1) return;
                        selectChange(entry);
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        void openEditor(abs);
                      }}
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
                    <FileRowActions
                      absPath={abs}
                      name={entry.path}
                      editorLabel={editorLabel}
                      copied={copiedKey === abs}
                      isDir={false}
                      onEdit={() => void openEditor(abs)}
                      onCopy={() => void copyPath(abs)}
                    />
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
                {dirty ? "• " : ""}
                {basen(peek.path)}
              </span>
              {canEditFile ? (
                <button
                  type="button"
                  className="btn ghost btn-sm"
                  title="Save (⌘S)"
                  disabled={!dirty || saving}
                  onClick={() => void savePeek()}
                >
                  {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                </button>
              ) : null}
              <button
                type="button"
                className="btn ghost btn-sm"
                title={`Open in ${editorLabel}`}
                onClick={() => void openEditor(peek.absPath)}
              >
                {editorLabel}
              </button>
              <button
                type="button"
                className="btn ghost btn-sm"
                title="Copy path"
                onClick={() => void copyPath(peek.absPath)}
              >
                {copiedKey === peek.absPath ? "Copied" : "Copy"}
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
                title="Close"
                aria-label="Close"
                onClick={() => closePeek()}
              >
                ×
              </button>
            </div>
            {saveError || openError ? (
              <p className="file-peek-error">{saveError || openError}</p>
            ) : null}
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
                  Binary file — open it in {editorLabel} instead.
                </p>
              ) : peekTruncated ? (
                <>
                  <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    File is too large to edit here. Open it in {editorLabel}.
                  </p>
                  {peekFileText != null ? (
                    <pre className="file-peek-text">{redact(peekFileText)}</pre>
                  ) : null}
                </>
              ) : canEditFile ? (
                <textarea
                  className="file-peek-editor"
                  value={draft}
                  spellCheck={false}
                  aria-label={`Edit ${basen(peek.path)}`}
                  onChange={(e) => setDraft(e.target.value)}
                />
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
      {ctxMenu ? (
        <div
          className="file-ctx-menu"
          role="menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!ctxMenu.isDir ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void openEditor(ctxMenu.absPath);
              setCtxMenu(null);
            }}
          >
            Open in {editorLabel}
          </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void copyPath(ctxMenu.absPath);
              setCtxMenu(null);
            }}
          >
            Copy path
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void window.grokDesktop.showItem(ctxMenu.absPath);
              setCtxMenu(null);
            }}
          >
            Show in folder
          </button>
        </div>
      ) : null}
    </aside>
  );
});
