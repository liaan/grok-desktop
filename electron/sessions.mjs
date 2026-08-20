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

/** Same cap as Grok CLI `/rename` (`MAX_TITLE_SCALARS`). */
export const MAX_SESSION_TITLE_LENGTH = 100;

/**
 * Session folder names are ULIDs / UUIDs. Reject anything that could
 * escape the cwd sessions root.
 * @param {unknown} id
 */
export function isSafeSessionId(id) {
  if (typeof id !== "string") return false;
  if (id.length < 8 || id.length > 128) return false;
  if (id.includes("..") || id.includes("/") || id.includes("\\")) return false;
  return /^[A-Za-z0-9._-]+$/.test(id);
}

/**
 * Strip C0/C1 + bidi overrides (same class as CLI `sanitize_rename_title`),
 * then trim. Empty after sanitize is rejected by rename, not truncated.
 * @param {unknown} title
 */
export function sanitizeSessionTitle(title) {
  const raw = typeof title === "string" ? title : String(title ?? "");
  let out = "";
  for (const c of raw) {
    const code = c.codePointAt(0) || 0;
    if (code < 32 || (code >= 127 && code <= 159)) continue;
    if (
      c === "\u200E" ||
      c === "\u200F" ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      continue;
    }
    out += c;
  }
  return out.trim();
}

/**
 * Display title matches the CLI: non-empty `generated_title` wins
 * (including a manual `/rename`), else `session_summary`.
 * @param {Record<string, unknown>} raw
 */
export function displayTitleFromSummary(raw) {
  const generated = String(raw?.generated_title || "").trim();
  if (generated) return generated;
  const summary = String(raw?.session_summary || raw?.title || "").trim();
  return summary || "(no summary)";
}

/**
 * Pin a chat title on disk (`generated_title` + `title_is_manual`).
 * Same fields the TUI `/rename` / `x.ai/session/rename` persist so auto
 * titling does not overwrite on next resume.
 *
 * @param {string} cwd
 * @param {string} sessionId
 * @param {string} title
 * @returns {{ title: string }}
 */
export function renameSessionOnDisk(cwd, sessionId, title) {
  if (!cwd) throw new Error("No project path");
  if (!isSafeSessionId(sessionId)) throw new Error("Invalid session id");
  const cleaned = sanitizeSessionTitle(title);
  if (!cleaned) throw new Error("Title must not be blank");
  if ([...cleaned].length > MAX_SESSION_TITLE_LENGTH) {
    throw new Error(
      `Title too long (max ${MAX_SESSION_TITLE_LENGTH} characters)`,
    );
  }

  const dir = path.join(sessionsRootForCwd(cwd), sessionId);
  const summaryPath = path.join(dir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new Error("Chat not found");
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  } catch {
    throw new Error("Could not read chat summary");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Chat summary is invalid");
  }

  raw.generated_title = cleaned;
  raw.title_is_manual = true;
  raw.updated_at = new Date().toISOString();

  const tmp = `${summaryPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, summaryPath);
  return { title: cleaned };
}

/**
 * Remove a chat folder under ~/.grok/sessions/<cwd>/<id>/.
 * Same local effect as `grok sessions delete` / `x.ai/session/delete`.
 *
 * @param {string} cwd
 * @param {string} sessionId
 */
export function deleteSessionOnDisk(cwd, sessionId) {
  if (!cwd) throw new Error("No project path");
  if (!isSafeSessionId(sessionId)) throw new Error("Invalid session id");
  const dir = path.join(sessionsRootForCwd(cwd), sessionId);
  const summaryPath = path.join(dir, "summary.json");
  if (!fs.existsSync(summaryPath) && !fs.existsSync(dir)) {
    throw new Error("Chat not found");
  }
  fs.rmSync(dir, { recursive: true, force: true });
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
    if (!isSafeSessionId(id)) continue;
    const summaryPath = path.join(root, id, "summary.json");
    if (!fs.existsSync(summaryPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      const title = displayTitleFromSummary(raw);
      const generated = String(raw.generated_title || "").trim();
      const summaryText = String(raw.session_summary || "").trim();
      out.push({
        id,
        cwd: raw.info?.cwd || cwd,
        title: String(title),
        summary: generated || summaryText || null,
        titleIsManual: Boolean(raw.title_is_manual) && Boolean(generated),
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
      // Include stream `_meta.totalTokens` so ctx is window occupancy, not
      // the last turn's billed usage.totalTokens (cache-inflated).
      usage = applyUsageUpdate(usage, params);
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
