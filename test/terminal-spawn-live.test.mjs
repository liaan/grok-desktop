/**
 * Live process spawn — quote safety end-to-end (not just argv shape).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolveSpawnPlan } from "../electron/terminal-spawn.mjs";

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{ code: number | null, buf: string }>}
 */
function runPlan(cmd, args = []) {
  const plan = resolveSpawnPlan(cmd, args);
  return new Promise((resolve, reject) => {
    const p = spawn(plan.execCommand, plan.args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: plan.useShell,
    });
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d;
    });
    p.stderr.on("data", (d) => {
      buf += d;
    });
    p.on("error", (err) => {
      if (plan.cleanup) plan.cleanup();
      reject(err);
    });
    p.on("close", (code) => {
      if (plan.cleanup) plan.cleanup();
      resolve({ code, buf: buf.trim() });
    });
  });
}

test("live: freeform single-quoted echo", async () => {
  const r = await runPlan("echo 'hello world'", []);
  assert.equal(r.code, 0);
  assert.equal(r.buf, "hello world");
});

test("live: real argv with space", async () => {
  const r = await runPlan("echo", ["hello world"]);
  assert.equal(r.code, 0);
  assert.equal(r.buf, "hello world");
});

test("live: packed python -c", async () => {
  const r = await runPlan(`/bin/bash -lc 'python3 -c "print(42)"'`, []);
  assert.equal(r.code, 0);
  assert.equal(r.buf, "42");
});

test("live: bash -lc command + script in args", async () => {
  const r = await runPlan("bash -lc", ["echo OK_GLUE"]);
  assert.equal(r.code, 0);
  assert.equal(r.buf, "OK_GLUE");
});

test("live: apostrophe via bash packing in message", async () => {
  // /bin/bash -lc 'MSG="fix: don'\''t"; echo "$MSG"'
  const packed = `/bin/bash -lc 'MSG="fix: don'\\''t"; echo "$MSG"'`;
  const r = await runPlan(packed, []);
  assert.equal(r.code, 0);
  assert.equal(r.buf, "fix: don't");
});

test("live: freeform double-quoted message with apostrophe", async () => {
  const r = await runPlan(`python3 -c "print(\\"don't\\")"`, []);
  assert.equal(r.code, 0);
  assert.equal(r.buf, "don't");
});

test("live: pipe", async () => {
  const r = await runPlan("echo hi | tr h H", []);
  assert.equal(r.code, 0);
  assert.equal(r.buf, "Hi");
});

test("live: multi-line script materialize", async () => {
  const r = await runPlan("echo LINE1\necho LINE2\n", []);
  assert.equal(r.code, 0);
  assert.match(r.buf, /LINE1/);
  assert.match(r.buf, /LINE2/);
});
