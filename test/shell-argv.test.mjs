/**
 * shell-argv — quote-safe split / escape / extract for terminal spawn.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractShellCInvocation,
  needsShellEscape,
  shellEscape,
  shellJoin,
  shellSplit,
} from "../electron/shell-argv.mjs";

test("shellSplit: plain words", () => {
  assert.deepEqual(shellSplit("git status -sb"), ["git", "status", "-sb"]);
});

test("shellSplit: single-quoted script body", () => {
  assert.deepEqual(shellSplit("/bin/bash -lc 'git status'"), [
    "/bin/bash",
    "-lc",
    "git status",
  ]);
});

test("shellSplit: double-quoted with nested single", () => {
  assert.deepEqual(shellSplit(`bash -lc "echo 'nested'"`), [
    "bash",
    "-lc",
    "echo 'nested'",
  ]);
});

test("shellSplit: apostrophe via bash '\\'' packing", () => {
  // bash -lc 'echo it'\''s fine'  → words: bash, -lc, echo it's fine
  const line = `/bin/bash -lc 'echo it'\\''s fine'`;
  const words = shellSplit(line);
  assert.ok(words);
  assert.equal(words[0], "/bin/bash");
  assert.equal(words[1], "-lc");
  assert.equal(words[2], "echo it's fine");
});

test("shellSplit: python -c inside single quotes", () => {
  const line = `/bin/bash -lc 'python -c "print(1)"'`;
  const words = shellSplit(line);
  assert.deepEqual(words, ["/bin/bash", "-lc", 'python -c "print(1)"']);
});

test("shellSplit: unclosed quote → null", () => {
  assert.equal(shellSplit("echo 'unterminated"), null);
});

test("shellSplit: empty double quotes yield empty word", () => {
  assert.deepEqual(shellSplit('echo "" x'), ["echo", "", "x"]);
});

test("shellEscape: apostrophe", () => {
  assert.equal(shellEscape("don't"), `'don'\\''t'`);
});

test("shellJoin: preserves args with spaces", () => {
  const line = shellJoin(["git", "commit", "-m", "fix: don't break"]);
  // Round-trip through shellSplit
  const words = shellSplit(line);
  assert.deepEqual(words, ["git", "commit", "-m", "fix: don't break"]);
});

test("needsShellEscape", () => {
  assert.equal(needsShellEscape("plain"), false);
  assert.equal(needsShellEscape("has space"), true);
  assert.equal(needsShellEscape("a'b"), true);
  assert.equal(needsShellEscape(""), true);
});

test("extractShellCInvocation: bash -lc", () => {
  const r = extractShellCInvocation(["/bin/bash", "-lc", "git status"]);
  assert.deepEqual(r, {
    shellName: "bash",
    flag: "-lc",
    script: "git status",
  });
});

test("extractShellCInvocation: separate -l -c", () => {
  const r = extractShellCInvocation(["bash", "-l", "-c", "pwd"]);
  assert.deepEqual(r, { shellName: "bash", flag: "-lc", script: "pwd" });
});

test("extractShellCInvocation: env bash -c", () => {
  const r = extractShellCInvocation(["env", "bash", "-c", "echo hi"]);
  assert.deepEqual(r, { shellName: "bash", flag: "-c", script: "echo hi" });
});

test("extractShellCInvocation: trailing words → null (ambiguous)", () => {
  assert.equal(
    extractShellCInvocation(["bash", "-c", "echo", "extra"]),
    null,
  );
});

test("extractShellCInvocation: not a shell", () => {
  assert.equal(extractShellCInvocation(["git", "status"]), null);
});
