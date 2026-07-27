import { useEffect, useState } from "react";
import type { PermissionRequest } from "../vite-env";
import { formatOptionLabel } from "../lib/timeline";

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
  const [files, setFiles] = useState<
    Array<{ name: string; isDirectory: boolean; path: string }>
  >([]);

  useEffect(() => {
    if (!project) return;
    window.grokDesktop.listDir(project).then(setFiles).catch(() => setFiles([]));
  }, [project]);

  useEffect(() => {
    if (permissions.length > 0) setTab("approvals");
  }, [permissions.length]);

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button
          className={tab === "approvals" ? "active" : ""}
          onClick={() => setTab("approvals")}
        >
          Approvals{permissions.length ? ` (${permissions.length})` : ""}
        </button>
        <button
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
                return (
                  <div key={p.reqId} className="perm-card">
                    <h3>{tool?.title || "Permission required"}</h3>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {tool?.kind || "tool"} · {tool?.toolCallId || p.reqId}
                    </div>
                    {tool?.rawInput !== undefined && (
                      <pre>
                        {typeof tool.rawInput === "string"
                          ? tool.rawInput
                          : JSON.stringify(tool.rawInput, null, 2)}
                      </pre>
                    )}
                    <div className="perm-actions">
                      {options.map((opt) => (
                        <button
                          key={opt.optionId}
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
              files.map((f) => (
                <button
                  key={f.path}
                  className="file-item"
                  onClick={() =>
                    f.isDirectory
                      ? window.grokDesktop.openPath(f.path)
                      : window.grokDesktop.showItem(f.path)
                  }
                  title={f.path}
                >
                  <span>{f.isDirectory ? "📁" : "📄"}</span>
                  <span>{f.name}</span>
                </button>
              ))
            )}
          </>
        )}
      </div>
    </aside>
  );
}
