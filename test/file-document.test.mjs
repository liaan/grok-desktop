/**
 * Pure helpers for the Files peek document object.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canEditFile,
  finishSave,
  isDirty,
  joinProjectPath,
} from "../src/components/files/types.ts";

const readyFile = {
  status: "ready",
  path: "src/a.ts",
  absPath: "/proj/src/a.ts",
  kind: "file",
  draft: "hello",
  saved: "hello",
  binary: false,
  truncated: false,
  error: null,
};

test("joinProjectPath joins relative, keeps absolute, handles empty", () => {
  assert.equal(joinProjectPath("/proj", "src/a.ts"), "/proj/src/a.ts");
  assert.equal(joinProjectPath("/proj/", "src/a.ts"), "/proj/src/a.ts");
  assert.equal(joinProjectPath("/proj", ""), "/proj");
  assert.equal(joinProjectPath("/proj", "/abs/x"), "/abs/x");
  assert.equal(
    joinProjectPath("C:\\proj", "src\\a.ts"),
    "C:\\proj\\src\\a.ts",
  );
  assert.equal(joinProjectPath("C:\\proj", "D:\\other"), "D:\\other");
});

test("isDirty is false for null, diffs, binary, truncated, and matching draft", () => {
  assert.equal(isDirty(null), false);
  assert.equal(isDirty(readyFile), false);
  assert.equal(isDirty({ ...readyFile, draft: "changed" }), true);
  assert.equal(isDirty({ ...readyFile, draft: "changed", binary: true }), false);
  assert.equal(
    isDirty({ ...readyFile, draft: "changed", truncated: true }),
    false,
  );
  assert.equal(isDirty({ ...readyFile, saved: null, draft: "x" }), false);
  assert.equal(
    isDirty({ ...readyFile, kind: "diff", draft: "x", saved: "y" }),
    false,
  );
});

test("finishSave ignores a write after the peek or project moved on", () => {
  const next = {
    ...readyFile,
    path: "src/b.ts",
    absPath: "/proj/src/b.ts",
    draft: "other",
    saved: "other",
  };
  assert.equal(
    finishSave(next, {
      seq: 1,
      currentSeq: 2,
      absPath: readyFile.absPath,
      written: "hello",
    }),
    next,
  );
  assert.deepEqual(
    finishSave(next, {
      seq: 2,
      currentSeq: 2,
      absPath: readyFile.absPath,
      written: "hello",
    }),
    next,
  );
  assert.equal(finishSave(null, {
    seq: 1,
    currentSeq: 1,
    absPath: readyFile.absPath,
    written: "hello",
  }), null);
});

test("finishSave writes the captured snapshot, not later keystrokes", () => {
  const typing = { ...readyFile, draft: "hello!" };
  const applied = finishSave(typing, {
    seq: 1,
    currentSeq: 1,
    absPath: readyFile.absPath,
    written: "hello",
  });
  assert.equal(applied?.saved, "hello");
  assert.equal(applied?.draft, "hello!");
  assert.equal(isDirty(applied), true);
});

test("canEditFile is false while loading, on error, binary, truncated, or diffs", () => {
  assert.equal(canEditFile(null), false);
  assert.equal(canEditFile(readyFile), true);
  assert.equal(canEditFile({ ...readyFile, status: "loading" }), false);
  assert.equal(
    canEditFile({ ...readyFile, status: "error", error: "nope" }),
    false,
  );
  assert.equal(canEditFile({ ...readyFile, binary: true }), false);
  assert.equal(canEditFile({ ...readyFile, truncated: true }), false);
  assert.equal(canEditFile({ ...readyFile, kind: "diff" }), false);
});
