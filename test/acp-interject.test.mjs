/**
 * Mid-turn interject wire + IPC JSON helpers (shared/acp-interject.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERJECT_UNSUPPORTED_REASON,
  interjectAcceptedResult,
  interjectAttempts,
  interjectFromAttemptErrors,
  interjectRequestParams,
  interjectUnsupportedResult,
  isInterjectMethodMissing,
  isSessionInterjectionMethod,
  mapInterjectIpcError,
  unwrapSessionInterjection,
} from "../shared/acp-interject.mjs";

test("interjectRequestParams omits content when there are no images", () => {
  const params = interjectRequestParams({
    sessionId: "s1",
    text: "steer left",
    interjectionId: "i1",
  });
  assert.deepEqual(params, {
    sessionId: "s1",
    text: "steer left",
    interjectionId: "i1",
  });
  assert.equal("content" in params, false);
});

test("interjectRequestParams omits content for empty images array", () => {
  const params = interjectRequestParams({
    sessionId: "s1",
    text: "steer",
    interjectionId: "i1",
    images: [],
  });
  assert.equal("content" in params, false);
});

test("interjectRequestParams puts text then images in content", () => {
  const params = interjectRequestParams({
    sessionId: "s1",
    text: "look at this",
    interjectionId: "i2",
    images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
  });
  assert.deepEqual(params.content, [
    { type: "text", text: "look at this" },
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
  ]);
});

test("interjectRequestParams images-only, empty data, default mime, whitespace text", () => {
  const imagesOnly = interjectRequestParams({
    sessionId: "s1",
    text: "",
    interjectionId: "i3",
    images: [{ data: "aGVsbG8=", mimeType: "image/jpeg" }],
  });
  assert.deepEqual(imagesOnly.content, [
    { type: "image", data: "aGVsbG8=", mimeType: "image/jpeg" },
  ]);

  const skippedEmpty = interjectRequestParams({
    sessionId: "s1",
    text: "keep",
    interjectionId: "i4",
    images: [{ data: "", mimeType: "image/png" }, { data: "abc" }],
  });
  assert.deepEqual(skippedEmpty.content, [
    { type: "text", text: "keep" },
    { type: "image", data: "abc", mimeType: "image/png" },
  ]);

  const wsText = interjectRequestParams({
    sessionId: "s1",
    text: "   ",
    interjectionId: "i5",
    images: [{ data: "abc" }],
  });
  assert.deepEqual(wsText.content, [
    { type: "image", data: "abc", mimeType: "image/png" },
  ]);
});

test("interjectAttempts uses underscore ACP ext method first and shares params", () => {
  const attempts = interjectAttempts({
    sessionId: "s1",
    text: "steer",
    interjectionId: "i1",
  });
  assert.equal(attempts[0].method, "_x.ai/interject");
  assert.equal(attempts[1].method, "x.ai/interject");
  assert.equal(attempts[0].params, attempts[1].params);
  assert.equal("content" in attempts[0].params, false);
});

test("unwrapSessionInterjection peels stdio underscore and ext_notification", () => {
  assert.equal(isSessionInterjectionMethod("_x.ai/session/interjection"), true);
  assert.equal(isSessionInterjectionMethod("x.ai/session/interjection"), true);
  assert.deepEqual(
    unwrapSessionInterjection("_x.ai/session/interjection", {
      sessionId: "s",
      text: "steer",
      interjectionId: "i1",
    }),
    { sessionId: "s", text: "steer", interjectionId: "i1" },
  );
  assert.deepEqual(
    unwrapSessionInterjection("x.ai/session/interjection", {
      sessionId: "s3",
      text: "plain",
      interjectionId: "i3",
    }),
    { sessionId: "s3", text: "plain", interjectionId: "i3" },
  );
  assert.deepEqual(
    unwrapSessionInterjection("ext_notification", {
      method: "x.ai/session/interjection",
      params: { session_id: "s2", text: "hi", interjection_id: "i2" },
    }),
    { sessionId: "s2", text: "hi", interjectionId: "i2" },
  );
  assert.deepEqual(
    unwrapSessionInterjection("x.ai/session/interjection", { text: "no ids" }),
    { sessionId: "", text: "no ids", interjectionId: "" },
  );
  assert.equal(
    unwrapSessionInterjection("session/update", { update: {} }),
    null,
  );
});

test("interjectUnsupportedResult is the IPC JSON shape", () => {
  assert.equal(INTERJECT_UNSUPPORTED_REASON, "unsupported");
  assert.deepEqual(interjectUnsupportedResult("i1"), {
    ok: false,
    reason: "unsupported",
    interjectionId: "i1",
  });
});

test("interjectAcceptedResult allowlists status and pins ok", () => {
  assert.deepEqual(interjectAcceptedResult("i1", "queued"), {
    ok: true,
    status: "queued",
    interjectionId: "i1",
  });
  const hostile = { ok: false, reason: "unsupported", status: "queued", extra: 1 };
  assert.deepEqual(interjectAcceptedResult("i1", hostile.status), {
    ok: true,
    status: "queued",
    interjectionId: "i1",
  });
  assert.equal("extra" in interjectAcceptedResult("i1", hostile.status), false);
});

test("isInterjectMethodMissing matches code and regex, not leftover phrase", () => {
  assert.equal(
    isInterjectMethodMissing({ code: -32601, message: "Method not found" }),
    true,
  );
  assert.equal(isInterjectMethodMissing({ code: -32601, message: "nope" }), true);
  assert.equal(isInterjectMethodMissing({ message: "unknown method" }), true);
  assert.equal(isInterjectMethodMissing({ message: "Method not found" }), true);
  assert.equal(
    isInterjectMethodMissing(
      new Error("Mid-turn interject is not available on this Grok CLI"),
    ),
    false,
  );
  assert.equal(isInterjectMethodMissing(null), false);
});

test("both method-missing attempts yield unsupported JSON", () => {
  const miss = { code: -32601, message: "Method not found" };
  assert.deepEqual(interjectFromAttemptErrors([miss, miss], "i1"), {
    ok: false,
    reason: "unsupported",
    interjectionId: "i1",
  });
  assert.deepEqual(interjectFromAttemptErrors([], "i1"), {
    ok: false,
    reason: "unsupported",
    interjectionId: "i1",
  });
});

test("non-missing attempt error is not converted to unsupported", () => {
  assert.throws(
    () =>
      interjectFromAttemptErrors([new Error("session not found")], "i1"),
    /session not found/,
  );
});

test("miss then real error is not converted to unsupported", () => {
  assert.throws(
    () =>
      interjectFromAttemptErrors(
        [{ code: -32601, message: "Method not found" }, new Error("session not found")],
        "i1",
      ),
    /session not found/,
  );
});

test("mapInterjectIpcError maps leftover message, not generic method-missing", () => {
  assert.deepEqual(
    mapInterjectIpcError(
      new Error("Mid-turn interject is not available on this Grok CLI"),
      "i9",
    ),
    { ok: false, reason: "unsupported", interjectionId: "i9" },
  );
  assert.equal(
    mapInterjectIpcError({ code: -32601, message: "Method not found" }, "i9"),
    null,
  );
  assert.equal(
    mapInterjectIpcError(new Error("unknown method"), "i9"),
    null,
  );
  assert.equal(mapInterjectIpcError(new Error("session not found"), "i9"), null);
});
