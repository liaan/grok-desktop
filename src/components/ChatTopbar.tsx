import { memo } from "react";
import type { BackgroundTask } from "../lib/background-tasks";
import type { ConnState } from "../lib/conn";
import type { PermissionMode } from "../lib/permission-mode";
import type { ReasoningEffort } from "../lib/reasoning-effort";
import { basen } from "../lib/path-utils";
import { usePrivacy } from "../lib/privacy-context";
import { ElevatedSafetyChips } from "./ElevatedSafetyChips";
import { Spinner } from "./BrandMark";

export const ChatTopbar = memo(function ChatTopbar({
  project,
  conn,
  statusLabel,
  isOpening,
  permissionMode,
  reasoningEffort,
  allowOutsideProject,
  sandboxTerminal,
  privacyMode,
  backgroundTasks,
  onPermissionMode,
  onReasoningEffort,
  onOpenSettings,
  onStop,
}: {
  project: string;
  conn: ConnState;
  statusLabel: string;
  isOpening: boolean;
  permissionMode: PermissionMode;
  reasoningEffort: ReasoningEffort;
  allowOutsideProject: boolean;
  sandboxTerminal: boolean;
  privacyMode: boolean;
  backgroundTasks: BackgroundTask[];
  onPermissionMode: (m: PermissionMode) => void;
  onReasoningEffort: (e: ReasoningEffort) => void;
  onOpenSettings: () => void;
  onStop: () => void;
}) {
  const { redact } = usePrivacy();
  const runningTasks = backgroundTasks.filter((t) => t.status === "running");

  return (
    <div className="topbar">
      <div className="topbar-project">
        <div className="topbar-title">{basen(project)}</div>
        <div className="cwd" title={redact(project)}>
          {redact(project)}
        </div>
        <ElevatedSafetyChips
          sandboxTerminal={sandboxTerminal}
          allowOutsideProject={allowOutsideProject}
          permissionMode={permissionMode}
          privacyMode={privacyMode}
          onOpenSettings={onOpenSettings}
        />
      </div>
      <div className="topbar-actions row">
        <label className="perm-mode-topbar" title="Tool permission mode">
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
        {conn === "busy" && (
          <button className="btn danger" type="button" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
});
