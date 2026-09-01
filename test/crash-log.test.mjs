import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  errorFields,
  getCrashLogPath,
  writeCrashLog,
} from "../electron/crash-log.mjs";

test("getCrashLogPath ends with desktop-crash.log", () => {
  const p = getCrashLogPath();
  assert.match(p, /desktop-crash\.log$/);
});

test("errorFields maps Error name/message/stack", () => {
  const err = new Error("boom");
  err.code = -32000;
  const f = errorFields(err);
  assert.equal(f.name, "Error");
  assert.equal(f.message, "boom");
  assert.match(String(f.stack), /boom/);
  assert.equal(f.code, -32000);
});

test("errorFields stringifies non-errors", () => {
  assert.equal(errorFields("nope").message, "nope");
  assert.equal(errorFields(null).message, "null");
});

test("writeCrashLog appends a JSON line and never throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-crash-log-"));
  const file = path.join(dir, "desktop-crash.log");
  writeCrashLog("uncaughtException", "test boom", { n: 1 }, file);
  writeCrashLog("app", "still ok", undefined, file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.trim().split("\n");
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.scope, "uncaughtException");
  assert.equal(first.msg, "test boom");
  assert.equal(first.data.n, 1);
  assert.ok(first.t);
  assert.ok(first.pid);
  writeCrashLog("app", "circular", { self: {} }, file);
  assert.doesNotThrow(() => writeCrashLog("app", "ok", { a: 1 }, file));
});
