/**
 * grok-cli JSON parse + runGrok exit / missing-binary contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  checkGrokUpdate,
  isMissingGrokBinaryError,
  missingGrokBinaryMessage,
  parseGrokJson,
  runGrok,
  updateFromData,
  versionFromData,
} from "../electron/grok-cli.mjs";

test("parseGrokJson reads a bare object", () => {
  assert.deepEqual(parseGrokJson('{"currentVersion":"1.0.3"}'), {
    currentVersion: "1.0.3",
  });
});

test("parseGrokJson extracts an object wrapped in log noise", () => {
  assert.deepEqual(
    parseGrokJson('checking…\n{"updateAvailable":true,"latestVersion":"2.0.0"}\n'),
    { updateAvailable: true, latestVersion: "2.0.0" },
  );
});

test("parseGrokJson throws on empty or non-json", () => {
  assert.throws(() => parseGrokJson(""), /Empty grok output/);
  assert.throws(() => parseGrokJson("not json"), /Failed to parse grok JSON/);
});

test("versionFromData prefers currentVersion", () => {
  assert.equal(versionFromData({ currentVersion: "1.0.3 (abc)" }), "1.0.3 (abc)");
  assert.equal(versionFromData({ version: "9" }), "9");
  assert.equal(versionFromData({ grokVersion: "8" }), "8");
  assert.equal(versionFromData(null), null);
  assert.equal(versionFromData({}), null);
});

test("updateFromData maps grok update --check --json", () => {
  assert.deepEqual(
    updateFromData({
      currentVersion: "1.0.3",
      latestVersion: "1.0.4",
      updateAvailable: true,
      channel: "stable",
    }),
    {
      currentVersion: "1.0.3",
      latestVersion: "1.0.4",
      updateAvailable: true,
      channel: "stable",
    },
  );
  assert.equal(updateFromData(null).updateAvailable, false);
});

test("isMissingGrokBinaryError matches ENOENT and install copy", () => {
  assert.equal(isMissingGrokBinaryError({ code: "ENOENT", message: "spawn grok" }), true);
  assert.equal(isMissingGrokBinaryError(new Error("spawn grok ENOENT")), true);
  assert.equal(
    isMissingGrokBinaryError(new Error(missingGrokBinaryMessage("/opt/grok"))),
    true,
  );
  assert.equal(isMissingGrokBinaryError(new Error("Agent exited (code=1)")), false);
});

test("runGrok json:true parses stdout from a fake binary", async () => {
  const r = await runGrok(
    ["-e", "console.log(JSON.stringify({currentVersion:'1.2.3'}))"],
    { bin: process.execPath, json: true, env: process.env },
  );
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.data.currentVersion, "1.2.3");
  assert.equal(r.error, null);
});

test("runGrok non-zero exit is not ok", async () => {
  const r = await runGrok(["-e", "console.error('fail'); process.exit(3)"], {
    bin: process.execPath,
    env: process.env,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /fail/);
  assert.match(String(r.error), /fail|exited 3/);
});

test("runGrok json:true with non-json stdout is not ok", async () => {
  const r = await runGrok(["-e", "console.log('nope')"], {
    bin: process.execPath,
    json: true,
    env: process.env,
  });
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.match(String(r.error), /parse grok JSON/i);
});

test("runGrok missing binary returns CLI-not-found", async () => {
  const bin = path.join(os.tmpdir(), "grok-desktop-missing-bin-xyz");
  const r = await runGrok(["version"], { bin, env: process.env });
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.equal(isMissingGrokBinaryError({ message: r.error }), true);
});

test("checkGrokUpdate on a missing binary does not throw", async () => {
  const chk = await checkGrokUpdate({
    bin: path.join(os.tmpdir(), "grok-desktop-missing-update"),
    timeoutMs: 4000,
  });
  assert.equal(chk.ok, false);
  assert.equal(chk.updateAvailable, false);
  assert.equal(chk.currentVersion, null);
  assert.equal(chk.data, null);
});
