import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERJECT_UNSUPPORTED_REASON,
  interjectUnsupportedResult,
} from "../shared/acp-interject.mjs";
import {
  interjectRpcFollowUp,
  isInterjectUnsupported,
  midTurnAction,
} from "../shared/prompt-delivery.mjs";

test("midTurnAction: idle always prompts", () => {
  assert.equal(midTurnAction("auto", false), "prompt");
  assert.equal(midTurnAction("queue", false), "prompt");
  assert.equal(midTurnAction("now", false), "prompt");
  assert.equal(midTurnAction("nope", false), "prompt");
});

test("midTurnAction: busy Enter interjects, Queue waits, Send now cancels", () => {
  assert.equal(midTurnAction("auto", true), "interject");
  assert.equal(midTurnAction("queue", true), "queue");
  assert.equal(midTurnAction("now", true), "send-now");
  assert.equal(midTurnAction(undefined, true), "interject");
  assert.equal(midTurnAction("enter", true), "interject");
});

test("INTERJECT_UNSUPPORTED_REASON is the IPC reason literal", () => {
  assert.equal(INTERJECT_UNSUPPORTED_REASON, "unsupported");
});

test("isInterjectUnsupported matches IPC JSON only", () => {
  assert.equal(
    isInterjectUnsupported({
      ok: false,
      reason: INTERJECT_UNSUPPORTED_REASON,
    }),
    true,
  );
  assert.equal(
    isInterjectUnsupported({ ok: false, reason: "unsupported" }),
    true,
  );
  assert.equal(
    isInterjectUnsupported(interjectUnsupportedResult("i1")),
    true,
  );
  assert.equal(
    isInterjectUnsupported({ ok: true, status: "queued" }),
    false,
  );
  assert.equal(isInterjectUnsupported({ ok: false }), false);
  assert.equal(
    isInterjectUnsupported({ reason: INTERJECT_UNSUPPORTED_REASON }),
    false,
  );
  assert.equal(
    isInterjectUnsupported(
      new Error("Mid-turn interject is not available on this Grok CLI"),
    ),
    false,
  );
  assert.equal(
    isInterjectUnsupported({ code: -32601, message: "Method not found" }),
    false,
  );
  assert.equal(isInterjectUnsupported({ code: -32601, message: "nope" }), false);
  assert.equal(isInterjectUnsupported({ message: "unknown method" }), false);
  assert.equal(isInterjectUnsupported({ ok: false, reason: "busy" }), false);
  assert.equal(
    isInterjectUnsupported(new TypeError("interject is not a function")),
    false,
  );
  assert.equal(isInterjectUnsupported(new Error("session not found")), false);
  assert.equal(isInterjectUnsupported(null), false);
});

test("interjectRpcFollowUp: JSON unsupported queues; other failures error", () => {
  assert.equal(
    interjectRpcFollowUp({
      ok: false,
      reason: INTERJECT_UNSUPPORTED_REASON,
    }),
    "queue",
  );
  assert.equal(
    interjectRpcFollowUp({ ok: true, status: "queued" }),
    "ok",
  );
  assert.equal(interjectRpcFollowUp(undefined), "ok");
  assert.equal(
    interjectRpcFollowUp(null, new Error("interject is not available")),
    "error",
  );
  assert.equal(
    interjectRpcFollowUp(null, {
      code: -32601,
      message: "Method not found",
    }),
    "error",
  );
  assert.equal(
    interjectRpcFollowUp({ ok: false, reason: "busy" }),
    "error",
  );
  assert.equal(interjectRpcFollowUp({ ok: false }), "error");
});
