/**
 * ctx is live window occupancy, not billed turn totals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyUsageUpdate,
  emptyUsage,
  formatTokens,
  formatUsageBar,
} from "../shared/usage.mjs";

test("formatTokens keeps values under 100k below 100k", () => {
  assert.equal(formatTokens(11_000), "11k");
  assert.equal(formatTokens(85_400), "85k");
  assert.equal(formatTokens(99_400), "99k");
  assert.equal(formatTokens(110_400), "110k");
});

test("live _meta.totalTokens sets ctx (occupancy, not billed)", () => {
  let u = emptyUsage();
  u = applyUsageUpdate(u, {
    update: { sessionUpdate: "agent_thought_chunk" },
    _meta: { totalTokens: 12_457 },
  });
  assert.equal(u.lastContextTokens, 12_457);
  u = applyUsageUpdate(u, {
    update: { sessionUpdate: "tool_call" },
    _meta: { totalTokens: 85_200 },
  });
  assert.equal(u.lastContextTokens, 85_200);
  assert.equal(formatUsageBar(u).includes("ctx 85k"), true);
});

test("turn_completed does not replace ctx with billed usage.totalTokens", () => {
  let u = emptyUsage();
  u = applyUsageUpdate(u, {
    update: { sessionUpdate: "agent_message_chunk" },
    _meta: { totalTokens: 81_000 },
  });
  u = applyUsageUpdate(u, {
    update: {
      sessionUpdate: "turn_completed",
      usage: {
        inputTokens: 381_000,
        outputTokens: 1_200,
        totalTokens: 382_200,
        cachedReadTokens: 302_000,
      },
    },
  });
  assert.equal(u.turns, 1);
  assert.equal(u.inputTokens, 381_000);
  assert.equal(u.totalTokens, 382_200);
  assert.equal(u.lastContextTokens, 81_000);
  assert.equal(formatUsageBar(u).includes("ctx 81k"), true);
  assert.equal(formatUsageBar(u).includes("ctx 382k"), false);
});

test("turn_completed falls back to input minus cache when stream meta is missing", () => {
  const u = applyUsageUpdate(emptyUsage(), {
    update: {
      sessionUpdate: "turn_completed",
      usage: {
        inputTokens: 381_000,
        outputTokens: 1_200,
        totalTokens: 382_200,
        cachedReadTokens: 302_000,
      },
    },
  });
  assert.equal(u.lastContextTokens, 79_000);
});

test("turn_completed prefers this-event _meta.totalTokens over billed", () => {
  const u = applyUsageUpdate(emptyUsage(), {
    update: {
      sessionUpdate: "turn_completed",
      usage: {
        inputTokens: 381_000,
        outputTokens: 1_200,
        totalTokens: 382_200,
        cachedReadTokens: 302_000,
      },
    },
    _meta: { totalTokens: 81_000 },
  });
  assert.equal(u.lastContextTokens, 81_000);
});

test("compact still drops ctx below 100k", () => {
  let u = applyUsageUpdate(emptyUsage(), {
    update: {
      sessionUpdate: "turn_completed",
      usage: { totalTokens: 110_000, inputTokens: 110_000 },
    },
  });
  assert.equal(u.lastContextTokens, 110_000);
  u = applyUsageUpdate(u, {
    update: {
      sessionUpdate: "auto_compact_completed",
      tokens_before: 110_000,
      tokens_after: 22_000,
    },
  });
  assert.equal(u.lastContextTokens, 22_000);
});
