import { memo } from "react";
import {
  classifyOptionId,
  permissionButtonClass,
} from "../../shared/permission-options.mjs";
import { localizeOptionLabel } from "../lib/permission-labels";
import type { PermissionRequest } from "../vite-env";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
  if (permissions.length === 0) return null;

  return (
    <div
      className="approvals-dock"
      role="region"
      aria-label={t("approvals.aria")}
    >
      <div className="approvals-dock-head">
        <strong>
          {permissions.length === 1
            ? t("approvals.required")
            : t("approvals.requiredN", { n: permissions.length })}
        </strong>
        <span className="approvals-dock-hint">{t("approvals.hint")}</span>
        {permissions.length > 1 ? (
          <button
            type="button"
            className="btn primary btn-sm"
            onClick={() => onAllowAll()}
          >
            {t("approvals.allowAll")}
          </button>
        ) : null}
        {onAllowWritesThisSession ? (
          <button
            type="button"
            className="btn btn-sm"
            title={t("approvals.allowWrites")}
            onClick={() => onAllowWritesThisSession()}
          >
            {t("approvals.allowSession")}
          </button>
        ) : null}
      </div>
      <div className="approvals-dock-list">
        {permissions.map((p) => {
          const tool = p.params?.toolCall;
          const title = tool?.title || tool?.kind || t("approvals.tool");
          const options: Array<{
            optionId: string;
            name: string;
            kind?: string;
          }> = p.params?.options?.length
            ? p.params.options
            : [
                { optionId: "allow-once", name: t("msg.allowOnce") },
                { optionId: "reject", name: t("msg.reject") },
              ];
          return (
            <div key={p.reqId} className="approvals-dock-item">
              <div className="approvals-dock-title" title={title}>
                {title}
              </div>
              <div className="approvals-dock-actions">
                {options.map((opt) => {
                  const cls = classifyOptionId(opt.optionId, options);
                  return (
                    <button
                      key={opt.optionId}
                      type="button"
                      className={permissionButtonClass(cls, { size: "sm" })}
                      onClick={() => onPermission(p.reqId, opt.optionId)}
                    >
                      {localizeOptionLabel(opt.optionId, opt.name, t, opt.kind)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="btn danger btn-sm"
                  onClick={() => onPermission(p.reqId, "cancelled")}
                >
                  {t("msg.cancel")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
