import type { TimelineItem } from "../vite-env";

let seq = 0;
export function uid(prefix = "id") {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}`;
}

export function applySessionUpdate(
  items: TimelineItem[],
  params: any,
): TimelineItem[] {
  const update = params?.update ?? params;
  if (!update) return items;
  const kind = update.sessionUpdate || update.session_update;
  const next = [...items];

  switch (kind) {
    case "agent_message_chunk": {
      const text = update.content?.text ?? update.content ?? "";
      const last = next[next.length - 1];
      if (last?.kind === "assistant") {
        next[next.length - 1] = {
          ...last,
          text: last.text + text,
        };
      } else {
        next.push({
          id: uid("asst"),
          kind: "assistant",
          text: String(text),
          at: Date.now(),
        });
      }
      return next;
    }
    case "agent_thought_chunk": {
      const text = update.content?.text ?? update.content ?? "";
      const last = next[next.length - 1];
      if (last?.kind === "thought") {
        next[next.length - 1] = {
          ...last,
          text: last.text + text,
        };
      } else {
        next.push({
          id: uid("thought"),
          kind: "thought",
          text: String(text),
          at: Date.now(),
        });
      }
      return next;
    }
    case "tool_call": {
      const toolCallId = update.toolCallId || update.tool_call_id || uid("tool");
      next.push({
        id: uid("tool"),
        kind: "tool",
        toolCallId,
        title: update.title || update.tool || update.kind || "Tool call",
        status: update.status || "pending",
        raw: update.rawInput ?? update.raw_input ?? update.arguments,
        at: Date.now(),
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
        at: Date.now(),
      });
      return next;
    }
    default:
      return next;
  }
}

export function formatOptionLabel(optionId: string, name?: string) {
  if (name) return name;
  const map: Record<string, string> = {
    "allow-once": "Allow once",
    "allow-always": "Always allow",
    reject: "Reject",
    cancelled: "Cancel",
  };
  return map[optionId] || optionId;
}
