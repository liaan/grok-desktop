/**
 * Shared ACP sessionUpdate → timeline item reducer.
 * Used by the renderer (live stream) and main process (disk history rebuild).
 *
 * Tool status (ACP + grok-build wire, see agent `acp_conversion` / `tool_calls`):
 * - Clients must key updates by toolCallId. session/update is progress-only;
 *   it does not replace client RPCs (fs/*, terminal/*, request_permission).
 * - Grok lifecycle for normal tools:
 *   1. tool_call status=pending
 *   2. tool_call_update refine/start — title/kind/locations/rawInput; write and
 *      search_replace attach proposed Diff content here with **no** status
 *   3. optional permission update (title/kind/rawInput, no status)
 *   4. final tool_call_update from acp_tool_update — **status** completed|failed
 *      plus content and typically typed rawOutput (serde tag `type`)
 * - Grok rarely emits in_progress for normal tools (bash-mode / backend do).
 * - Bash with signal "backgrounded" is the intentional final omit of status;
 *   do not infer completed from rawOutput alone in that case.
 * - Diff without status is a **start preview**, not a final result. Older
 *   session dumps that truly omitted final status stay open until turn_completed.
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
 * True when typed rawOutput is a bash tool result with signal "backgrounded".
 * Grok omits status on that update on purpose (task continues in background).
 *
 * @param {any} rawOut
 * @returns {boolean}
 */
export function isBashBackgroundedRawOutput(rawOut) {
  if (rawOut == null || typeof rawOut !== "object") return false;
  const type = String(rawOut.type || "");
  if (type !== "Bash" && type !== "bash") return false;
  return String(rawOut.signal || "") === "backgrounded";
}

/**
 * Whether a tool_call_update (with status omitted) should be treated as a
 * terminal success for UI purposes.
 *
 * Grok true finals almost always set status; when status is missing we only
 * infer completion from a typed rawOutput (ToolOutput serde tag), and never
 * for bash-backgrounded. Diff content alone is **not** final — write and
 * search_replace send proposed Diff on the start/refine update before the
 * tool runs (and often before permission).
 *
 * @param {any} update
 * @returns {boolean}
 */
export function looksLikeFinalToolResult(update) {
  if (!update || typeof update !== "object") return false;
  // Explicit non-empty status means the agent already decided; callers should
  // use resolveToolUpdateStatus. This helper only covers status-omitted cases.
  const rawOut = update.rawOutput ?? update.raw_output;
  if (rawOut != null && typeof rawOut === "object" && rawOut.type) {
    // Bare/empty objects without type are not final (avoids early completed
    // while client RPCs e.g. terminal/wait_for_exit are still open).
    if (isBashBackgroundedRawOutput(rawOut)) return false;
    return true;
  }
  // Diff / text content without typed rawOutput: intermediate or incomplete.
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
    case "auto_compact_started":
    case "compact_started": {
      const pct = Number(update.percentage ?? update.percent);
      const used = Number(update.tokens_used ?? update.tokensUsed);
      const bits = ["Compressing conversation…"];
      if (Number.isFinite(pct) && pct > 0) bits.push(`(${Math.round(pct)}% full)`);
      else if (Number.isFinite(used) && used > 0) {
        bits.push(`(${used.toLocaleString()} tokens)`);
      }
      next.push({
        id: uid("sys"),
        kind: "system",
        text: bits.join(" "),
        at,
      });
      return next;
    }
    case "auto_compact_completed":
    case "compact_completed": {
      const before = Number(
        update.tokens_before ?? update.tokensBefore ?? 0,
      );
      const after = Number(update.tokens_after ?? update.tokensAfter ?? 0);
      let text = "Conversation compacted.";
      if (before > 0 && after >= 0) {
        text = `Conversation compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens.`;
      }
      const preview = String(
        update.summary_preview ?? update.summaryPreview ?? "",
      ).trim();
      if (preview) text += `\n${preview}`;
      next.push({ id: uid("sys"), kind: "system", text, at });
      return next;
    }
    case "auto_compact_failed":
    case "compact_failed": {
      const err = String(
        update.error || update.message || "unknown error",
      );
      next.push({
        id: uid("sys"),
        kind: "system",
        text: `Compress failed: ${err}`,
        at,
      });
      return next;
    }
    case "auto_compact_cancelled":
    case "compact_cancelled": {
      next.push({
        id: uid("sys"),
        kind: "system",
        text: "Compress cancelled.",
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
