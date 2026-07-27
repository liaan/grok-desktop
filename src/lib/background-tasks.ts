/**
 * Reduce Grok sessionUpdate events for background tasks + subagents
 * into a list suitable for the right-column Tasks pane.
 */

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
};

function now() {
  return Date.now();
}

/**
 * Apply a session/update payload to the background-task list.
 * Returns a new array (immutable).
 */
export function applyBackgroundUpdate(
  tasks: BackgroundTask[],
  params: any,
): BackgroundTask[] {
  const update = params?.update ?? params;
  if (!update) return tasks;
  const kind = update.sessionUpdate || update.session_update;
  const list = [...tasks];

  if (kind === "task_backgrounded") {
    const id = String(
      update.task_id || update.taskId || update.tool_call_id || now(),
    );
    const idx = list.findIndex((t) => t.id === id);
    const next: BackgroundTask = {
      id,
      kind: "command",
      title:
        update.description ||
        update.command ||
        `Background task ${id.slice(0, 8)}`,
      detail: update.cwd || undefined,
      status: "running",
      command: update.command,
      outputFile: update.output_file || update.outputFile,
      startedAt: now(),
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...next, startedAt: list[idx].startedAt };
    else list.unshift(next);
    return list;
  }

  if (kind === "task_completed") {
    const snap = update.task_snapshot || update.taskSnapshot || {};
    const id = String(snap.task_id || snap.taskId || update.task_id || "");
    if (!id) return list;
    const idx = list.findIndex((t) => t.id === id);
    const exit = snap.exit_code ?? snap.exitCode;
    const failed =
      snap.explicitly_killed ||
      (typeof exit === "number" && exit !== 0) ||
      Boolean(snap.signal);
    const patch: Partial<BackgroundTask> = {
      status: failed ? "failed" : "completed",
      exitCode: typeof exit === "number" ? exit : null,
      endedAt: now(),
      command: snap.command || undefined,
      outputFile: snap.output_file || snap.outputFile,
      title:
        snap.description ||
        snap.command ||
        (idx >= 0 ? list[idx].title : id),
      outputSnippet:
        typeof snap.output === "string"
          ? snap.output.slice(-800)
          : undefined,
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...patch };
    else
      list.unshift({
        id,
        kind: "command",
        title: patch.title || id,
        status: patch.status || "completed",
        startedAt: now(),
        ...patch,
      } as BackgroundTask);
    return list;
  }

  if (kind === "subagent_spawned") {
    const id = String(
      update.subagent_id || update.subagentId || update.child_session_id || now(),
    );
    const idx = list.findIndex((t) => t.id === id);
    const next: BackgroundTask = {
      id,
      kind: "subagent",
      title:
        update.description ||
        update.subagent_type ||
        `Subagent ${id.slice(0, 8)}`,
      detail: [
        update.subagent_type,
        update.capability_mode,
        update.model,
      ]
        .filter(Boolean)
        .join(" · "),
      status: "running",
      startedAt: now(),
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...next, startedAt: list[idx].startedAt };
    else list.unshift(next);
    return list;
  }

  if (kind === "subagent_finished") {
    const id = String(
      update.subagent_id || update.subagentId || update.child_session_id || "",
    );
    if (!id) return list;
    const idx = list.findIndex((t) => t.id === id);
    const st = String(update.status || "completed").toLowerCase();
    const failed = st.includes("fail") || st.includes("error") || st.includes("cancel");
    const patch: Partial<BackgroundTask> = {
      status: failed ? "failed" : "completed",
      endedAt: now(),
      outputSnippet:
        typeof update.output === "string"
          ? update.output.slice(0, 800)
          : undefined,
      detail: [
        update.subagent_type,
        update.tool_calls != null ? `${update.tool_calls} tools` : null,
        update.duration_ms != null
          ? `${Math.round(Number(update.duration_ms) / 1000)}s`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...patch };
    else
      list.unshift({
        id,
        kind: "subagent",
        title: id.slice(0, 12),
        status: patch.status || "completed",
        startedAt: now(),
        ...patch,
      } as BackgroundTask);
    return list;
  }

  return list;
}

export function runningTaskCount(tasks: BackgroundTask[]): number {
  return tasks.filter((t) => t.status === "running").length;
}
