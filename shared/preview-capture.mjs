/**
 * Preview Send-screenshot → composer submit shape.
 * Same queue/refuse path as composer Enter (compact JPEG, auto).
 */
import { uid } from "./session-timeline.mjs";

export function pendingImageFromBase64(data, mimeType, name) {
  const mime = mimeType || "image/jpeg";
  return {
    id: uid("img"),
    data,
    mimeType: mime,
    previewUrl: `data:${mime};base64,${data}`,
    name,
  };
}

/**
 * @param {{ data?: unknown, mimeType?: unknown, text?: unknown }} payload
 * @returns {{ ok: true, submit: {
 *   text: string,
 *   images: ReturnType<typeof pendingImageFromBase64>[],
 *   mode: "auto",
 *   imageQuality: "compact",
 * } } | { ok: false, error: string }}
 */
export function previewCaptureToSubmit(payload) {
  const data = String(payload?.data || "");
  const mime = String(payload?.mimeType || "image/jpeg");
  if (!data) {
    return { ok: false, error: "Preview screenshot was empty." };
  }
  const text =
    typeof payload?.text === "string" && payload.text.trim()
      ? payload.text.trim()
      : "Preview viewport capture.";
  return {
    ok: true,
    submit: {
      text,
      images: [pendingImageFromBase64(data, mime, "preview-viewport.jpg")],
      mode: "auto",
      imageQuality: "compact",
    },
  };
}

/** @param {string | null} project */
export function previewCaptureRefuseError(project) {
  if (!project) {
    return "Could not send the Preview screenshot — open a project first.";
  }
  return "Could not send the Preview screenshot — wait until the session is ready.";
}
