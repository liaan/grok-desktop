import { memo } from "react";
import type { SessionUsage } from "../lib/usage";
import { formatUsageBar, formatUsageTooltip } from "../lib/usage";
import { useI18n } from "../lib/i18n";

/**
 * Bottom status strip for the main column — privacy, token usage, git branch.
 */
export const StatusBar = memo(function StatusBar({
  privacyMode,
  onOpenSettings,
  gitBranch,
  gitDetached,
  sessionUsage,
}: {
  privacyMode: boolean;
  onOpenSettings: () => void;
  gitBranch: string | null;
  gitDetached: boolean;
  sessionUsage?: SessionUsage | null;
}) {
  const { t } = useI18n();
  const usageLabel = sessionUsage ? formatUsageBar(sessionUsage) : "";
  const usageTip = sessionUsage
    ? formatUsageTooltip(sessionUsage)
    : t("status.usageHint");

  return (
    <footer className="status-bar" role="status" aria-label={t("status.aria")}>
      <div className="status-bar-left">
        {privacyMode ? (
          <button
            type="button"
            className="status-bar-chip privacy"
            title={t("status.privacy")}
            onClick={onOpenSettings}
          >
            {t("general.privacy")}
          </button>
        ) : null}
        {usageLabel ? (
          <span className="status-bar-usage" title={usageTip}>
            {usageLabel}
          </span>
        ) : (
          <span className="status-bar-usage muted" title={usageTip}>
            {t("status.usageEmpty")}
          </span>
        )}
      </div>
      <div className="status-bar-right">
        {gitBranch ? (
          <span
            className={`status-bar-git ${gitDetached ? "detached" : ""}`}
            title={
              gitDetached
                ? t("status.detached", { branch: gitBranch })
                : t("status.branch", { branch: gitBranch })
            }
          >
            <span className="status-bar-git-icon" aria-hidden>
              ⎇
            </span>
            <span className="status-bar-git-name">{gitBranch}</span>
            {gitDetached ? (
              <span className="status-bar-git-detached">detached</span>
            ) : null}
          </span>
        ) : (
          <span className="status-bar-git muted" title={t("status.notGit")}>
            <span className="status-bar-git-icon" aria-hidden>
              ⎇
            </span>
            <span className="status-bar-git-name">no git</span>
          </span>
        )}
      </div>
    </footer>
  );
});
