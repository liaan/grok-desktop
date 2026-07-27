import { useCallback, useEffect, useRef, useState } from "react";
import { formatToolDisplay } from "../lib/tool-display";
import {
  basen,
  isLexicallyUnder,
  normalizePathKey,
  parentDir,
  relativeDisplay,
} from "../lib/path-utils";
import type { PermissionRequest } from "../vite-env";
import { formatOptionLabel } from "../lib/timeline";

type FileEntry = { name: string; isDirectory: boolean; path: string };

export function SidePanel({
  project,
  permissions,
  onPermission,
}: {
  project: string | null;
  permissions: PermissionRequest[];
  onPermission: (reqId: string, optionId: string | "cancelled") => void;
}) {
  const [tab, setTab] = useState<"files" | "approvals">("approvals");
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
          className={tab === "files" ? "active" : ""}
          onClick={() => setTab("files")}
        >
          Files
        </button>
      </div>
      <div className="panel-body">
        {tab === "approvals" && (
          <>
            {permissions.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Tool approvals appear here when the agent needs permission.
              </p>
            ) : (
              permissions.map((p) => {
                const tool = p.params?.toolCall;
                const options = p.params?.options?.length
                  ? p.params.options
                  : [
                      { optionId: "allow-once", name: "Allow once" },
                      { optionId: "reject", name: "Reject" },
                    ];
                const display = formatToolDisplay({
                  title: tool?.title,
                  raw: tool?.rawInput,
                });
                return (
                  <div key={p.reqId} className="perm-card">
                    <h3>{tool?.title || "Permission required"}</h3>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {tool?.kind || "tool"} · {tool?.toolCallId || p.reqId}
                    </div>
                    {display.subtitle ? (
                      <div className="tool-subtitle" style={{ marginTop: 6 }}>
                        {display.subtitle}
                      </div>
                    ) : null}
                    {display.input ? (
                      <pre className="tool-input" style={{ marginTop: 8 }}>
                        {display.input}
                      </pre>
                    ) : null}
                    <div className="perm-actions">
                      {options.map((opt) => (
                        <button
                          key={opt.optionId}
                          type="button"
                          className={
                            opt.optionId.includes("allow")
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
              })
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
                <div className="file-browser-path" title={browseCwd || project}>
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
                          ? `Open folder: ${f.path}`
                          : `Open: ${f.path}`
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
