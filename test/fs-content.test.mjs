/**
 * ACP file-read helpers — home expansion, image magic, binary refusal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decodeUtf8Text,
  isLikelyBinary,
  mimeFromExtension,
  readFileForAcp,
  readFileForEdit,
  readFileForPeek,
  sniffImageMime,
  writeFileForEdit,
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

test("readFileForEdit does not append a truncation marker", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "notes.txt");
  fs.writeFileSync(file, "hello world");
  try {
    const r = await readFileForEdit(file);
    assert.equal(r.binary, false);
    assert.equal(r.truncated, false);
    assert.equal(r.text, "hello world");
    const capped = await readFileForEdit(file, { cap: 5 });
    assert.equal(capped.truncated, true);
    assert.equal(capped.text, "hello");
    assert.ok(!capped.text.includes("truncated"));
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("readFileForEdit flags binary without throwing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "x.bin");
  fs.writeFileSync(file, Buffer.from([0x00, 0x01, 0x02]));
  try {
    const r = await readFileForEdit(file);
    assert.equal(r.binary, true);
    assert.equal(r.text, "");
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("decodeUtf8Text rejects invalid sequences", () => {
  assert.equal(decodeUtf8Text(Buffer.from("ok")), "ok");
  assert.equal(decodeUtf8Text(Buffer.from([])), "");
  assert.equal(decodeUtf8Text(Buffer.from([0xe9])), null);
  assert.equal(decodeUtf8Text(Buffer.from([0xef, 0xbf, 0xbd])), "\uFFFD");
});

test("readFileForEdit keeps a file that contains U+FFFD as text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "fffd.txt");
  fs.writeFileSync(file, "before \uFFFD after", "utf8");
  try {
    const r = await readFileForEdit(file);
    assert.equal(r.binary, false);
    assert.equal(r.text, "before \uFFFD after");
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("readFileForEdit cap mid-sequence is truncated text not binary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "cafe.txt");
  fs.writeFileSync(file, Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x21]));
  try {
    const r = await readFileForEdit(file, { cap: 4 });
    assert.equal(r.binary, false);
    assert.equal(r.truncated, true);
    assert.equal(r.text, "caf");
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("readFileForEdit treats invalid UTF-8 as binary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "latin1.txt");
  fs.writeFileSync(file, Buffer.from([0x48, 0xe9, 0x6c]));
  try {
    const r = await readFileForEdit(file);
    assert.equal(r.binary, true);
    assert.equal(r.text, "");
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("writeFileForEdit overwrites text and refuses binary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "a.ts");
  fs.writeFileSync(file, "old");
  try {
    await writeFileForEdit(file, "export const n = 1;\n");
    assert.equal(fs.readFileSync(file, "utf8"), "export const n = 1;\n");
    await assert.rejects(
      () => writeFileForEdit(file, "a\u0000b"),
      /binary/i,
    );
    await assert.rejects(() => writeFileForEdit(file, undefined), /must be text/i);
    await assert.rejects(() => writeFileForEdit(file, null), /must be text/i);
    assert.equal(fs.readFileSync(file, "utf8"), "export const n = 1;\n");
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("writeFileForEdit refuses to overwrite invalid UTF-8", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "latin1.txt");
  const original = Buffer.from([0x48, 0xe9, 0x6c]);
  fs.writeFileSync(file, original);
  try {
    await assert.rejects(
      () => writeFileForEdit(file, "hello"),
      /overwrite a binary file/i,
    );
    assert.deepEqual(fs.readFileSync(file), original);
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("writeFileForEdit refuses to overwrite an existing binary file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "x.bin");
  const original = Buffer.from([0x00, 0x01, 0x02]);
  fs.writeFileSync(file, original);
  try {
    await assert.rejects(
      () => writeFileForEdit(file, "not-binary"),
      /overwrite a binary file/i,
    );
    assert.deepEqual(fs.readFileSync(file), original);
  } finally {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
});

test("writeFileForEdit allows saving an empty string", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edit-"));
  const file = path.join(dir, "a.ts");
  fs.writeFileSync(file, "old");
  try {
    await writeFileForEdit(file, "");
    assert.equal(fs.readFileSync(file, "utf8"), "");
  } finally {
    try {
      fs.unlinkSync(file);
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
