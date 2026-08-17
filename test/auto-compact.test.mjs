import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoCompactTokenThreshold,
  normalizeAutoCompactAt,
  shouldAutoCompact,
} from "../shared/auto-compact.mjs";

test("normalizeAutoCompactAt defaults to off", () => {
  assert.equal(normalizeAutoCompactAt(undefined), "off");
  assert.equal(normalizeAutoCompactAt("nope"), "off");
  assert.equal(normalizeAutoCompactAt("64k"), "64k");
});

test("autoCompactTokenThreshold maps ids", () => {
  assert.equal(autoCompactTokenThreshold("off"), 0);
  assert.equal(autoCompactTokenThreshold("64k"), 64_000);
  assert.equal(autoCompactTokenThreshold("128k"), 128_000);
});

test("shouldAutoCompact stays off until the threshold", () => {
  assert.equal(
    shouldAutoCompact({ at: "64k", lastContextTokens: 20_000 }),
    false,
  );
  assert.equal(
    shouldAutoCompact({ at: "64k", lastContextTokens: 64_000 }),
    true,
  );
});

test("shouldAutoCompact does not re-fire at the same size", () => {
  assert.equal(
    shouldAutoCompact({
      at: "64k",
      lastContextTokens: 80_000,
      alreadyFiredAt: 80_000,
    }),
    false,
  );
  assert.equal(
    shouldAutoCompact({
      at: "64k",
      lastContextTokens: 90_000,
      alreadyFiredAt: 80_000,
    }),
    true,
  );
});
