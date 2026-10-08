import { test } from "node:test";
import assert from "node:assert/strict";
import { thoughtPreview } from "../shared/thought-preview.mjs";

test("thoughtPreview collapses whitespace and keeps short text", () => {
  assert.equal(thoughtPreview(""), "");
  assert.equal(thoughtPreview("   "), "");
  assert.equal(thoughtPreview("look at the gate\nthen the feed"), "look at the gate then the feed");
});

test("thoughtPreview keeps the tail so a live thought stays traceable", () => {
  const text = `${"a".repeat(40)} ENDING HERE`;
  const preview = thoughtPreview(text, 20);
  assert.equal(preview.startsWith("…"), true);
  assert.equal(preview.endsWith("ENDING HERE"), true);
  assert.equal(preview.length <= 20, true);
});

test("thoughtPreview leaves text at the limit unchanged", () => {
  const text = "12345678";
  assert.equal(thoughtPreview(text, 8), text);
});
