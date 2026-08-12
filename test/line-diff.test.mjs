/**
 * Local line-diff + unified hunks used by tool cards.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const lineDiffUrl = pathToFileURL(
  path.resolve("src/lib/line-diff.ts"),
).href;

const {
  DIFF_CHAR_CAP,
  DIFF_HUNK_CAP,
  DIFF_LINE_CAP,
  NO_NEWLINE_MARK,
  buildHunks,
  computeLineDiff,
  countDiffLines,
  diffLines,
  extractStructuredDiff,
  extractStructuredDiffFromRaw,
  fileFromDiffPayload,
  formatUnifiedHunks,
  hasDiffHunks,
  parseUnifiedPatch,
  shouldRenderDiff,
  sliceStructuredDiff,
  splitLines,
} = await import(lineDiffUrl);

test("splitLines: trailing newline is not an extra empty line", () => {
  assert.deepEqual(splitLines("a\nb\n"), ["a", "b"]);
  assert.deepEqual(splitLines("a\nb"), ["a", "b"]);
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines(null), []);
  assert.deepEqual(splitLines("\n"), [""]);
});

test("splitLines: CRLF normalizes to the same lines as LF", () => {
  assert.deepEqual(splitLines("a\r\nb\r\n"), ["a", "b"]);
  assert.deepEqual(splitLines("a\rb\r"), ["a", "b"]);
});

test("diffLines: identical files are all context", () => {
  const edits = diffLines(["a", "b"], ["a", "b"]);
  assert.deepEqual(edits, [
    { kind: "ctx", text: "a" },
    { kind: "ctx", text: "b" },
  ]);
  assert.equal(buildHunks(edits).length, 0);
});

test("diffLines: new file is all adds", () => {
  const edits = diffLines([], ["hello", "world"]);
  assert.deepEqual(
    edits.map((e) => e.kind),
    ["add", "add"],
  );
  const hunks = buildHunks(edits);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].oldStart, 0);
  assert.equal(hunks[0].oldCount, 0);
  assert.equal(hunks[0].newStart, 1);
  assert.equal(hunks[0].newCount, 2);
});

test("diffLines: deleted file is all dels", () => {
  const hunks = buildHunks(diffLines(["gone"], []));
  assert.equal(hunks[0].newStart, 0);
  assert.equal(hunks[0].newCount, 0);
  assert.equal(hunks[0].oldStart, 1);
  assert.equal(hunks[0].oldCount, 1);
});

test("diffLines: replace a middle line (LCS, not dump-all)", () => {
  const oldLines = ["keep", "old", "tail"];
  const newLines = ["keep", "new", "tail"];
  const edits = diffLines(oldLines, newLines);
  assert.deepEqual(edits, [
    { kind: "ctx", text: "keep" },
    { kind: "del", text: "old" },
    { kind: "add", text: "new" },
    { kind: "ctx", text: "tail" },
  ]);
});

test("diffLines: repeated closing braces still align", () => {
  const oldLines = ["fn() {", "  a", "}", "other() {", "}"];
  const newLines = ["fn() {", "  b", "}", "other() {", "}"];
  const kinds = diffLines(oldLines, newLines).map((e) => `${e.kind}:${e.text}`);
  assert.ok(kinds.includes("del:  a"));
  assert.ok(kinds.includes("add:  b"));
  assert.equal(kinds.filter((k) => k.startsWith("del:")).length, 1);
  assert.equal(kinds.filter((k) => k.startsWith("add:")).length, 1);
});

test("buildHunks: context wraps the change and merges close islands", () => {
  const oldLines = ["1", "2", "3", "4", "5", "6", "7", "8"];
  const newLines = ["1", "2", "X", "4", "5", "6", "7", "8"];
  const hunks = buildHunks(diffLines(oldLines, newLines), 2);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].oldStart, 1);
  const texts = hunks[0].lines.map((l) => `${lineMark(l.kind)}${l.text}`);
  assert.deepEqual(texts, [" 1", " 2", "-3", "+X", " 4", " 5"]);
});

function lineMark(kind) {
  if (kind === "add") return "+";
  if (kind === "del") return "-";
  return " ";
}

test("computeLineDiff: unified header for a search_replace", () => {
  const { hunks, truncated } = computeLineDiff(
    "# Product backlog\n\n- old\n",
    "# Product backlog\n\n- new\n",
  );
  assert.equal(truncated, false);
  assert.equal(hunks.length, 1);
  const text = formatUnifiedHunks(hunks, { path: "docs/BACKLOG.md" });
  assert.match(text, /^--- docs\/BACKLOG\.md/m);
  assert.match(text, /^-- old$/m);
  assert.match(text, /^\+- new$/m);
});

test("computeLineDiff: caps huge inputs", () => {
  const oldText = Array.from({ length: DIFF_LINE_CAP + 50 }, (_, i) => `L${i}`).join(
    "\n",
  );
  const newText = oldText.replace("L10", "CHANGED");
  const { hunks, truncated } = computeLineDiff(oldText, newText);
  assert.equal(truncated, true);
  assert.ok(hunks.length <= DIFF_HUNK_CAP);
});

test("computeLineDiff: missing trailing newline is a visible change", () => {
  const { hunks, truncated } = computeLineDiff("hello", "hello\n");
  assert.equal(truncated, false);
  assert.equal(hunks.length, 1);
  const texts = hunks[0].lines.map((l) => `${l.kind}:${l.text}`);
  assert.ok(texts.includes(`del:${NO_NEWLINE_MARK}`));
  assert.ok(!texts.includes(`add:${NO_NEWLINE_MARK}`));
});

test("parseUnifiedPatch: reads @@ hunks", () => {
  const parsed = parseUnifiedPatch(
    [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-old",
      "+new",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.path, "foo.ts");
  assert.equal(parsed.hunks.length, 1);
  assert.deepEqual(
    parsed.hunks[0].lines.map((l) => l.kind),
    ["ctx", "del", "add"],
  );
});

test("parseUnifiedPatch: --- / +++ inside a hunk stay as body lines", () => {
  const parsed = parseUnifiedPatch(
    [
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1,3 +1,3 @@",
      " keep",
      "--- a flag",
      "+-- a flag",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.path, "README.md");
  assert.equal(parsed.hunks.length, 1);
  assert.deepEqual(
    parsed.hunks[0].lines.map((l) => `${l.kind}:${l.text}`),
    ["ctx:keep", "del:-- a flag", "add:-- a flag"],
  );
});

test("fileFromDiffPayload: caps a huge patch string", () => {
  const patch = [
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,1 +1,1 @@",
    `-${"a".repeat(DIFF_CHAR_CAP)}`,
    "+b",
  ].join("\n");
  const file = fileFromDiffPayload({ patch });
  assert.equal(file.truncated, true);
  const bodyChars = file.hunks.reduce(
    (n, h) => n + h.lines.reduce((m, l) => m + l.text.length, 0),
    0,
  );
  assert.ok(bodyChars < patch.length);
});

test("fileFromDiffPayload: caps patch hunk count", () => {
  const parts = ["--- a/x.ts", "+++ b/x.ts"];
  for (let i = 0; i < DIFF_HUNK_CAP + 20; i++) {
    parts.push(`@@ -${i + 1},1 +${i + 1},1 @@`, "-old", "+new");
  }
  const file = fileFromDiffPayload({ patch: parts.join("\n") });
  assert.equal(file.truncated, true);
  assert.equal(file.hunks.length, DIFF_HUNK_CAP);
});

test("fileFromDiffPayload: caps a single oversized patch hunk", () => {
  const body = Array.from({ length: DIFF_LINE_CAP + 30 }, (_, i) => `+L${i}`);
  const patch = ["--- a/x.ts", "+++ b/x.ts", "@@ -0,0 +1,1 @@", ...body].join(
    "\n",
  );
  const file = fileFromDiffPayload({ patch });
  assert.equal(file.truncated, true);
  const lines = file.hunks.reduce((n, h) => n + h.lines.length, 0);
  assert.ok(lines <= DIFF_LINE_CAP);
});

test("extractStructuredDiff: ACP write block", () => {
  const diff = extractStructuredDiff({
    type: "diff",
    path: "docs/BACKLOG.md",
    oldText: "",
    newText: "# Product backlog\n",
  });
  assert.ok(diff);
  assert.equal(diff.files[0].path, "docs/BACKLOG.md");
  assert.ok(hasDiffHunks(diff));
  assert.equal(diff.files[0].hunks[0].lines[0].kind, "add");
  assert.equal(diff.files[0].hunks[0].lines[0].text, "# Product backlog");
});

test("extractStructuredDiff: nested content array", () => {
  const diff = extractStructuredDiff([
    {
      type: "content",
      content: {
        type: "diff",
        path: "a.md",
        oldText: "x\n",
        newText: "y\n",
      },
    },
  ]);
  assert.equal(diff.files[0].path, "a.md");
  assert.deepEqual(
    diff.files[0].hunks[0].lines.map((l) => l.kind),
    ["del", "add"],
  );
});

test("extractStructuredDiffFromRaw: old_string / new_string", () => {
  const diff = extractStructuredDiffFromRaw({
    path: "src/a.ts",
    old_string: "foo",
    new_string: "bar",
  });
  assert.equal(diff.files[0].path, "src/a.ts");
  assert.ok(hasDiffHunks(diff));
});

test("formatUnifiedHunks: unified fallback (not dump-all old then new)", () => {
  const { hunks } = computeLineDiff("a\nb\nc\n", "a\nB\nc\n");
  const text = formatUnifiedHunks(hunks, { path: "x.ts" });
  assert.match(text, /@@ /);
  assert.match(text, /^-b$/m);
  assert.match(text, /^\+B$/m);
  assert.ok(!text.includes("- a\n- b\n- c"));
});

test("sliceStructuredDiff: collapse preview keeps a prefix", () => {
  const { hunks } = computeLineDiff(
    Array.from({ length: 20 }, (_, i) => `old-${i}`).join("\n"),
    Array.from({ length: 20 }, (_, i) => `new-${i}`).join("\n"),
  );
  const full = { files: [{ hunks, truncated: false }] };
  assert.ok(countDiffLines(full) > 8);
  const sliced = sliceStructuredDiff(full, 8);
  assert.equal(countDiffLines(sliced), 8);
  const h = sliced.files[0].hunks[0];
  assert.equal(h.oldCount, h.lines.filter((l) => l.kind !== "add").length);
  assert.equal(h.newCount, h.lines.filter((l) => l.kind !== "del").length);
});

test("shouldRenderDiff: truncated empty hunks still render", () => {
  const diff = {
    files: [{ path: "big.ts", hunks: [], truncated: true }],
  };
  assert.equal(hasDiffHunks(diff), false);
  assert.equal(shouldRenderDiff(diff), true);
});
