/** Local line-diff + unified hunks for ACP { type: "diff" } tool cards. */

export type DiffOp = "ctx" | "add" | "del";

export type DiffLine = {
  kind: DiffOp;
  text: string;
  oldNo: number | null;
  newNo: number | null;
};

export type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type StructuredDiffFile = {
  path?: string;
  hunks: DiffHunk[];
  truncated: boolean;
};

export type StructuredDiff = {
  files: StructuredDiffFile[];
};

export const DIFF_HUNK_CAP = 80;
/** Per-side line cap before LCS (keeps n*m bounded). */
export const DIFF_LINE_CAP = 400;
export const DIFF_CHAR_CAP = 24_000;
export const DIFF_CONTEXT = 3;
export const DIFF_COLLAPSE_LINES = 40;
const MAX_LCS_CELLS = 160_000;

export type LineEdit = { kind: DiffOp; text: string };

/** Split into lines; a trailing newline does not add an empty last line. */
export function splitLines(text: string | null | undefined): string[] {
  if (text == null || text === "") return [];
  const s = String(text);
  if (s.endsWith("\n")) return s.slice(0, -1).split("\n");
  return s.split("\n");
}

function capSide(text: string | null | undefined): {
  lines: string[];
  truncated: boolean;
} {
  if (text == null) return { lines: [], truncated: false };
  let s = String(text);
  let truncated = false;
  if (s.length > DIFF_CHAR_CAP) {
    s = s.slice(0, DIFF_CHAR_CAP);
    truncated = true;
  }
  let lines = splitLines(s);
  if (lines.length > DIFF_LINE_CAP) {
    lines = lines.slice(0, DIFF_LINE_CAP);
    truncated = true;
  }
  return { lines, truncated };
}

/** Common prefix/suffix + LCS of the middle (aligns repeated lines like `}`). */
export function diffLines(oldLines: string[], newLines: string[]): LineEdit[] {
  let start = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (start < minLen && oldLines[start] === newLines[start]) start += 1;

  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (
    endOld > start &&
    endNew > start &&
    oldLines[endOld - 1] === newLines[endNew - 1]
  ) {
    endOld -= 1;
    endNew -= 1;
  }

  const prefix: LineEdit[] = oldLines
    .slice(0, start)
    .map((text) => ({ kind: "ctx", text }));
  const suffix: LineEdit[] = oldLines
    .slice(endOld)
    .map((text) => ({ kind: "ctx", text }));

  const midOld = oldLines.slice(start, endOld);
  const midNew = newLines.slice(start, endNew);
  return [...prefix, ...lcsMiddle(midOld, midNew), ...suffix];
}

