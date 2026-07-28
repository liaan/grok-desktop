/**
 * Renderer background-task surface: re-export shared reducer + types.
 */
export {
  applyBackgroundUpdate,
  runningTaskCount,
  hasAnyTasks,
  isBackgroundTaskUpdateKind,
} from "../../shared/background-tasks.mjs";

export type BackgroundTask = {
  id: string;
  kind: "command" | "subagent" | "monitor";
  title: string;
  detail?: string;
  status: "running" | "completed" | "failed" | "unknown";
  command?: string;
  outputFile?: string;
  exitCode?: number | null;
  startedAt: number;
  endedAt?: number;
  outputSnippet?: string;
  toolCallId?: string;
};
