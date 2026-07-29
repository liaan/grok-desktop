/**
 * Shared ACP sessionUpdate → timeline item reducer.
 * Used by the renderer (live stream) and main process (disk history rebuild).
 *
 * Tool status notes (ACP prompt-turn + Grok quirks):
 * - Spec: tool_call → optional permission → tool_call_update(in_progress) →
 *   tool_call_update(completed|failed). Clients must key updates by toolCallId.
 * - session/update is progress-only; it does not replace client RPCs (fs/*,
 *   terminal/*, request_permission).
 * - Grok write/edit often send a final tool_call_update with content:[{type:diff}]
 *   (and/or rawOutput) but omit status. Without inference those cards stick on
 *   pending/in_progress even though the agent already moved on.
 */

let seq = 0;

export function uid(prefix = "id") {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}`;
}

/** @param {unknown} status */
export function isOpenToolStatus(status) {
  const st = String(status || "").toLowerCase();
  return !st || st === "pending" || st === "in_progress";
}

/** @param {unknown} status */
export function isTerminalToolStatus(status) {
  const st = String(status || "").toLowerCase();
  return (
    st === "completed" ||
    st === "failed" ||
    st === "error" ||
    st === "cancelled" ||
    st === "canceled"
  );
}

/**
 * Grok (and some ACP agents) attach the final result (diff / rawOutput) on a
 * tool_call_update without setting status:"completed". Treat those as done so
 * the UI does not hang while the agent continues.
 *
 * Do not treat arbitrary text content alone as final — intermediate progress
 * updates may include text without a terminal status.
 *
 * @param {any} update
 * @returns {boolean}
 */
export function looksLikeFinalToolResult(update) {
  if (!update || typeof update !== "object") return false;
  // Grok final tool payloads include a typed rawOutput (ListDir, Bash, …).
  // Do not treat bare/empty rawOutput as terminal — avoids early UI "completed"
  // while client RPCs (e.g. terminal/wait_for_exit) are still open.
  const rawOut = update.rawOutput ?? update.raw_output;
  if (rawOut != null && typeof rawOut === "object" && rawOut.type) {
    return true;
  }
  const content = update.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  // File write/edit result: ACP ToolCallContent::Diff
  if (
    content.some(
      (c) =>
        c &&
        (c.type === "diff" ||
          c.type === "Diff" ||
          c.oldText != null ||
          c.newText != null ||
          c.old_text != null ||
          c.new_text != null),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Resolve status for a tool_call_update. Explicit status always wins.
 * @param {any} update
 * @param {string | undefined | null} previousStatus
 * @returns {string}
 */
export function resolveToolUpdateStatus(update, previousStatus) {
  if (update?.status != null && String(update.status) !== "") {
    return String(update.status);
  }
  if (looksLikeFinalToolResult(update) && isOpenToolStatus(previousStatus)) {
    return "completed";
  }
  return previousStatus || "pending";
}

/**
 * Close open tool cards (turn ended, cancel, or hydrate safety net).
 * @param {any[]} items
 * @param {string} [status]
 * @returns {any[]}
 */
export function finalizeOpenTools(items, status = "completed") {
  if (!Array.isArray(items) || items.length === 0) return items;
  let changed = false;
  const next = items.map((item) => {
    if (item?.kind !== "tool") return item;
    if (!isOpenToolStatus(item.status)) return item;
    changed = true;
    return { ...item, status };
  });
  return changed ? next : items;
}

/**
 * @param {any[]} items
 * @param {any} params - full session/update params or a bare update object
 * @returns {any[]}
 */
export function applySessionUpdate(items, params) {
  const update = params?.update ?? params;
  if (!update) return items;
  const kind = update.sessionUpdate || update.session_update;
  const at =
    params?._meta?.agentTimestampMs ||
    (typeof params?.timestamp === "number" ? params.timestamp * 1000 : Date.now());
  const next = [...items];

  switch (kind) {
    case "user_message_chunk": {
      const text = String(update.content?.text ?? update.content ?? "");
      const last = next[next.length - 1];
      // Optimistic UI bubble already has full user text — ignore agent echo chunks
      if (last?.kind === "user" && last.optimistic) {
        return next;
      }
      if (last?.kind === "user") {
        next[next.length - 1] = {
          ...last,
          text: last.text + text,
          at: last.at || at,
        };
      } else {
        next.push({
          id: uid("user"),
          kind: "user",
          text,
          at,
        });
      }
      return next;
    }
    case "agent_message_chunk": {
      const text = String(update.content?.text ?? update.content ?? "");
      const last = next[next.length - 1];
      // Clear optimistic flag once the agent is responding
      if (last?.kind === "user" && last.optimistic) {
        next[next.length - 1] = { ...last, optimistic: false };
      }
      const tip = next[next.length - 1];
      if (tip?.kind === "assistant") {
        next[next.length - 1] = {
          ...tip,
          text: tip.text + text,
        };
      } else {
        next.push({
          id: uid("asst"),
          kind: "assistant",
          text,
          at,
        });
      }
      return next;
    }
    case "agent_thought_chunk": {
      const text = String(update.content?.text ?? update.content ?? "");
      const last = next[next.length - 1];
      if (last?.kind === "user" && last.optimistic) {
        next[next.length - 1] = { ...last, optimistic: false };
      }
      const tip = next[next.length - 1];
      if (tip?.kind === "thought") {
        next[next.length - 1] = {
          ...tip,
          text: tip.text + text,
        };
      } else {
        next.push({
          id: uid("thought"),
          kind: "thought",
          text,
          at,
        });
      }
      return next;
    }
    case "tool_call": {
      const last = next[next.length - 1];
      if (last?.kind === "user" && last.optimistic) {
        next[next.length - 1] = { ...last, optimistic: false };
      }
      const rawId =
        update.toolCallId ??
        update.tool_call_id ??
        update.id ??
        null;
      const toolCallId =
        rawId != null && String(rawId) !== ""
          ? String(rawId)
          : uid("tool");
      // Upsert: agent may re-emit tool_call for the same id
      const existing = next.findIndex(
        (i) => i.kind === "tool" && String(i.toolCallId) === toolCallId,
      );
      if (existing >= 0 && next[existing].kind === "tool") {
        next[existing] = {
          ...next[existing],
          title:
            update.title ||
            update.tool ||
            update.kind ||
            next[existing].title,
          status: update.status || next[existing].status || "pending",
          raw:
            update.rawInput ??
            update.raw_input ??
            update.arguments ??
            next[existing].raw,
        };
        return next;
      }
      next.push({
        id: uid("tool"),
        kind: "tool",
        toolCallId,
        title: update.title || update.tool || update.kind || "Tool call",
        status: update.status || "pending",
        raw: update.rawInput ?? update.raw_input ?? update.arguments,
        at,
      });
      return next;
    }
    case "tool_call_update": {
      const rawId =
        update.toolCallId ?? update.tool_call_id ?? update.id ?? null;
      const toolCallId =
        rawId != null && String(rawId) !== "" ? String(rawId) : null;
      if (!toolCallId) return next;
      const idx = next.findIndex(
        (i) => i.kind === "tool" && String(i.toolCallId) === toolCallId,
      );
      if (idx >= 0 && next[idx].kind === "tool") {
        const prev = next[idx];
        next[idx] = {
          ...prev,
          status: resolveToolUpdateStatus(update, prev.status),
          content: update.content ?? prev.content,
          title: update.title || prev.title,
          raw: update.rawInput ?? update.raw_input ?? prev.raw,
        };
      } else {
        // ACP v2-style upsert: some agents only send tool_call_update
        next.push({
          id: uid("tool"),
          kind: "tool",
          toolCallId,
          title: update.title || update.tool || update.kind || "Tool call",
          status: resolveToolUpdateStatus(update, update.status || "pending"),
          content: update.content,
          raw: update.rawInput ?? update.raw_input ?? update.arguments,
          at,
        });
      }
      return next;
    }
    case "plan": {
      // Replace the latest plan card when the agent updates todos (avoid stacking)
      const entries = update.entries || [];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i]?.kind === "plan") {
          next[i] = {
            ...next[i],
            entries,
            at: next[i].at || at,
          };
          return next;
        }
      }
      next.push({
        id: uid("plan"),
        kind: "plan",
        entries,
        at,
      });
      return next;
    }
    case "turn_completed":
    case "turn_complete": {
      // Safety net when the agent omits final tool status on the last tools.
      return finalizeOpenTools(next, "completed");
    }
    case "hook_execution": {
      // Pre/post tool hooks (project/user). When a hook *crashes* (exit ≠ 0)
      // the agent often never emits tool_call_update — the card stays "pending"
      // forever. Surface the failure and close the matching pending tool card.
      const runs = Array.isArray(update.runs) ? update.runs : [];
      const failed = runs.filter(
        (r) =>
          String(r?.status?.status || r?.status || "").toLowerCase() ===
            "failed" ||
          (typeof r?.status?.exit_code === "number" &&
            r.status.exit_code !== 0),
      );
      if (failed.length === 0) return next;

      const toolName = String(
        update.tool_name || update.toolName || update.event_name || "tool",
      );
      const details = failed
        .map((r) => {
          const name = r?.name || "hook";
          const err =
            r?.status?.error ||
            r?.error ||
            (r?.status?.exit_code != null
              ? `exit ${r.status.exit_code}`
              : "failed");
          return `${name}: ${err}`;
        })
        .join("\n");

      next.push({
        id: uid("sys"),
        kind: "system",
        text:
          `Hook blocked or crashed (${update.event_name || "hook"} on ${toolName}).\n` +
          `${details}\n` +
          `The tool may stay stuck until you Stop. Check project hooks under .grok/hooks (Windows often breaks bash path / CRLF).`,
        at,
      });

      // Fail the newest pending tool that looks related
      for (let i = next.length - 1; i >= 0; i--) {
        const item = next[i];
        if (item?.kind !== "tool") continue;
        const st = String(item.status || "").toLowerCase();
        if (st && st !== "pending" && st !== "in_progress") continue;
        const title = String(item.title || "").toLowerCase();
        const tn = toolName.toLowerCase();
        const related =
          !tn ||
          title.includes(tn) ||
          tn.includes("terminal") ||
          tn.includes("bash") ||
          title.includes("execute") ||
          title.includes("run_terminal");
        if (!related) continue;
        next[i] = {
          ...item,
          status: "failed",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: `Blocked by hook failure:\n${details}`,
              },
            },
          ],
        };
        break;
      }
      return next;
    }
    default:
      return next;
  }
}

export function formatOptionLabel(optionId, name) {
  if (name) return name;
  const map = {
    "allow-once": "Allow once",
    "allow-always": "Always allow",
    reject: "Reject",
    cancelled: "Cancel",
  };
  return map[optionId] || optionId;
}
