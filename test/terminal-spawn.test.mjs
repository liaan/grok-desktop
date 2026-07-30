/**
 * ACP terminal spawn normalization — multi-word agent commands must not be
 * used as the executable path (ENOENT). Drives normalizeTerminalSpawn export.
 *
 * Note: on Windows, bashPath() may be `C:\Program Files\Git\bin\bash.exe`
 * (spaces in install path are fine for spawn when passed as a single argv0).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  maybeMaterializeScriptSpawn,
  normalizeTerminalSpawn,
} from "../electron/acp-terminals.mjs";
import { looksLikeScriptBody } from "../electron/shell-argv.mjs";

function assertBashLc(r, scriptIncludes) {
  assert.equal(r.useShell, false);
  assert.match(String(r.execCommand), /bash/i);
  assert.ok(r.args[0] === "-lc" || r.args[0] === "-c");
  if (scriptIncludes != null) {
    assert.ok(
      String(r.args[1]).includes(scriptIncludes),
      `expected script to include ${JSON.stringify(scriptIncludes)}, got ${JSON.stringify(r.args[1])}`,
    );
  }
}

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
  assertBashLc(r, "git");
});

test("normalizeTerminalSpawn keeps simple token + argv", () => {
  const r = normalizeTerminalSpawn("git", ["status", "-sb"]);
  assert.equal(r.execCommand, "git");
  assert.deepEqual(r.args, ["status", "-sb"]);
});

test("normalizeTerminalSpawn preserves commit message apostrophe in real argv", () => {
  const r = normalizeTerminalSpawn("git", [
    "commit",
    "-m",
    "fix: don't break",
  ]);
  assert.equal(r.execCommand, "git");
  assert.deepEqual(r.args, ["commit", "-m", "fix: don't break"]);
});

test("normalizeTerminalSpawn bash -c with double quotes", () => {
  const packed = 'bash -c "echo hi"';
  const r = normalizeTerminalSpawn(packed, []);
  assert.notEqual(r.execCommand, packed);
  assert.match(String(r.execCommand), /bash/i);
  assert.ok(r.args[0] === "-c" || r.args[0] === "-lc");
  assert.equal(r.args[1], "echo hi");
});

test("normalizeTerminalSpawn unwraps nested quotes in script body", () => {
  const packed = `/bin/bash -lc 'git commit -m "fix: msg"'`;
  const r = normalizeTerminalSpawn(packed, []);
  assert.equal(r.args[0], "-lc");
  assert.equal(r.args[1], 'git commit -m "fix: msg"');
});

test("normalizeTerminalSpawn apostrophe packing via bash '\\''", () => {
  // Agent packs: /bin/bash -lc 'echo it'\''s fine'
  const packed = `/bin/bash -lc 'echo it'\\''s fine'`;
  const r = normalizeTerminalSpawn(packed, []);
  assert.match(String(r.execCommand), /bash/i);
  assert.equal(r.args[0], "-lc");
  assert.equal(r.args[1], "echo it's fine");
});

test("normalizeTerminalSpawn freeform keeps original quotes (no strip)", () => {
  const packed = "echo 'hello world'";
  const r = normalizeTerminalSpawn(packed, []);
  assertBashLc(r, "hello");
  // Original freeform string is the script body (quotes intact)
  assert.equal(r.args[1], packed);
});

test("normalizeTerminalSpawn sh -c", () => {
  const r = normalizeTerminalSpawn("sh -c 'ls -la'", []);
  assert.match(String(r.execCommand), /sh/i);
  assert.equal(r.args[0], "-c");
  assert.equal(r.args[1], "ls -la");
});

test("normalizeTerminalSpawn bash -l -c", () => {
  const r = normalizeTerminalSpawn("/bin/bash -l -c 'pwd'", []);
  assert.match(String(r.execCommand), /bash/i);
  assert.equal(r.args[0], "-lc");
  assert.equal(r.args[1], "pwd");
});

test("normalizeTerminalSpawn argv form bash -lc", () => {
  const r = normalizeTerminalSpawn("/bin/bash", ["-lc", "git status"]);
  assert.match(String(r.execCommand), /bash/i);
  assert.equal(r.args[0], "-lc");
  assert.equal(r.args[1], "git status");
});

test("normalizeTerminalSpawn python -c inside packed bash", () => {
  const packed = `/bin/bash -lc 'python -c "print(1)"'`;
  const r = normalizeTerminalSpawn(packed, []);
  assert.equal(r.args[1], 'python -c "print(1)"');
});

test("normalizeTerminalSpawn never uses multi-word exec path", () => {
  for (const packed of [
    "git status",
    "/bin/bash -lc 'true'",
    "echo hi | cat",
    `bash -c "echo 'x'"`,
  ]) {
    const r = normalizeTerminalSpawn(packed, []);
    assert.ok(!/\s/.test(r.execCommand), `exec has space: ${r.execCommand}`);
  }
});

test("normalizeTerminalSpawn keeps Windows-style path + real argv (backslash OK)", () => {
  // Regression: isSimpleExecToken must not treat `\` as shell meta, or
  // Windows absolute paths re-pack into bash -lc and break spawn semantics.
  const exe = "C:\\Users\\foo\\bin\\git.exe";
  const r = normalizeTerminalSpawn(exe, ["status", "-sb"]);
  assert.equal(r.execCommand, exe);
  assert.deepEqual(r.args, ["status", "-sb"]);
});

test("looksLikeScriptBody detects multi-line and heredoc", () => {
  assert.equal(looksLikeScriptBody("echo hi"), false);
  assert.equal(looksLikeScriptBody("echo hi\necho bye"), true);
  assert.equal(looksLikeScriptBody("cat <<'EOF'\nhi\nEOF"), true);
});

test("normalizeTerminalSpawn multi-line freeform stays bash -lc body (not exec path)", () => {
  const multi = "# header\necho LINE2\necho done\n";
  const r = normalizeTerminalSpawn(multi, []);
  assert.match(String(r.execCommand), /bash/i);
  assert.ok(r.args[0] === "-lc" || r.args[0] === "-c");
  assert.ok(String(r.args[1]).includes("LINE2"));
  assert.ok(!/\s/.test(r.execCommand));
});

test("normalizeTerminalSpawn bash + multi-line arg without -c forces -lc", () => {
  // Agent bug: command=bash, args=[multi-line] → would be "bash <filename>"
  // and hit File name too long / No such file.
  const multi = "# use venv\necho OK\n";
  const r = normalizeTerminalSpawn("/bin/bash", [multi]);
  assert.match(String(r.execCommand), /bash/i);
  assert.equal(r.args[0], "-lc");
  assert.equal(r.args[1], multi);
});

test("maybeMaterializeScriptSpawn writes multi-line to temp file", async () => {
  const multi = "# use venv if has tf\necho HELLO_MULTI\n";
  const norm = normalizeTerminalSpawn(multi, []);
  const mat = maybeMaterializeScriptSpawn(norm);
  assert.ok(typeof mat.cleanup === "function");
  // bash -l /tmp/.../run.sh  (login from -lc) — never multi-line as argv0
  assert.ok(mat.args.length === 1 || mat.args.length === 2);
  const scriptPath = mat.args[mat.args.length - 1];
  assert.ok(!looksLikeScriptBody(scriptPath), "script path is a file path");
  assert.ok(fs.existsSync(scriptPath), "temp script exists");
  assert.ok(fs.readFileSync(scriptPath, "utf8").includes("HELLO_MULTI"));

  const out = await new Promise((resolve, reject) => {
    const p = spawn(mat.execCommand, mat.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d;
    });
    p.stderr.on("data", (d) => {
      buf += d;
    });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, buf }));
  });
  mat.cleanup();
  assert.equal(out.code, 0);
  assert.match(out.buf, /HELLO_MULTI/);
  assert.ok(!fs.existsSync(scriptPath), "temp script cleaned up");
});

test("maybeMaterializeScriptSpawn leaves short -lc alone", () => {
  const norm = normalizeTerminalSpawn("echo hi", []);
  const mat = maybeMaterializeScriptSpawn(norm);
  assert.equal(mat.cleanup, undefined);
  assert.ok(mat.args[0] === "-lc" || mat.args[0] === "-c");
  assert.ok(String(mat.args[1]).includes("echo"));
});
