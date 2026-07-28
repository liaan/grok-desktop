/**
 * Reduce Grok sessionUpdate events for background tasks + subagents
 * into a list suitable for the right-column Tasks pane.
 * Shared by Electron main (hydrate/tail) and the React renderer.
 */

function now() {
  return Date.now();
}

function isTerminalStatus(status) {
  return status === "completed" || status === "failed";
}

/**
 * Find by primary id or toolCallId alias.
 * @param {Array<{id: string, toolCallId?: string}>} list
 * @param {string} id
 * @param {string} [toolCallId]
 */
function findTaskIndex(list, id, toolCallId) {
  if (!id && !toolCallId) return -1;
  let idx = id ? list.findIndex((t) => t.id === id) : -1;
  if (idx < 0 && toolCallId) {
    idx = list.findIndex(
      (t) => t.toolCallId === toolCallId || t.id === toolCallId,
    );
  }
  if (idx < 0 && id) {
    idx = list.findIndex((t) => t.toolCallId === id);
  }
  return idx;
}

/**
 * @param {any[]} tasks
 * @param {any} params
 * @returns {any[]}
 */
export function applyBackgroundUpdate(tasks, params) {
  const update = params?.update ?? params;
  if (!update) return tasks;
  const kind = update.sessionUpdate || update.session_update;

  if (kind === "task_backgrounded") {
    const id = String(
      update.task_id ||
        update.taskId ||
        update.tool_call_id ||
        update.toolCallId ||
        now(),
    );
    const toolCallId =
      String(update.tool_call_id || update.toolCallId || "") || undefined;
    const idx = findTaskIndex(tasks, id, toolCallId);
    const base = {
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
      toolCallId,
    };
    if (idx >= 0) {
      const prev = tasks[idx];
      const list = [...tasks];
      list[idx] = {
        ...prev,
        ...base,
        id:
          id.startsWith("term_") || !String(prev.id).startsWith("term_")
            ? id
            : prev.id,
        toolCallId: toolCallId || prev.toolCallId,
        startedAt: prev.startedAt,
        status: isTerminalStatus(prev.status) ? prev.status : "running",
        endedAt: prev.endedAt,
        exitCode: prev.exitCode,
        outputSnippet: prev.outputSnippet,
      };
      return list;
    }
    return [base, ...tasks];
  }

  if (kind === "tool_call" || kind === "tool_call_update") {
    const fromTool = taskFromToolUpdate(update);
    if (!fromTool) return tasks;
    const idx = findTaskIndex(tasks, fromTool.id, fromTool.toolCallId);
    if (idx >= 0) {
      const prev = tasks[idx];
      if (isTerminalStatus(prev.status)) {
        const list = [...tasks];
        list[idx] = {
          ...prev,
          title: prev.title || fromTool.title,
          command: prev.command || fromTool.command,
          outputFile: prev.outputFile || fromTool.outputFile,
          toolCallId: prev.toolCallId || fromTool.toolCallId,
          id:
            fromTool.id.startsWith("term_") && !String(prev.id).startsWith("term_")
              ? fromTool.id
              : prev.id,
        };
        return list;
      }
      const list = [...tasks];
      list[idx] = {
        ...prev,
        ...fromTool,
        id:
          fromTool.id.startsWith("term_") || !String(prev.id).startsWith("term_")
            ? fromTool.id
            : prev.id,
        toolCallId: fromTool.toolCallId || prev.toolCallId,
        startedAt: prev.startedAt,
      };
      return list;
    }
    return [fromTool, ...tasks];
  }

  if (kind === "task_completed") {
    const snap = update.task_snapshot || update.taskSnapshot || {};
    const id = String(snap.task_id || snap.taskId || update.task_id || "");
    if (!id) return tasks;
    const toolCallId =
      String(
        snap.tool_call_id ||
          snap.toolCallId ||
          update.tool_call_id ||
          update.toolCallId ||
          "",
      ) || undefined;
    const idx = findTaskIndex(tasks, id, toolCallId);
    const exit = snap.exit_code ?? snap.exitCode;
    const failed =
      snap.explicitly_killed ||
      (typeof exit === "number" && exit !== 0) ||
      Boolean(snap.signal);
    const titleFromSnap = snap.description || snap.command;
    const outFile = snap.output_file || snap.outputFile;
    const snippet =
      typeof snap.output === "string" ? snap.output.slice(-800) : undefined;
    if (idx >= 0) {
      const prev = tasks[idx];
      const list = [...tasks];
      list[idx] = {
        ...prev,
        id: id.startsWith("term_") ? id : prev.id,
        toolCallId: toolCallId || prev.toolCallId,
        status: failed ? "failed" : "completed",
        exitCode: typeof exit === "number" ? exit : (prev.exitCode ?? null),
        endedAt: now(),
        command: snap.command || prev.command,
        outputFile: outFile || prev.outputFile,
        title: titleFromSnap || prev.title || id,
        outputSnippet: snippet ?? prev.outputSnippet,
      };
      return list;
    }
    return [
      {
        id,
        kind: "command",
        title: titleFromSnap || id,
        status: failed ? "failed" : "completed",
        exitCode: typeof exit === "number" ? exit : null,
        endedAt: now(),
        command: snap.command || undefined,
        outputFile: outFile || undefined,
        outputSnippet: snippet,
        toolCallId,
        startedAt: now(),
      },
      ...tasks,
    ];
  }

  if (kind === "subagent_spawned") {
    const id = String(
      update.subagent_id ||
        update.subagentId ||
        update.child_session_id ||
        now(),
    );
    const idx = findTaskIndex(tasks, id);
    const next = {
      id,
      kind: "subagent",
      title:
        update.description ||
        update.subagent_type ||
        `Subagent ${id.slice(0, 8)}`,
      detail: [update.subagent_type, update.capability_mode, update.model]
        .filter(Boolean)
        .join(" · "),
      status: "running",
      startedAt: now(),
    };
    if (idx >= 0) {
      const list = [...tasks];
      list[idx] = {
        ...tasks[idx],
        ...next,
        startedAt: tasks[idx].startedAt,
        status: isTerminalStatus(tasks[idx].status)
          ? tasks[idx].status
          : "running",
      };
      return list;
    }
    return [next, ...tasks];
  }

  if (kind === "subagent_finished") {
    const id = String(
      update.subagent_id || update.subagentId || update.child_session_id || "",
    );
    if (!id) return tasks;
    const idx = findTaskIndex(tasks, id);
    const st = String(update.status || "completed").toLowerCase();
    const failed =
      st.includes("fail") || st.includes("error") || st.includes("cancel");
    const patch = {
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
    if (idx >= 0) {
      const list = [...tasks];
      list[idx] = { ...tasks[idx], ...patch };
      return list;
    }
    return [
      {
        id,
        kind: "subagent",
        title: id.slice(0, 12),
        status: patch.status || "completed",
        startedAt: now(),
        ...patch,
      },
      ...tasks,
    ];
  }

  return tasks;
}

function taskFromToolUpdate(update) {
  const rawOut = update?.rawOutput || update?.raw_output || {};
  const rawIn = update?.rawInput || update?.raw_input || {};
  const metaIn = update?._meta?.["x.ai/tool"]?.input || {};

  const started =
    rawOut?.type === "BackgroundTaskStarted" ||
    (typeof rawOut?.task_id === "string" &&
      String(rawOut.status || "").toLowerCase() === "running" &&
      (rawOut?.task_type === "bash" ||
        rawIn?.background === true ||
        rawIn?.is_background === true ||
        metaIn?.background === true));

  if (!started) return null;

  const taskId = String(
    rawOut?.task_id || rawOut?.taskId || update?.task_id || "",
  );
  const toolCallId =
    String(update?.toolCallId || update?.tool_call_id || "") || undefined;
  const id = taskId || toolCallId || "";
  if (!id) return null;

  const command = String(
    rawOut?.command || rawIn?.command || metaIn?.command || "",
  );
  const title = String(
    rawIn?.description ||
      metaIn?.description ||
      rawOut?.summary ||
      command ||
      `Background task ${id.slice(0, 12)}`,
  );

  return {
    id,
    kind: "command",
    title,
    status: "running",
    command: command || undefined,
    outputFile: rawOut?.output_file || rawOut?.outputFile,
    startedAt: now(),
    toolCallId,
  };
}

export function runningTaskCount(tasks) {
  return tasks.filter((t) => t.status === "running").length;
}

export function hasAnyTasks(tasks) {
  return tasks.length > 0;
}

/** SessionUpdate kinds that affect the Tasks dock. */
export function isBackgroundTaskUpdateKind(kind) {
  return (
    kind === "task_backgrounded" ||
    kind === "task_completed" ||
    kind === "subagent_spawned" ||
    kind === "subagent_finished" ||
    kind === "tool_call" ||
    kind === "tool_call_update"
  );
}
