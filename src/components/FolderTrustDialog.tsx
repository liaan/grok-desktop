import { useEffect, useRef } from "react";
import { usePrivacy } from "../lib/privacy-context";

export type FolderTrustRequest = {
  reqId: string;
  cwd?: string;
  workspace?: string;
  configKinds?: string[];
};

/**
 * Grok `x.ai/folder_trust/request` — same gate as TUI /hooks-trust.
 * Project MCP and hooks stay unloaded until Trust.
 */
export function FolderTrustDialog({
  request,
  onRespond,
}: {
  request: FolderTrustRequest | null;
  onRespond: (
    reqId: string,
    decision: { outcome: "trust" | "reject" },
  ) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { redact } = usePrivacy();

  useEffect(() => {
    if (!request) return;
    closeRef.current?.focus();
  }, [request?.reqId]);

  if (!request) return null;

  const folder = request.workspace || request.cwd || "";
  const kinds = (request.configKinds || []).filter(Boolean);
  const kindLabel = kinds.length
    ? kinds.join(", ")
    : "project MCP, hooks, or LSP";

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      data-modal-layer="overlay"
    >
      <div
        className="modal-dialog worktree-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-trust-title"
      >
        <div className="modal-header">
          <h2 id="folder-trust-title">Trust this folder?</h2>
          <button
            ref={closeRef}
            type="button"
            className="btn ghost btn-sm"
            aria-label="Don't trust"
            onClick={() => onRespond(request.reqId, { outcome: "reject" })}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="worktree-lead">
            This workspace has project config ({kindLabel}). Grok will not load
            those until you trust the folder — same as TUI{" "}
            <code>/hooks-trust</code>.
          </p>
          {folder ? (
            <p className="worktree-path" title={redact(folder)}>
              {redact(folder)}
            </p>
          ) : null}
        </div>
        <div className="modal-footer plan-approval-footer">
          <button
            type="button"
            className="btn"
            onClick={() => onRespond(request.reqId, { outcome: "reject" })}
          >
            Don&apos;t trust
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => onRespond(request.reqId, { outcome: "trust" })}
          >
            Trust folder
          </button>
        </div>
      </div>
    </div>
  );
}