function lcsMiddle(a: string[], b: string[]): LineEdit[] {
  if (a.length === 0) return b.map((text) => ({ kind: "add" as const, text }));
  if (b.length === 0) return a.map((text) => ({ kind: "del" as const, text }));
  if (a.length * b.length > MAX_LCS_CELLS) {
    return [
      ...a.map((text) => ({ kind: "del" as const, text })),
      ...b.map((text) => ({ kind: "add" as const, text })),
    ];
  }

  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from(
    { length: n + 1 },
    () => new Uint16Array(m + 1),
  );
  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    const row = dp[i];
    const prev = dp[i - 1];
    for (let j = 1; j <= m; j++) {
      row[j] =
        ai === b[j - 1] ? prev[j - 1] + 1 : prev[j] >= row[j - 1] ? prev[j] : row[j - 1];
    }
  }

  const edits: LineEdit[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      edits.push({ kind: "ctx", text: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (dp[i][j - 1] >= dp[i - 1][j]) {
      // Prefer add while walking backward so the reversed SES is del-then-add.
      edits.push({ kind: "add", text: b[j - 1] });
      j -= 1;
    } else {
      edits.push({ kind: "del", text: a[i - 1] });
      i -= 1;
    }
  }
  while (i > 0) {
    edits.push({ kind: "del", text: a[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    edits.push({ kind: "add", text: b[j - 1] });
    j -= 1;
  }
  edits.reverse();
  return edits;
}

export function buildHunks(
  edits: LineEdit[],
  context = DIFF_CONTEXT,
): DiffHunk[] {
  const numbered: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const e of edits) {
    if (e.kind === "ctx") {
      numbered.push({ kind: "ctx", text: e.text, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    } else if (e.kind === "del") {
      numbered.push({ kind: "del", text: e.text, oldNo, newNo: null });
      oldNo += 1;
    } else {
      numbered.push({ kind: "add", text: e.text, oldNo: null, newNo });
      newNo += 1;
    }
  }

  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < numbered.length) {
    if (numbered[i].kind === "ctx") {
      i += 1;
      continue;
    }
    const start = Math.max(0, i - context);
    let end = i + 1;
    while (end < numbered.length) {
      if (numbered[end].kind !== "ctx") {
        end += 1;
        continue;
      }
      let run = 0;
      let k = end;
      while (k < numbered.length && numbered[k].kind === "ctx") {
        run += 1;
        k += 1;
      }
      if (k === numbered.length) {
        end = Math.min(numbered.length, end + context);
        break;
      }
      if (run <= context * 2) {
        end = k;
        continue;
      }
      end = end + context;
      break;
    }

    const slice = numbered.slice(start, end);
    hunks.push(hunkFromLines(slice));
    i = end;
  }
  return hunks;
}

function hunkFromLines(slice: DiffLine[]): DiffHunk {
  const oldCount = slice.filter((l) => l.kind !== "add").length;
  const newCount = slice.filter((l) => l.kind !== "del").length;
  const firstOld = slice.find((l) => l.oldNo != null)?.oldNo ?? 0;
  const firstNew = slice.find((l) => l.newNo != null)?.newNo ?? 0;
  return {
    oldStart: oldCount === 0 ? 0 : firstOld,
    oldCount,
    newStart: newCount === 0 ? 0 : firstNew,
    newCount,
    lines: slice,
  };
}

export function computeLineDiff(
  oldText: string | null | undefined,
  newText: string | null | undefined,
  opts?: { context?: number; maxHunks?: number },
): { hunks: DiffHunk[]; truncated: boolean } {
  const a = capSide(oldText);
  const b = capSide(newText);
  const edits = diffLines(a.lines, b.lines);
  let hunks = buildHunks(edits, opts?.context ?? DIFF_CONTEXT);
  const maxHunks = opts?.maxHunks ?? DIFF_HUNK_CAP;
  let truncated = a.truncated || b.truncated;
  if (hunks.length > maxHunks) {
    hunks = hunks.slice(0, maxHunks);
    truncated = true;
  }
  return { hunks, truncated };
}

/** Parse `@@` unified patches; also accepts a bare +/- dump as one hunk. */
export function parseUnifiedPatch(patch: string): {
  path?: string;
  hunks: DiffHunk[];
} | null {
  const raw = String(patch);
  if (!raw.trim()) return null;
  const lines = raw.replace(/\n$/, "").split("\n");
  let path: string | undefined;
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const p = stripDiffPath(line.slice(4));
      if (p) path = p;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = stripDiffPath(line.slice(4));
      if (p) path = p;
      continue;
    }
    const header = line.match(
      /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/,
    );
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number(header[1]),
        oldCount: header[2] != null ? Number(header[2]) : 1,
        newStart: Number(header[3]),
        newCount: header[4] != null ? Number(header[4]) : 1,
        lines: [],
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      current.lines.push({
        kind: "add",
        text: line.slice(1),
        oldNo: null,
        newNo: null,
      });
    } else if (line.startsWith("-")) {
      current.lines.push({
        kind: "del",
        text: line.slice(1),
        oldNo: null,
        newNo: null,
      });
    } else {
      current.lines.push({
        kind: "ctx",
        text: line.startsWith(" ") ? line.slice(1) : line,
        oldNo: null,
        newNo: null,
      });
    }
  }
  if (current) hunks.push(current);
  if (hunks.length > 0) return { path, hunks };

  const looksLikeDump = lines.some(
    (l) => l.startsWith("+") || l.startsWith("-"),
  );
  if (!looksLikeDump) return null;
  const dumpLines: DiffLine[] = [];
  for (const line of lines) {
    if (line.startsWith("+")) {
      dumpLines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: null });
    } else if (line.startsWith("-")) {
      dumpLines.push({ kind: "del", text: line.slice(1), oldNo: null, newNo: null });
    } else if (line.startsWith(" ") || line === "") {
      dumpLines.push({
        kind: "ctx",
        text: line.startsWith(" ") ? line.slice(1) : line,
        oldNo: null,
        newNo: null,
      });
    }
  }
  if (dumpLines.length === 0) return null;
  return { path, hunks: [hunkFromLines(dumpLines)] };
}

