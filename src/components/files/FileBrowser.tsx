import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  basen,
  isLexicallyUnder,
  normalizePathKey,
  parentDir,
  relativeDisplay,
} from "../../lib/path-utils";
import { usePrivacy } from "../../lib/privacy-context";
import { RefreshIcon } from "../BrandMark";
import {
  joinProjectPath,
  visibleGitChanges,
  type FileEntry,
  type GitStatusEntry,
} from "./types";

type CtxMenu = {
  x: number;
  y: number;
  path: string;
  absPath: string;
  isDir: boolean;
};

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

export function useProjectFiles(project: string | null) {
  const [browseCwd, setBrowseCwd] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [changes, setChanges] = useState<GitStatusEntry[]>([]);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const loadSeq = useRef(0);
  const changesSeq = useRef(0);
  /** Ignore leftover clicks after listDir replaces rows inside a double-click. */
  const navQuietUntil = useRef(0);

  const isNavQuiet = useCallback(() => Date.now() < navQuietUntil.current, []);

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

  useEffect(() => {
    loadSeq.current += 1;
    changesSeq.current += 1;
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

  const reloadCurrent = useCallback(() => {
    if (!project) return Promise.resolve();
    return loadDir(browseCwd || project);
  }, [project, browseCwd, loadDir]);

  useEffect(() => {
    if (!project) return;
    const onFocus = () => {
      void loadDir(browseCwd || project);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [project, browseCwd, loadDir]);

  return {
    browseCwd,
    files,
    filesError,
    filesLoading,
    changes,
    changesError,
    changesLoading,
    loadDir,
    loadChanges,
    reloadCurrent,
    isNavQuiet,
  };
}

export function FileBrowser({
  tab,
  project,
  browseCwd,
  files,
  filesError,
  filesLoading,
  changes,
  changesError,
  changesLoading,
  selectedAbsPath,
  selectedRelPath,
  editorLabel,
  copiedKey,
  openError,
  onSelectFile,
  onSelectChange,
  onOpenEditor,
  onCopyPath,
  onNavigate,
  onRefresh,
  hideIgnored,
  onHideIgnoredChange,
  isNavQuiet,
}: {
  tab: "files" | "changes";
  project: string;
  browseCwd: string | null;
  files: FileEntry[];
  filesError: string | null;
  filesLoading: boolean;
  changes: GitStatusEntry[];
  changesError: string | null;
  changesLoading: boolean;
  selectedAbsPath: string | null;
  selectedRelPath: string | null;
  editorLabel: string;
  copiedKey: string | null;
  openError: string | null;
  onSelectFile: (file: FileEntry) => void;
  onSelectChange: (entry: GitStatusEntry) => void;
  onOpenEditor: (absPath: string) => void;
  onCopyPath: (absPath: string) => void;
  onNavigate: (dir: string) => void;
  onRefresh: () => void;
  hideIgnored: boolean;
  onHideIgnoredChange: (next: boolean) => void;
  isNavQuiet: () => boolean;
}) {
  const { redact } = usePrivacy();
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

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

  const atProjectRoot =
    Boolean(project && browseCwd) &&
    normalizePathKey(project) === normalizePathKey(browseCwd!);
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
  const visibleChanges = visibleGitChanges(changes, hideIgnored);
  const ignoredChangeCount = changes.filter((c) => c.ignored).length;
  const listingBusy = tab === "files" ? filesLoading : changesLoading;
  const refreshBtn = (
    <button
      type="button"
      className={
        "btn ghost btn-sm file-refresh-btn" +
        (listingBusy ? " is-loading" : "")
      }
      title={tab === "files" ? "Refresh files" : "Refresh changes"}
      aria-label={tab === "files" ? "Refresh files" : "Refresh changes"}
      aria-busy={listingBusy}
      disabled={listingBusy}
      onClick={onRefresh}
    >
      <RefreshIcon size={14} />
    </button>
  );

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

  return (
    <>
      {tab === "files" ? (
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
                onClick={() => upPath && onNavigate(upPath)}
              >
                ↑
              </button>
            ) : null}
            <span className="file-browser-label">{pathLabel}</span>
            {refreshBtn}
          </div>
          <p className="file-browser-hint">
            Click a file to preview. Edit opens it in {editorLabel}.
          </p>
          {openError ? (
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
              selectedAbsPath != null &&
              !f.isDirectory &&
              normalizePathKey(selectedAbsPath) === normalizePathKey(f.path);
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
                      : `Preview: ${redact(f.path)}`
                  }
                  onClick={(e) => {
                    if (e.detail > 1 || isNavQuiet()) return;
                    onSelectFile(f);
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
                  onEdit={() => onOpenEditor(f.path)}
                  onCopy={() => onCopyPath(f.path)}
                />
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div className="file-browser-path">
            <span className="file-browser-label">Local changes</span>
            <label className="hide-ignored">
              <input
                type="checkbox"
                checked={hideIgnored}
                onChange={(e) => onHideIgnoredChange(e.target.checked)}
              />
              Hide ignored
            </label>
            {refreshBtn}
          </div>
          {openError ? (
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
          {!changesLoading && !changesError && visibleChanges.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {hideIgnored && ignoredChangeCount
                ? `No local changes (${ignoredChangeCount} ignored hidden).`
                : "No local changes."}
            </p>
          ) : null}
          {visibleChanges.map((entry) => {
            const selected =
              selectedRelPath != null &&
              normalizePathKey(selectedRelPath) ===
                normalizePathKey(entry.path);
            const badge = entry.ignored
              ? "I"
              : entry.untracked || entry.status === "?"
                ? "U"
                : entry.status || "M";
            const badgeLabel =
              badge === "I"
                ? "Ignored"
                : badge === "U"
                  ? "Untracked"
                  : badge === "D"
                    ? "Deleted"
                    : badge === "A"
                      ? "Added"
                      : badge === "R"
                        ? "Renamed"
                        : "Modified";
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
                    if (e.detail > 1 || isNavQuiet()) return;
                    onSelectChange(entry);
                  }}
                >
                  <span
                    className={`change-badge change-badge-${
                      badge === "U"
                        ? "untracked"
                        : badge === "I"
                          ? "ignored"
                          : badge
                    }`}
                    title={badgeLabel}
                    aria-label={badgeLabel}
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
                  onEdit={() => onOpenEditor(abs)}
                  onCopy={() => onCopyPath(abs)}
                />
              </div>
            );
          })}
        </>
      )}
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
                onOpenEditor(ctxMenu.absPath);
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
              onCopyPath(ctxMenu.absPath);
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
    </>
  );
}
