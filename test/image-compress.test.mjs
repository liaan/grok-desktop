import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_IMAGE_EDGE,
  COMPACT_TARGET_BYTES,
  JPEG_QUALITY_MIN,
  JPEG_QUALITY_START,
  MAX_IMAGE_EDGE,
  TARGET_IMAGE_BYTES,
  imageQualityLimits,
  nextJpegQuality,
  resolveImageQuality,
  scaleToMaxEdge,
  shouldReencodeImage,
} from "../shared/image-compress.mjs";

test("scaleToMaxEdge keeps images already under the cap", () => {
  assert.deepEqual(scaleToMaxEdge(800, 600), { width: 800, height: 600 });
  assert.deepEqual(scaleToMaxEdge(2000, 1125), { width: 2000, height: 1125 });
});

test("scaleToMaxEdge shrinks a 4K phone photo to a 2000px long edge", () => {
  const r = scaleToMaxEdge(7168, 4032);
  assert.equal(r.width, MAX_IMAGE_EDGE);
  assert.equal(r.height, 1125);
});

test("scaleToMaxEdge shrinks a tall screenshot", () => {
  const r = scaleToMaxEdge(1200, 4000);
  assert.equal(r.height, MAX_IMAGE_EDGE);
  assert.equal(r.width, 600);
});

test("shouldReencodeImage is true for a 4 MB 7168×4032 attach", () => {
  assert.equal(
    shouldReencodeImage({ width: 7168, height: 4032, bytes: 4 * 1024 * 1024 }),
    true,
  );
});

test("shouldReencodeImage is true when pixels are fine but bytes are huge", () => {
  assert.equal(
    shouldReencodeImage({ width: 1280, height: 720, bytes: 2 * 1024 * 1024 }),
    true,
  );
});

test("shouldReencodeImage is false for an already-small image", () => {
  assert.equal(
    shouldReencodeImage({ width: 1280, height: 720, bytes: 180_000 }),
    false,
  );
  assert.ok(180_000 < TARGET_IMAGE_BYTES);
});

test("nextJpegQuality steps down to the floor", () => {
  assert.equal(nextJpegQuality(JPEG_QUALITY_START), 72);
  assert.equal(nextJpegQuality(72), 62);
  assert.equal(nextJpegQuality(62), JPEG_QUALITY_MIN);
  assert.equal(nextJpegQuality(JPEG_QUALITY_MIN), JPEG_QUALITY_MIN);
});

test("resolveImageQuality defaults to compact", () => {
  assert.equal(resolveImageQuality(undefined), "compact");
  assert.equal(resolveImageQuality("nope"), "compact");
  assert.equal(resolveImageQuality("high"), "high");
});

test("compact preset is 1280px / 120KB; high is 2000px / 500KB", () => {
  const compact = imageQualityLimits("compact");
  assert.equal(compact.maxEdge, COMPACT_IMAGE_EDGE);
  assert.equal(compact.targetBytes, COMPACT_TARGET_BYTES);
  const high = imageQualityLimits("high");
  assert.equal(high.maxEdge, MAX_IMAGE_EDGE);
  assert.equal(high.targetBytes, TARGET_IMAGE_BYTES);
});

test("scaleToMaxEdge compact shrinks a desktop screenshot", () => {
  const r = scaleToMaxEdge(1903, 971, COMPACT_IMAGE_EDGE);
  assert.equal(r.width, COMPACT_IMAGE_EDGE);
  assert.equal(r.height, 653);
});

test("compact re-encodes a 1903×971 274KB screenshot; high does not", () => {
  const info = { width: 1903, height: 971, bytes: 274_168 };
  assert.equal(
    shouldReencodeImage({ ...info, ...imageQualityLimits("compact") }),
    true,
  );
  assert.equal(
    shouldReencodeImage({ ...info, ...imageQualityLimits("high") }),
    false,
  );
});
