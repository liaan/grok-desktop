/**
 * Read Grok CLI session store under ~/.grok/sessions (same as TUI /resume).
 * History is rebuilt from updates.jsonl; agent context is restored via ACP session/load.
 */
import fs from "node:fs";
import path from "node:path";
import { grokHomeDir } from "./grok-home.mjs";
import { applySessionUpdate } from "../shared/session-timeline.mjs";
import {
  applyBackgroundUpdate,
  isBackgroundTaskUpdateKind,
} from "../shared/background-tasks.mjs";

/** URL-encode cwd the same way the CLI groups sessions. */
export function encodeSessionCwd(cwd) {
  const resolved = path.resolve(cwd);
  return encodeURIComponent(resolved);
}

export function sessionsRootForCwd(cwd) {
  return path.join(grokHomeDir(), "sessions", encodeSessionCwd(cwd));
}

/**
 * List sessions for a project directory (newest first).
 * @param {string} cwd
 * @param {{ limit?: number }} [opts]
 */
export function listSessionsForCwd(cwd, opts = {}) {
  const limit = opts.limit ?? 40;
  const root = sessionsRootForCwd(cwd);
  if (!fs.existsSync(root)) return [];

  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    if (id.length < 8) continue;
    const summaryPath = path.join(root, id, "summary.json");
    if (!fs.existsSync(summaryPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      const title =
        raw.session_summary ||
        raw.generated_title ||
        raw.title ||
        "(no summary)";
      out.push({
        id,
        cwd: raw.info?.cwd || cwd,
        title: String(title),
        summary: raw.session_summary || raw.generated_title || null,
        createdAt: raw.created_at || null,
        updatedAt: raw.updated_at || raw.last_active_at || null,
        lastActiveAt: raw.last_active_at || raw.updated_at || null,
        numMessages: raw.num_messages ?? 0,
        numChatMessages: raw.num_chat_messages ?? 0,
        modelId: raw.current_model_id || null,
      });
    } catch {
      /* skip corrupt summary */
    }
  }

  out.sort((a, b) => {
    const ta = Date.parse(a.lastActiveAt || a.updatedAt || "") || 0;
    const tb = Date.parse(b.lastActiveAt || b.updatedAt || "") || 0;
    return tb - ta;
  });

  return out.slice(0, limit);
}

/**
 * Most recently active session for cwd, or null.
 * @param {string} cwd
 */
export function mostRecentSession(cwd) {
  const list = listSessionsForCwd(cwd, { limit: 1 });
  return list[0] || null;
}

/**
 * Rebuild a UI timeline from updates.jsonl.
 * @param {string} cwd
 * @param {string} sessionId
 * @param {{ maxItems?: number }} [opts]
 */
export function loadTimelineFromDisk(cwd, sessionId, opts = {}) {
  const maxItems = opts.maxItems ?? 400;
  const updatesPath = path.join(
    sessionsRootForCwd(cwd),
    sessionId,
    "updates.jsonl",
  );
  if (!fs.existsSync(updatesPath)) {
    return { items: [], error: null };
  }

  let items = [];
  try {
    const text = fs.readFileSync(updatesPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const params = row.params || row;
      items = applySessionUpdate(items, params);
    }
  } catch (err) {
    return {
      items: [],
      error: err?.message || String(err),
    };
  }

  if (items.length > maxItems) {
    items = items.slice(items.length - maxItems);
  }

  return { items, error: null };
}

/**
 * Rebuild background-task list from updates.jsonl (same file the CLI writes).
 * Used to hydrate the Tasks dock and as a safety net when ACP wire events
 * for `_x.ai/session/update` are missed.
 *
 * @param {string} cwd
 * @param {string} sessionId
 * @param {{ maxTasks?: number }} [opts]
 */
export function loadBackgroundTasksFromDisk(cwd, sessionId, opts = {}) {
  const maxTasks = opts.maxTasks ?? 40;
  const updatesPath = path.join(
    sessionsRootForCwd(cwd),
    sessionId,
    "updates.jsonl",
  );
  if (!fs.existsSync(updatesPath)) {
    return { tasks: [], error: null, path: updatesPath };
  }

  /** @type {any[]} */
  let tasks = [];
  try {
    const text = fs.readFileSync(updatesPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const params = row.params || row;
      const update = params?.update ?? params;
      const kind = update?.sessionUpdate || update?.session_update;
      if (!isBackgroundTaskUpdateKind(kind)) continue;
      tasks = applyBackgroundUpdate(tasks, params);
    }
  } catch (err) {
    return {
      tasks: [],
      error: err?.message || String(err),
      path: updatesPath,
    };
  }

  if (tasks.length > maxTasks) {
    tasks = tasks.slice(0, maxTasks);
  }

  return { tasks, error: null, path: updatesPath };
}

/**
 * Tail updates.jsonl and invoke onParams for new background-related lines.
 * @param {{
 *   cwd: string,
 *   sessionId: string,
 *   onParams: (params: any) => void,
 *   intervalMs?: number,
 * }} opts
 * @returns {() => void} stop
 */
export function startBackgroundTaskFileTail(opts) {
  const { cwd, sessionId, onParams } = opts;
  const intervalMs = opts.intervalMs ?? 750;
  const updatesPath = path.join(
    sessionsRootForCwd(cwd),
    sessionId,
    "updates.jsonl",
  );

  let pos = 0;
  let stopped = false;
  try {
    if (fs.existsSync(updatesPath)) {
      // Live tail only — hydrate already ran a full pass
      pos = fs.statSync(updatesPath).size;
    }
  } catch {
    pos = 0;
  }

  const tick = () => {
    if (stopped) return;
    try {
      if (!fs.existsSync(updatesPath)) return;
      const st = fs.statSync(updatesPath);
      if (st.size < pos) pos = 0; // truncated / rotated
      if (st.size === pos) return;
      const fd = fs.openSync(updatesPath, "r");
      try {
        const len = st.size - pos;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, pos);
        pos = st.size;
        const chunk = buf.toString("utf8");
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let row;
          try {
            row = JSON.parse(trimmed);
          } catch {
            continue;
          }
          const params = row.params || row;
          const update = params?.update ?? params;
          const kind = update?.sessionUpdate || update?.session_update;
          if (!isBackgroundTaskUpdateKind(kind)) continue;
          // Only re-emit true task lifecycle + BackgroundTaskStarted tool results
          if (
            kind === "task_backgrounded" ||
            kind === "task_completed" ||
            kind === "subagent_spawned" ||
            kind === "subagent_finished" ||
            kind === "hook_execution" ||
            kind === "turn_completed" ||
            kind === "turn_complete"
          ) {
            onParams(params);
          } else if (kind === "tool_call" || kind === "tool_call_update") {
            const rawOut = update?.rawOutput || update?.raw_output;
            if (rawOut?.type === "BackgroundTaskStarted" || rawOut?.task_id) {
              onParams(params);
            }
          }
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* ignore transient read errors */
    }
  };

  const timer = setInterval(tick, intervalMs);
  // Unref so this timer does not keep Electron alive alone
  if (typeof timer.unref === "function") timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
