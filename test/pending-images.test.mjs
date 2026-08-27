import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pendingImageFromBase64,
  previewCaptureRefuseError,
  previewCaptureToSubmit,
} from "../shared/preview-capture.mjs";

test("pendingImageFromBase64 defaults mime and builds a data URL", () => {
  const img = pendingImageFromBase64("QQ==", "", "shot.jpg");
  assert.equal(img.data, "QQ==");
  assert.equal(img.mimeType, "image/jpeg");
  assert.equal(img.name, "shot.jpg");
  assert.equal(img.previewUrl, "data:image/jpeg;base64,QQ==");
  assert.match(img.id, /^img_/);
});

test("previewCaptureToSubmit refuses empty data", () => {
  const empty = previewCaptureToSubmit({});
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.error, /empty/);
  const blank = previewCaptureToSubmit({ data: "" });
  assert.equal(blank.ok, false);
});

test("previewCaptureToSubmit defaults mime, text, compact auto", () => {
  const r = previewCaptureToSubmit({ data: "abc" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.submit.mode, "auto");
  assert.equal(r.submit.imageQuality, "compact");
  assert.equal(r.submit.text, "Preview viewport capture.");
  assert.equal(r.submit.images.length, 1);
  assert.equal(r.submit.images[0].data, "abc");
  assert.equal(r.submit.images[0].mimeType, "image/jpeg");
  assert.equal(r.submit.images[0].name, "preview-viewport.jpg");
  assert.equal(
    r.submit.images[0].previewUrl,
    "data:image/jpeg;base64,abc",
  );
});

test("previewCaptureToSubmit uses payload text and mime", () => {
  const r = previewCaptureToSubmit({
    data: "xyz",
    mimeType: "image/png",
    text: "  Preview viewport capture (http://localhost:5173/).  ",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(
    r.submit.text,
    "Preview viewport capture (http://localhost:5173/).",
  );
  assert.equal(r.submit.images[0].mimeType, "image/png");
  assert.equal(r.submit.mode, "auto");
  assert.equal(r.submit.imageQuality, "compact");
});

test("previewCaptureRefuseError does not say open a project when one is set", () => {
  assert.match(previewCaptureRefuseError(null), /open a project first/);
  const waiting = previewCaptureRefuseError("/proj");
  assert.match(waiting, /session is ready/);
  assert.doesNotMatch(waiting, /open a project first/);
});
