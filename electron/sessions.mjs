/**
 * Read Grok CLI session store under ~/.grok/sessions (same as TUI /resume).
 * History is rebuilt from updates.jsonl; agent context is restored via ACP session/load.
 */
import fs from "node:fs";
import path from "node:path";
import { grokHomeDir } from "./grok-home.mjs";
import { applySessionUpdate } from "../shared/session-timeline.mjs";

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
