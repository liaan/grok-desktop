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
import { applyUsageUpdate, emptyUsage } from "../shared/usage.mjs";

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

function updatesJsonlPath(cwd, sessionId) {
  return path.join(sessionsRootForCwd(cwd), sessionId, "updates.jsonl");
}

/**
 * Single-pass rebuild of timeline + background tasks + usage from updates.jsonl.
 * Canonical disk loader for project/session open.
 *
 * @param {string} cwd
 * @param {string} sessionId
 * @param {{ maxItems?: number, maxTasks?: number }} [opts]
 */
export function loadSessionOpenState(cwd, sessionId, opts = {}) {
  const maxItems = opts.maxItems ?? 400;
  const maxTasks = opts.maxTasks ?? 40;
  const updatesPath = updatesJsonlPath(cwd, sessionId);
  if (!fs.existsSync(updatesPath)) {
    return {
      items: [],
      tasks: [],
      usage: emptyUsage(),
      error: null,
      path: updatesPath,
    };
  }

  let items = [];
  /** @type {any[]} */
  let tasks = [];
  let usage = emptyUsage();
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

      const update = params?.update ?? params;
      const kind = update?.sessionUpdate || update?.session_update;
      if (
        kind === "turn_completed" ||
        kind === "turn_complete" ||
        kind === "auto_compact_completed" ||
        kind === "compact_completed"
      ) {
        usage = applyUsageUpdate(usage, params);
      }
      if (isBackgroundTaskUpdateKind(kind)) {
        tasks = applyBackgroundUpdate(tasks, params);
      }
    }
  } catch (err) {
    return {
      items: [],
      tasks: [],
      usage: emptyUsage(),
      error: err?.message || String(err),
      path: updatesPath,
    };
  }

  if (items.length > maxItems) {
    items = items.slice(items.length - maxItems);
  }
  if (tasks.length > maxTasks) {
    tasks = tasks.slice(0, maxTasks);
  }

  return { items, tasks, usage, error: null, path: updatesPath };
}

/** @deprecated use loadSessionOpenState — kept as thin projection for call sites */
export function loadTimelineFromDisk(cwd, sessionId, opts = {}) {
  const { items, error } = loadSessionOpenState(cwd, sessionId, opts);
  return { items, error };
}

/** @deprecated use loadSessionOpenState */
export function loadBackgroundTasksFromDisk(cwd, sessionId, opts = {}) {
  const { tasks, error, path: updatesPath } = loadSessionOpenState(
    cwd,
    sessionId,
    opts,
  );
  return { tasks, error, path: updatesPath };
}

/** @deprecated use loadSessionOpenState */
export function loadUsageFromDisk(cwd, sessionId) {
  const { usage, error } = loadSessionOpenState(cwd, sessionId);
  return { usage, error };
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
  const updatesPath = updatesJsonlPath(cwd, sessionId);

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
  // Unref so Electron can quit without waiting on the poller
  if (typeof timer.unref === "function") timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
