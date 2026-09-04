import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isInterjectUnsupported,
  midTurnAction,
} from "../shared/prompt-delivery.mjs";
import {
  appendUserMessage,
  applySessionInterjection,
} from "../shared/session-timeline.mjs";

test("midTurnAction: idle always prompts", () => {
  assert.equal(midTurnAction("auto", false), "prompt");
  assert.equal(midTurnAction("queue", false), "prompt");
  assert.equal(midTurnAction("now", false), "prompt");
});

test("midTurnAction: busy Enter interjects, Queue waits, Send now cancels", () => {
  assert.equal(midTurnAction("auto", true), "interject");
  assert.equal(midTurnAction("queue", true), "queue");
  assert.equal(midTurnAction("now", true), "send-now");
});

test("isInterjectUnsupported matches missing-method and our fallback error", () => {
  assert.equal(isInterjectUnsupported({ code: -32601, message: "nope" }), true);
  assert.equal(
    isInterjectUnsupported({
      code: "INTERJECT_UNSUPPORTED",
      message: "Mid-turn interject is not available on this Grok CLI",
    }),
    true,
  );
  assert.equal(isInterjectUnsupported(new Error("session not found")), false);
});

test("applySessionInterjection skips originator echo then paints others", () => {
  const self = new Set(["i-self"]);
  const start = appendUserMessage([], {
    text: "already painted",
    optimistic: true,
  });
  const skipped = applySessionInterjection(
    start,
    { text: "already painted", interjectionId: "i-self" },
    self,
  );
  assert.equal(skipped, start);
  assert.equal(self.has("i-self"), false);

  const other = applySessionInterjection(
    start,
    { text: "from another pane", interjectionId: "i-other" },
    self,
  );
  assert.equal(other.length, start.length + 1);
  assert.equal(other[other.length - 1].kind, "user");
  assert.equal(other[other.length - 1].text, "from another pane");
  assert.equal(other[other.length - 1].optimistic, false);
});
