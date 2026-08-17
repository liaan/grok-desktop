import { memo, useMemo } from "react";
import type { BackgroundTask } from "../lib/background-tasks";
import type { ConnState } from "../lib/conn";
import type { PermissionMode } from "../lib/permission-mode";
import type { ReasoningEffort } from "../lib/reasoning-effort";
import { basen } from "../lib/path-utils";
import { usePrivacy } from "../lib/privacy-context";
import type { AvailableModel } from "../vite-env";
import { ElevatedSafetyChips } from "./ElevatedSafetyChips";
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
  compacting?: boolean;
  allowWritesThisSession?: boolean;
  onRevokeWritesThisSession?: () => void;
  onStop: () => void;
}) {
  const { redact } = usePrivacy();
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
            title={modelTitle || "Session model"}
          >
            <span className="perm-mode-topbar-label">Model</span>
            <select
              className="perm-mode-select"
              key={`${modelId || "none"}:${modelSelectEpoch}`}
              value={selectModelId}
              disabled={Boolean(pendingModelId)}
              aria-label="Session model"
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
            aria-label={`Current model: ${modelTitle || modelLabel}`}
          >
            <span className="perm-mode-topbar-label">Model</span>
            <span className="model-topbar-value">{modelLabel}</span>
          </span>
        ) : null}
        <label
          className="perm-mode-topbar"
          title="Ask = approve every tool. Auto = reads and browsing go through; edits/posts still ask (or Allow writes this session). Always = skip approvals. Switching Auto mid-turn allows any safe prompts already waiting — no Stop needed."
        >
          <span className="perm-mode-topbar-label">Perms</span>
          <select
            className="perm-mode-select"
            value={permissionMode}
            aria-label="Tool permission mode"
            onChange={(e) =>
              onPermissionMode(e.target.value as PermissionMode)
            }
          >
            <option value="ask">Ask</option>
            <option value="auto">Auto</option>
            <option value="always-approve">Always</option>
          </select>
        </label>
        <label
          className="perm-mode-topbar"
          title="Reasoning effort for the current model (/effort)"
        >
          <span className="perm-mode-topbar-label">Effort</span>
          <select
            className="perm-mode-select"
            value={reasoningEffort}
            aria-label="Reasoning effort"
            onChange={(e) =>
              onReasoningEffort(e.target.value as ReasoningEffort)
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">X-High</option>
          </select>
        </label>
        {runningTasks.length > 0 ? (
          <span
            className="status-pill"
            title="Background tasks running — see Tasks dock (bottom-right)"
          >
            <span className="status-dot busy" />
            Tasks {runningTasks.length}
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
            title="Summarize older turns to free context. Does not send a chat message."
            disabled={conn !== "online" || isOpening || compacting}
            onClick={() => onCompress?.()}
          >
            {compacting ? "Compressing…" : "Compress"}
          </button>
        ) : null}
        {onOpenPreview ? (
          <button
            className="btn btn-sm topbar-btn"
            type="button"
            title="Open a detachable Preview window (move it to another screen)"
            onClick={onOpenPreview}
          >
            Preview
          </button>
        ) : null}
        {conn === "busy" && (
          <button
            className="btn btn-sm topbar-btn danger"
            type="button"
            onClick={onStop}
          >
            Stop
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
