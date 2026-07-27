/**
 * Shared ACP sessionUpdate → timeline item reducer.
 * Used by the renderer (live stream) and main process (disk history rebuild).
 */

let seq = 0;

export function uid(prefix = "id") {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}`;
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
      const toolCallId = update.toolCallId || update.tool_call_id || uid("tool");
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
      const toolCallId = update.toolCallId || update.tool_call_id;
      const idx = next.findIndex(
        (i) => i.kind === "tool" && i.toolCallId === toolCallId,
      );
      if (idx >= 0 && next[idx].kind === "tool") {
        next[idx] = {
          ...next[idx],
          status: update.status || next[idx].status,
          content: update.content ?? next[idx].content,
          title: update.title || next[idx].title,
          raw: update.rawInput ?? update.raw_input ?? next[idx].raw,
        };
      }
      return next;
    }
    case "plan": {
      next.push({
        id: uid("plan"),
        kind: "plan",
        entries: update.entries || [],
        at,
      });
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