function stripDiffPath(raw: string): string | undefined {
  const p = raw.replace(/^[ab]\//, "").trim();
  if (!p || p === "/dev/null") return undefined;
  return p;
}

export function formatUnifiedHunks(
  hunks: DiffHunk[],
  opts?: { path?: string; truncated?: boolean },
): string {
  const out: string[] = [];
  if (opts?.path) {
    out.push(`--- ${opts.path}`);
    out.push(`+++ ${opts.path}`);
  }
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`);
    for (const line of h.lines) {
      const mark = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      out.push(mark + line.text);
    }
  }
  if (opts?.truncated) out.push("… (truncated)");
  return out.join("\n");
}

export function hasDiffHunks(diff: StructuredDiff | undefined | null): boolean {
  if (!diff) return false;
  return diff.files.some((f) => f.hunks.some((h) => h.lines.length > 0));
}

export function countDiffLines(diff: StructuredDiff): number {
  let n = 0;
  for (const f of diff.files) {
    for (const h of f.hunks) n += h.lines.length;
  }
  return n;
}

/** First `maxLines` of hunk body (for collapsed preview). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

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

export function pickDiffStrings(raw: Record<string, unknown>): {
  path?: string;
  oldText?: string | null;
  newText?: string | null;
  patch?: string;
} {
  const filePath = pickString(raw, ["path", "file", "target_file", "file_path"]);
  const patch = pickString(raw, ["diff", "patch"]);
  const oldRaw = raw.oldText ?? raw.old_text ?? raw.old_string;
  const newRaw = raw.newText ?? raw.new_text ?? raw.new_string;
  return {
    path: filePath,
    patch,
    oldText: oldRaw != null ? String(oldRaw) : null,
    newText: newRaw != null ? String(newRaw) : null,
  };
}

export function fileFromDiffPayload(opts: {
  path?: string;
  oldText?: string | null;
  newText?: string | null;
  patch?: string;
}): StructuredDiffFile {
  if (opts.oldText != null || opts.newText != null) {
    const { hunks, truncated } = computeLineDiff(opts.oldText, opts.newText);
    return { path: opts.path, hunks, truncated };
  }
  if (opts.patch) {
    const parsed = parseUnifiedPatch(opts.patch);
    if (parsed) {
      const hunks = parsed.hunks.slice(0, DIFF_HUNK_CAP);
      return {
        path: opts.path ?? parsed.path,
        hunks,
        truncated: parsed.hunks.length > DIFF_HUNK_CAP,
      };
    }
  }
  return { path: opts.path, hunks: [], truncated: false };
}

function collectDiffBlocks(content: unknown): Record<string, unknown>[] {
  if (content == null) return [];
  if (Array.isArray(content)) return content.flatMap(collectDiffBlocks);
  if (!isPlainObject(content)) return [];
  if (content.type === "diff") return [content];
  if (content.type === "content" && content.content != null) {
    return collectDiffBlocks(content.content);
  }
  return [];
}

/** Keep ACP diffs structured so the card can color hunks (not only flatten). */
export function extractStructuredDiff(
  content: unknown,
): StructuredDiff | undefined {
  const blocks = collectDiffBlocks(content);
  if (!blocks.length) return undefined;
  const files = blocks.map((block) => fileFromDiffPayload(pickDiffStrings(block)));
  return { files };
}

export function extractStructuredDiffFromRaw(
  raw: unknown,
): StructuredDiff | undefined {
  if (!isPlainObject(raw)) return undefined;
  const hasTexts =
    raw.oldText != null ||
    raw.newText != null ||
    raw.old_text != null ||
    raw.new_text != null ||
    raw.old_string != null ||
    raw.new_string != null;
  const hasPatch =
    typeof raw.diff === "string" || typeof raw.patch === "string";
  if (!hasTexts && !hasPatch) return undefined;
  const file = fileFromDiffPayload(pickDiffStrings(raw));
  if (!file.path && file.hunks.length === 0) return undefined;
  return { files: [file] };
}

export function sliceStructuredDiff(
  diff: StructuredDiff,
  maxLines: number,
): StructuredDiff {
  let left = maxLines;
  const files: StructuredDiffFile[] = [];
  for (const f of diff.files) {
    if (left <= 0) break;
    const hunks: DiffHunk[] = [];
    for (const h of f.hunks) {
      if (left <= 0) break;
      if (h.lines.length <= left) {
        hunks.push(h);
        left -= h.lines.length;
      } else {
        hunks.push({ ...h, lines: h.lines.slice(0, left) });
        left = 0;
      }
    }
    if (hunks.length) files.push({ ...f, hunks });
  }
  return { files };
}
