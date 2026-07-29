/**
 * ACP terminal spawn normalization — multi-word agent commands must not be
 * used as the executable path (ENOENT). Drives normalizeTerminalSpawn export.
 *
 * Note: on Windows, bashPath() may be `C:\Program Files\Git\bin\bash.exe`
 * (spaces in install path are fine for spawn when passed as a single argv0).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTerminalSpawn } from "../electron/acp-terminals.mjs";

test("normalizeTerminalSpawn unwraps /bin/bash -lc 'script'", () => {
  const packed = "/bin/bash -lc 'git status'";
  const r = normalizeTerminalSpawn(packed, []);
  assert.equal(r.useShell, false);
  // Must not spawn the packed multi-word line as executable
  assert.notEqual(r.execCommand, packed);
  assert.notEqual(r.execCommand, "/bin/bash -lc 'git status'");
  assert.match(String(r.execCommand), /bash/i);
  assert.equal(r.args[0], "-lc");
  assert.equal(r.args[1], "git status");
});

test("normalizeTerminalSpawn packs spaced command via bash -lc (not as path)", () => {
  const packed = "git status";
  const r = normalizeTerminalSpawn(packed, []);
  assert.notEqual(r.execCommand, packed);
  assert.match(String(r.execCommand), /bash/i);
  assert.ok(r.args.includes("-lc") || r.args.includes("-c"));
  assert.ok(r.args.some((a) => String(a).includes("git")));
});

test("normalizeTerminalSpawn keeps simple token + argv", () => {
  const r = normalizeTerminalSpawn("git", ["status", "-sb"]);
  assert.equal(r.execCommand, "git");
  assert.deepEqual(r.args, ["status", "-sb"]);
});

test("normalizeTerminalSpawn bash -c with double quotes", () => {
  const packed = 'bash -c "echo hi"';
  const r = normalizeTerminalSpawn(packed, []);
  assert.notEqual(r.execCommand, packed);
  assert.match(String(r.execCommand), /bash/i);
  assert.ok(r.args[0] === "-c" || r.args[0] === "-lc");
  assert.equal(r.args[1], "echo hi");
});
