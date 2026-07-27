/**
 * Turn ACP tool rawInput / content into human-readable strings for the chat UI.
 * Avoid dumping pure JSON when we can show command + plain output.
 */

export type ToolDisplay = {
  /** One-line subtitle under the title (e.g. description) */
  subtitle?: string;
  /** Primary input block (command, path, pattern…) */
  input?: string;
  /** Tool result / stdout */
  output?: string;
};

/**
 * Structured card for Approvals / tool rows — readable action + body.
 */
export type ToolCard = {
  /** Short verb: Execute, Read, Search… */
  action: string;
  /** Why / human description (not the full shell line) */
  summary?: string;
  /** Command, path, or pattern block */
  detail?: string;
  /** Full original title for tooltip */
  fullTitle?: string;
  /** Prefix detail with $ when it's a shell command */
  isCommand?: boolean;
};

const INPUT_BODY_CAP = 2000;
const OUTPUT_CAP = 24_000; // ~24 KiB — keep React timeline light

const PATH_KEYS = ["path", "target_file", "file_path"] as const;
const BODY_KEYS = ["contents", "content"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… (${s.length} chars)`;
}

/** First string field among `keys` on a plain object. */
function pickString(
  raw: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function formatDiffBlock(opts: {
  path?: string;
  oldText?: string | null;
  newText?: string | null;
  patch?: string;
}): string {
  const lines: string[] = [];
  if (opts.path) lines.push(opts.path);
  if (opts.patch) {
    lines.push(truncate(opts.patch, INPUT_BODY_CAP));
    return lines.join("\n");
  }
  if (opts.oldText != null || opts.newText != null) {
    if (opts.oldText != null && opts.oldText !== "") {
      for (const line of String(opts.oldText).split("\n").slice(0, 80)) {
        lines.push(`- ${line}`);
      }
    }
    if (opts.newText != null && opts.newText !== "") {
      for (const line of String(opts.newText).split("\n").slice(0, 80)) {
        lines.push(`+ ${line}`);
      }
    }
  }
  return lines.join("\n");
}

function slimJson(raw: Record<string, unknown>): string | undefined {
  try {
    const keys = Object.keys(raw).filter(
      (k) => !["variant", "is_background", "_meta"].includes(k),
    );
    if (keys.length === 0) return undefined;
    const slim: Record<string, unknown> = {};
    for (const k of keys.slice(0, 12)) slim[k] = raw[k];
    const s = JSON.stringify(slim, null, 2);
    if (s === "{}" || s === "[]" || s === "null") return undefined;
    return s;
  } catch {
    return undefined;
  }
}

/** Pull text out of ACP content blocks / nested content. */
export function extractTextFromContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => extractTextFromContent(block))
      .filter(Boolean)
      .join("\n\n");
  }

  if (!isPlainObject(content)) return "";

  // Skip image / media payloads
  if (
    content.type === "image" ||
    (typeof content.mimeType === "string" &&
      String(content.mimeType).startsWith("image/"))
  ) {
    return "(image)";
  }

  // { type: "content", content: { type: "text", text: "..." } }
  if (content.type === "content" && content.content != null) {
    return extractTextFromContent(content.content);
  }
  // { type: "text", text: "..." }
  if (typeof content.text === "string") return content.text;

  // ACP diff: { type: "diff", path, oldText, newText } (also legacy diff/patch)
  if (content.type === "diff") {
    const path =
      pickString(content, ["path", "file"]) ?? undefined;
    const patch =
      pickString(content, ["diff", "patch"]) ?? undefined;
    const oldText =
      content.oldText != null
        ? String(content.oldText)
        : content.old_text != null
          ? String(content.old_text)
          : null;
    const newText =
      content.newText != null
        ? String(content.newText)
        : content.new_text != null
          ? String(content.new_text)
          : null;
    return formatDiffBlock({ path, oldText, newText, patch });
  }

  // { type: "terminal", terminalId } — live output not wired yet
  if (content.type === "terminal" && content.terminalId) {
    return `(terminal ${content.terminalId})`;
  }

  for (const key of ["content", "output", "stdout", "result", "message"]) {
    if (content[key] != null) {
      const inner = extractTextFromContent(content[key]);
      if (inner) return inner;
    }
  }

  // Prefer empty over dumping input-shaped objects (shown via formatToolInput)
  if (
    "variant" in content ||
    "command" in content ||
    "path" in content ||
    "pattern" in content
  ) {
    return "";
  }

  return slimJson(content) || "";
}

function appendBodyLines(
  lines: string[],
  raw: Record<string, unknown>,
): void {
  const body = pickString(raw, BODY_KEYS);
  if (body != null) {
    lines.push(truncate(body, INPUT_BODY_CAP));
  }
  if (typeof raw.old_string === "string" || typeof raw.new_string === "string") {
    if (raw.old_string) lines.push(`- ${String(raw.old_string).slice(0, 400)}`);
    if (raw.new_string) lines.push(`+ ${String(raw.new_string).slice(0, 400)}`);
  }
  if (raw.oldText != null || raw.newText != null) {
    const block = formatDiffBlock({
      oldText: raw.oldText != null ? String(raw.oldText) : null,
      newText: raw.newText != null ? String(raw.newText) : null,
    });
    if (block) lines.push(block);
  }
}

/** Format tool rawInput into a short human label + detail. Always owns fallbacks. */
export function formatToolInput(raw: unknown): {
  subtitle?: string;
  input?: string;
} {
  if (raw == null) return {};
  if (typeof raw === "string") {
    const t = raw.trim();
    return t ? { input: t } : {};
  }
  if (!isPlainObject(raw)) {
    try {
      return { input: JSON.stringify(raw, null, 2) };
    } catch {
      return {};
    }
  }

  const subtitle =
    pickString(raw, ["description", "label"]) ?? undefined;

  // Bash / shell first
  if (typeof raw.command === "string") {
    const parts = [raw.command];
    if (Array.isArray(raw.args) && raw.args.length) {
      parts.push(raw.args.map(String).join(" "));
    }
    return {
      subtitle,
      input: truncate(parts.filter(Boolean).join(" "), INPUT_BODY_CAP),
    };
  }

  // Grep / search BEFORE path (raw often has both pattern + path)
  if (typeof raw.pattern === "string" || typeof raw.query === "string") {
    const pat =
      typeof raw.pattern === "string" ? raw.pattern : String(raw.query);
    const bits = [`/${pat}/`];
    const p = pickString(raw, PATH_KEYS);
    if (p) bits.push(p);
    if (typeof raw.glob === "string") bits.push(`glob: ${raw.glob}`);
    return { subtitle, input: bits.join("  ") };
  }

  // File path (ACP path / editor target_file / file_path)
  const filePath = pickString(raw, PATH_KEYS);
  if (filePath) {
    const lines = [filePath];
    appendBodyLines(lines, raw);
    return { subtitle, input: lines.join("\n") };
  }

  // Generic preferred keys + body
  const preferred = ["query", "url", "prompt", "name", "id"] as const;
  const lines: string[] = [];
  for (const k of preferred) {
    if (raw[k] != null && typeof raw[k] !== "object") {
      lines.push(`${k}: ${String(raw[k])}`);
    }
  }
  appendBodyLines(lines, raw);
  if (lines.length) return { subtitle, input: lines.join("\n") };

  const fallback = slimJson(raw);
  return { subtitle, input: fallback };
}

export function formatToolDisplay(item: {
  raw?: unknown;
  content?: unknown;
  title?: string;
}): ToolDisplay {
  let { subtitle, input } = formatToolInput(item.raw);

  // Title often is `Execute \`long command\`` when rawInput is thin
  if (!input && item.title) {
    const fromTitle = commandFromExecuteTitle(item.title);
    if (fromTitle) input = truncate(fromTitle, INPUT_BODY_CAP);
  }

  let output = extractTextFromContent(item.content);

  if (
    output.startsWith('"') &&
    output.endsWith('"') &&
    output.includes("\\n")
  ) {
    try {
      const parsed = JSON.parse(output);
      if (typeof parsed === "string") output = parsed;
    } catch {
      /* keep */
    }
  }

  if (output && input && output.trim() === input.trim()) {
    output = "";
  }

  if (output) output = truncate(output, OUTPUT_CAP);

  return {
    subtitle,
    input: input || undefined,
    output: output || undefined,
  };
}

