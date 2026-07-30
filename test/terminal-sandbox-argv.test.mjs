/**
 * Sandbox must re-pack host argv with shellJoin — never bare join(" ").
 * Bare join breaks commit messages, paths with spaces, and bash -lc bodies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapInnerCommandForDocker } from "../electron/terminal-sandbox.mjs";
import { shellJoin, shellSplit } from "../electron/shell-argv.mjs";
import { normalizeTerminalSpawn } from "../electron/terminal-spawn.mjs";

test("shellJoin round-trips args with spaces and apostrophes", () => {
  const argv = ["git", "commit", "-m", "fix: don't break"];
  const line = shellJoin(argv);
  assert.equal(line.includes("don't") || line.includes(`'\\''`), true);
  assert.deepEqual(shellSplit(line), argv);
});

test("mapInnerCommandForDocker keeps bash -lc argv intact (no re-join)", () => {
  const script = 'git commit -m "fix: don\'t break"';
  const r = mapInnerCommandForDocker(
    { file: "/bin/bash", fileArgs: ["-lc", script] },
    process.cwd(),
  );
  assert.equal(r.file, "/bin/bash");
  assert.deepEqual(r.fileArgs, ["-lc", script]);
});

test("mapInnerCommandForDocker re-packs Windows git path with shellJoin", () => {
  const msg = "fix: don't break";
  const r = mapInnerCommandForDocker(
    {
      file: "C:\\Program Files\\Git\\cmd\\git.exe",
      fileArgs: ["commit", "-m", msg],
    },
    process.cwd(),
  );
  assert.equal(r.file, "/bin/bash");
  assert.equal(r.fileArgs[0], "-lc");
  const line = r.fileArgs[1];
  // Must NOT be unquoted join — that yields: ... -m fix: don't break
  assert.notEqual(
    line,
    "C:\\Program Files\\Git\\cmd\\git.exe commit -m fix: don't break",
  );
  // shellJoin form keeps message as one word after split
  const words = shellSplit(line);
  assert.ok(words);
  assert.equal(words[words.length - 1], msg);
  assert.equal(words[words.length - 2], "-m");
});

test("mapInnerCommandForDocker bare command passes through", () => {
  const r = mapInnerCommandForDocker(
    { file: "npm", fileArgs: ["run", "build"] },
    process.cwd(),
  );
  assert.equal(r.file, "npm");
  assert.deepEqual(r.fileArgs, ["run", "build"]);
});

test("normalizeTerminalSpawn: command='bash -lc' + args=[script]", () => {
  const r = normalizeTerminalSpawn("bash -lc", ["git status -sb"]);
  assert.match(String(r.execCommand), /bash/i);
  assert.equal(r.args[0], "-lc");
  assert.equal(r.args[1], "git status -sb");
});

test("normalizeTerminalSpawn: command='/bin/bash -c' + args=[script with quotes]", () => {
  const script = `git commit -m "fix: don't break"`;
  const r = normalizeTerminalSpawn("/bin/bash -c", [script]);
  assert.match(String(r.execCommand), /bash/i);
  assert.equal(r.args[0], "-c");
  assert.equal(r.args[1], script);
});

test("normalizeTerminalSpawn: freeform commit with double-quoted message", () => {
  const packed = `git commit -m "fix: don't break"`;
  const r = normalizeTerminalSpawn(packed, []);
  assert.match(String(r.execCommand), /bash/i);
  // Original freeform is the -lc body — quotes intact, no strip
  assert.equal(r.args[1], packed);
});

test("normalizeTerminalSpawn: real argv never re-escapes apostrophe", () => {
  const r = normalizeTerminalSpawn("git", [
    "commit",
    "-m",
    "fix: don't break",
  ]);
  assert.equal(r.execCommand, "git");
  assert.deepEqual(r.args, ["commit", "-m", "fix: don't break"]);
});
