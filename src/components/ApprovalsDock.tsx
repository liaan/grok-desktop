import { memo } from "react";
import { classifyOptionId } from "../../shared/permission-options.mjs";
import { formatOptionLabel } from "../lib/timeline";
import type { PermissionRequest } from "../vite-env";

/**
 * Sticky dock under the timeline: agent escalations must stay visible while
 * the turn shows "Working…" and the tool card may still look in_progress.
 */
export const ApprovalsDock = memo(function ApprovalsDock({
  permissions,
  onPermission,
  onAllowAll,
  onAllowWritesThisSession,
}: {
  permissions: PermissionRequest[];
  onPermission: (reqId: string, optionId: string | "cancelled") => void;
  onAllowAll: () => void;
  onAllowWritesThisSession?: () => void;
}) {
  if (permissions.length === 0) return null;

  return (
    <div
      className="approvals-dock"
      role="region"
      aria-label="Tool approvals required"
    >
      <div className="approvals-dock-head">
        <strong>
          {permissions.length === 1
            ? "Approval required"
            : `${permissions.length} approvals required`}
        </strong>
        <span className="approvals-dock-hint">
          Reads and browsing are auto-allowed. This is an edit, post, or
          changing command — the agent is blocked until you choose.
        </span>
        {permissions.length > 1 ? (
          <button
            type="button"
            className="btn primary btn-sm"
            onClick={() => onAllowAll()}
          >
            Allow all once
          </button>
        ) : null}
        {onAllowWritesThisSession ? (
          <button
            type="button"
            className="btn btn-sm"
            title="Auto-allow remaining edits, posts, and shells in this chat"
            onClick={() => onAllowWritesThisSession()}
          >
            Allow writes this session
          </button>
        ) : null}
      </div>
      <div className="approvals-dock-list">
        {permissions.map((p) => {
          const tool = p.params?.toolCall;
          const title = tool?.title || tool?.kind || "Tool needs approval";
          const options = p.params?.options?.length
            ? p.params.options
            : [
                { optionId: "allow-once", name: "Allow once" },
                { optionId: "reject", name: "Reject" },
              ];
          return (
            <div key={p.reqId} className="approvals-dock-item">
              <div className="approvals-dock-title" title={title}>
                {title}
              </div>
              <div className="approvals-dock-actions">
                {options.map((opt) => {
                  const cls = classifyOptionId(opt.optionId, options);
                  const allow =
                    cls === "allow_once" || cls === "allow_always";
                  return (
                    <button
                      key={opt.optionId}
                      type="button"
                      className={allow ? "btn primary btn-sm" : "btn btn-sm"}
                      onClick={() => onPermission(p.reqId, opt.optionId)}
                    >
                      {formatOptionLabel(opt.optionId, opt.name)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="btn danger btn-sm"
                  onClick={() => onPermission(p.reqId, "cancelled")}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