const KIND_LABELS: Record<string, string> = {
  execute: "Execute",
  read: "Read",
  edit: "Edit",
  delete: "Delete",
  move: "Move",
  search: "Search",
  fetch: "Fetch",
  think: "Think",
  other: "Tool",
  switch_mode: "Switch mode",
};

/**
 * Pull shell command out of agent titles like:
 *   Execute `ls -la`
 *   Execute ls -la && …
 */
export function commandFromExecuteTitle(title: string): string | undefined {
  const t = String(title || "").trim();
  if (!t) return undefined;
  const tick = t.match(/^Execute\s+`([\s\S]+)`\s*$/i);
  if (tick?.[1]) return tick[1].trim();
  const plain = t.match(/^Execute\s+(.+)$/i);
  if (plain?.[1] && plain[1].length > 12) return plain[1].trim();
  return undefined;
}

/**
 * Short human action label for permission / tool cards.
 */
export function prettyToolAction(
  kind?: string | null,
  title?: string | null,
): string {
  const k = String(kind || "")
    .toLowerCase()
    .replace(/-/g, "_");
  if (KIND_LABELS[k]) return KIND_LABELS[k];
  const t = String(title || "").trim();
  const m = t.match(/^([A-Za-z][\w /-]{0,24}?)(?:\s*[`:]|\s*$)/);
  if (m && !m[1].includes("/")) return m[1].trim();
  return "Permission required";
}

/**
 * Approval-friendly layout: action + why + command/path (not one giant heading).
 */
export function formatToolCard(item: {
  title?: string | null;
  kind?: string | null;
  raw?: unknown;
  content?: unknown;
}): ToolCard & ToolDisplay {
  const display = formatToolDisplay({
    title: item.title || undefined,
    raw: item.raw,
    content: item.content,
  });
  const action = prettyToolAction(item.kind, item.title);
  const rawObj = isPlainObject(item.raw) ? item.raw : null;
  const isCommand =
    Boolean(rawObj && typeof rawObj.command === "string") ||
    Boolean(item.title && /^Execute\b/i.test(String(item.title)));

  let summary = display.subtitle;
  if (!summary) {
    const t = String(item.title || "").trim();
    // Don't use the full Execute `…` line as the summary
    if (t && !commandFromExecuteTitle(t) && t.length < 120) {
      summary = t;
    }
  }

  return {
    action,
    summary: summary || undefined,
    detail: display.input || undefined,
    fullTitle: item.title ? String(item.title) : undefined,
    isCommand,
    subtitle: display.subtitle,
    input: display.input,
    output: display.output,
  };
}

/** Shell detail with `$ ` prefix for display (idempotent). */
export function formatCommandDetail(card: Pick<ToolCard, "detail" | "isCommand">): string | undefined {
  if (!card.detail) return undefined;
  if (card.isCommand && !card.detail.startsWith("$")) {
    return `$ ${card.detail}`;
  }
  return card.detail;
}

/** Short heading under the action label (summary, or truncated title). */
export function toolCardHeading(
  card: Pick<ToolCard, "summary" | "fullTitle" | "detail">,
  maxLen = 100,
): string | undefined {
  if (card.summary) return card.summary;
  const t = card.fullTitle?.trim();
  if (!t) return undefined;
  if (commandFromExecuteTitle(t) && card.detail) return undefined;
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}
