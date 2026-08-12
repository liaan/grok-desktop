/**
 * ACP file-read helpers — home expansion, image magic, binary refusal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isLikelyBinary,
  mimeFromExtension,
  readFileForAcp,
  readFileForPeek,
  sniffImageMime,
} from "../electron/fs-content.mjs";
import { expandUserPath } from "../electron/path-safety.mjs";

test("expandUserPath expands ~/", () => {
  const home = os.homedir();
  assert.equal(expandUserPath("~/foo/bar"), path.join(home, "foo/bar"));
  assert.equal(expandUserPath("~"), home);
  assert.equal(expandUserPath("/abs/path"), "/abs/path");
});

test("sniffImageMime detects PNG magic", () => {
  // Minimal PNG signature + padding
  const buf = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  assert.equal(sniffImageMime(buf), "image/png");
  assert.equal(sniffImageMime(Buffer.from("hello")), null);
});

test("isLikelyBinary finds NUL", () => {
  assert.equal(isLikelyBinary(Buffer.from("hello")), false);
  assert.equal(isLikelyBinary(Buffer.from([0x68, 0x00, 0x69])), true);
});

test("mimeFromExtension", () => {
  assert.equal(mimeFromExtension("a.PNG"), "image/png");
  assert.equal(mimeFromExtension("x.txt"), null);
});

test("readFileForAcp returns metadata only for small PNG (no base64 dump)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-fs-"));
  const file = path.join(dir, "tiny.png");
  // 1x1 transparent PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(file, png);
  try {
    const r = await readFileForAcp(file);
    assert.equal(r.kind, "image");
    assert.equal(r.mime, "image/png");
    assert.match(r.content, /binary image image\/png/i);
    assert.ok(!r.content.includes("base64,"), "must not inline base64 in text API");
    assert.match(r.content, /Attach the image|composer|vision/i);
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("readFileForAcp text with line limit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-fs-"));
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "one\ntwo\nthree\n");
  try {
    const r = await readFileForAcp(file, { line: 2, limit: 1 });
    assert.equal(r.kind, "text");
    assert.equal(r.content, "two");
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("readFileForPeek caps bytes and refuses binary from a prefix", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-peek-"));
  const text = path.join(dir, "big.txt");
  fs.writeFileSync(text, "a".repeat(1000));
  const bin = path.join(dir, "x.bin");
  fs.writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02]));
  try {
    const capped = await readFileForPeek(text, { cap: 50 });
    assert.equal(capped.startsWith("a".repeat(50)), true);
    assert.match(capped, /truncated/);
    await assert.rejects(() => readFileForPeek(bin), /Binary file/);
  } finally {
    try {
      fs.unlinkSync(text);
      fs.unlinkSync(bin);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("readFileForAcp refuses non-image binary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-fs-"));
  const file = path.join(dir, "blob.bin");
  fs.writeFileSync(file, Buffer.from([0x00, 0x01, 0x02, 0xff]));
  try {
    const r = await readFileForAcp(file);
    assert.equal(r.kind, "binary");
    assert.match(r.content, /binary file/i);
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});
