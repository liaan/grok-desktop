import { memo, useMemo } from "react";
import type { BackgroundTask } from "../lib/background-tasks";
import type { ConnState } from "../lib/conn";
import type { PermissionMode } from "../lib/permission-mode";
import type { ReasoningEffort } from "../lib/reasoning-effort";
import { basen } from "../lib/path-utils";
import { usePrivacy } from "../lib/privacy-context";
import type { AvailableModel } from "../vite-env";
import { ElevatedSafetyChips } from "./ElevatedSafetyChips";
import { useI18n } from "../lib/i18n";
import { Spinner } from "./BrandMark";

export const ChatTopbar = memo(function ChatTopbar({
  project,
  conn,
  statusLabel,
  isOpening,
  modelId,
  modelName,
  pendingModelId = null,
  modelSelectEpoch = 0,
  availableModels = [],
  permissionMode,
  reasoningEffort,
  sessionMode = null,
  allowOutsideProject,
  sandboxTerminal,
  privacyMode,
  backgroundTasks,
  onModel,
  onPermissionMode,
  onReasoningEffort,
  onOpenSettings,
  onOpenPreview,
  onCompress,
  hideThinking = true,
  onHideThinking,
  compacting = false,
  allowWritesThisSession,
  onRevokeWritesThisSession,
  onStop,
}: {
  project: string;
  conn: ConnState;
  statusLabel: string;
  isOpening: boolean;
  modelId?: string | null;
  modelName?: string | null;
  /** In-flight pick — drives the controlled value so the menu does not snap back mid-RPC. */
  pendingModelId?: string | null;
  modelSelectEpoch?: number;
  availableModels?: AvailableModel[];
  permissionMode: PermissionMode;
  reasoningEffort: ReasoningEffort;
  /** ACP session mode (`plan` while plan mode is on). */
  sessionMode?: string | null;
  allowOutsideProject: boolean;
  sandboxTerminal: boolean;
  privacyMode: boolean;
  backgroundTasks: BackgroundTask[];
  onModel?: (modelId: string) => void;
  onPermissionMode: (m: PermissionMode) => void;
  onReasoningEffort: (e: ReasoningEffort) => void;
  onOpenSettings: () => void;
  onOpenPreview?: () => void;
  /** Call the agent compact API (summarize older turns). */
  onCompress?: () => void;
  /** Fold thinking blocks in the transcript. Untick to show them in the scroll. */
  hideThinking?: boolean;
  onHideThinking?: (hide: boolean) => void;
  compacting?: boolean;
  allowWritesThisSession?: boolean;
  onRevokeWritesThisSession?: () => void;
  onStop: () => void;
}) {
  const { redact } = usePrivacy();
  const { t } = useI18n();
  const runningTasks = backgroundTasks.filter((t) => t.status === "running");
  const modelLabel = modelName || modelId || null;
  const modelTitle = modelId
    ? modelName && modelName !== modelId
      ? `${modelName} (${modelId})`
      : modelId
    : modelName || undefined;
  const selectModelId = pendingModelId || modelId || "";
  const modelOptions = useMemo(() => {
    const list = availableModels.slice();
    const ensure = (id: string | null | undefined, name?: string | null) => {
      if (id && !list.some((m) => m.modelId === id)) {
        list.unshift({ modelId: id, name: name || id });
      }
    };
    ensure(modelId, modelName);
    ensure(pendingModelId);
    return list;
  }, [availableModels, modelId, modelName, pendingModelId]);
  const canPickModel = Boolean(onModel) && modelOptions.length > 1;

  return (
    <div className="topbar">
      <div className="topbar-main">
        <div className="topbar-project">
          <div className="topbar-title">{basen(project)}</div>
          <div className="cwd" title={redact(project)}>
            {redact(project)}
          </div>
        </div>
        <div className="topbar-actions row">
        {canPickModel ? (
          <label
            className="perm-mode-topbar"
            title={modelTitle || t("topbar.modelAria")}
          >
            <span className="perm-mode-topbar-label">{t("topbar.model")}</span>
            <select
              className="perm-mode-select"
              key={`${modelId || "none"}:${modelSelectEpoch}`}
              value={selectModelId}
              disabled={Boolean(pendingModelId)}
              aria-label={t("topbar.modelAria")}
              onChange={(e) => onModel?.(e.target.value)}
            >
              {modelOptions.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.name || m.modelId}
                </option>
              ))}
            </select>
          </label>
        ) : modelLabel ? (
          <span
            className="model-topbar"
            title={modelTitle}
            aria-label={t("topbar.currentModel", {
              name: modelTitle || modelLabel,
            })}
          >
            <span className="perm-mode-topbar-label">{t("topbar.model")}</span>
            <span className="model-topbar-value">{modelLabel}</span>
          </span>
        ) : null}
        <label
          className="perm-mode-topbar"
          title={t("topbar.permsTitle")}
        >
          <span className="perm-mode-topbar-label">{t("topbar.perms")}</span>
          <select
            className="perm-mode-select"
            value={permissionMode}
            aria-label={t("topbar.permsAria")}
            onChange={(e) =>
              onPermissionMode(e.target.value as PermissionMode)
            }
          >
            <option value="ask">{t("topbar.ask")}</option>
            <option value="auto">{t("topbar.auto")}</option>
            <option value="always-approve">{t("topbar.always")}</option>
          </select>
        </label>
        <label
          className="perm-mode-topbar"
          title={t("topbar.effortTitle")}
        >
          <span className="perm-mode-topbar-label">{t("topbar.effort")}</span>
          <select
            className="perm-mode-select"
            value={reasoningEffort}
            aria-label={t("topbar.effortAria")}
            onChange={(e) =>
              onReasoningEffort(e.target.value as ReasoningEffort)
            }
          >
            <option value="low">{t("topbar.low")}</option>
            <option value="medium">{t("topbar.medium")}</option>
            <option value="high">{t("topbar.high")}</option>
            <option value="xhigh">{t("topbar.xhigh")}</option>
          </select>
        </label>
        {sessionMode === "plan" ? (
          <span
            className="status-pill plan-mode-pill"
            title={t("topbar.planTitle")}
            role="status"
          >
            {t("topbar.planMode")}
          </span>
        ) : null}
        {runningTasks.length > 0 ? (
          <span
            className="status-pill"
            title={t("topbar.tasksTitle")}
          >
            <span className="status-dot busy" />
            {t("topbar.tasks", { n: runningTasks.length })}
          </span>
        ) : null}
        <span
          className={`status-pill ${isOpening ? "status-pill-loading" : ""}`}
        >
          {isOpening ? (
            <Spinner size={12} className="spinner status-spinner" />
          ) : (
            <span
              className={`status-dot ${
                conn === "online" || conn === "busy"
                  ? conn === "busy"
                    ? "busy"
                    : "online"
                  : conn === "error"
                    ? "error"
                    : ""
              }`}
            />
          )}
          {statusLabel}
        </span>
        {onCompress ? (
          <button
            className="btn btn-sm topbar-btn"
            type="button"
            title={t("topbar.compressTitle")}
            disabled={conn !== "online" || isOpening || compacting}
            onClick={() => onCompress?.()}
          >
            {compacting ? t("topbar.compressing") : t("topbar.compress")}
          </button>
        ) : null}
        {onOpenPreview ? (
          <button
            className="btn btn-sm topbar-btn"
            type="button"
            title={t("topbar.previewTitle")}
            onClick={onOpenPreview}
          >
            {t("topbar.preview")}
          </button>
        ) : null}
        <label
          className="hide-thinking"
          title={t("topbar.hideThinkingTitle")}
        >
          <input
            type="checkbox"
            checked={hideThinking}
            aria-label={t("topbar.hideThinking")}
            onChange={(e) => onHideThinking?.(e.target.checked)}
          />
          {t("topbar.hideThinking")}
        </label>
        {conn === "busy" && (
          <button
            className="btn btn-sm topbar-btn danger"
            type="button"
            onClick={onStop}
          >
            {t("topbar.stop")}
          </button>
        )}
        </div>
      </div>
      <ElevatedSafetyChips
        sandboxTerminal={sandboxTerminal}
        allowOutsideProject={allowOutsideProject}
        permissionMode={permissionMode}
        privacyMode={privacyMode}
        allowWritesThisSession={allowWritesThisSession}
        onRevokeWritesThisSession={onRevokeWritesThisSession}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
});
