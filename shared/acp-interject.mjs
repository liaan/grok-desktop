/**
 * grok-build mid-turn interject (`x.ai/interject` / `x.ai/session/interjection`).
 * Text-only requests must omit `content`.
 */

/** IPC `reason` when this Grok CLI has no `x.ai/interject`. */
export const INTERJECT_UNSUPPORTED_REASON = "unsupported";

/**
 * @typedef {{ sessionId: string, text: string, interjectionId: string }} SessionInterjection
 */

/**
 * @param {string} [interjectionId]
 * @returns {{ ok: false, reason: "unsupported", interjectionId: string }}
 */
export function interjectUnsupportedResult(interjectionId) {
  return {
    ok: false,
    reason: INTERJECT_UNSUPPORTED_REASON,
    interjectionId: String(interjectionId || "").trim(),
  };
}

/**
 * Allowlisted success — do not spread the ACP body (it can overwrite `ok`).
 * @param {string} interjectionId
 * @param {unknown} [status]
 * @returns {{ ok: true, status: string, interjectionId: string }}
 */
export function interjectAcceptedResult(interjectionId, status) {
  const st = String(status || "queued").trim() || "queued";
  return {
    ok: true,
    status: st,
    interjectionId: String(interjectionId || "").trim(),
  };
}

/** Wire-loop miss while probing `_x.ai/interject` then `x.ai/interject`. */
export function isInterjectMethodMissing(err) {
  if (!err) return false;
  if (typeof err === "object" && err.code === -32601) return true;
  return /method not found|-32601|unknown method/i.test(
    String(typeof err === "object" && err.message ? err.message : err),
  );
}

/**
 * Leftover "interject is not available" throw → JSON. Do not map generic
 * method-missing (the client loop already tried both wire methods).
 * @param {unknown} err
 * @param {string} [interjectionId]
 * @returns {{ ok: false, reason: "unsupported", interjectionId: string } | null}
 */
export function mapInterjectIpcError(err, interjectionId) {
  const message = String(
    err && typeof err === "object" && err.message != null
      ? err.message
      : err || "",
  );
  if (!/interject is not available/i.test(message)) return null;
  return interjectUnsupportedResult(interjectionId);
}

/**
 * @param {unknown[]} errors  one per attempted wire method that failed
 * @param {string} interjectionId
 */
export function interjectFromAttemptErrors(errors, interjectionId) {
  const list = Array.isArray(errors) ? errors : [];
  for (const err of list) {
    if (!isInterjectMethodMissing(err)) {
      throw err instanceof Error ? err : new Error(String(err?.message || err));
    }
  }
  return interjectUnsupportedResult(interjectionId);
}

/**
 * @param {{
 *   sessionId: string,
 *   text: string,
 *   interjectionId: string,
 *   images?: { data: string, mimeType?: string }[],
 * }} opts
 */
export function interjectRequestParams(opts) {
  const sessionId = String(opts?.sessionId || "").trim();
  const text = String(opts?.text || "");
  const interjectionId = String(opts?.interjectionId || "").trim();
  const images = Array.isArray(opts?.images) ? opts.images : [];
  /** @type {Record<string, unknown>} */
  const params = { sessionId, text, interjectionId };
  if (images.length === 0) return params;
  const content = [];
  if (text.trim()) content.push({ type: "text", text });
  for (const img of images) {
    const data = String(img?.data || "");
    if (!data) continue;
    content.push({
      type: "image",
      data,
      mimeType: String(img?.mimeType || "image/png"),
    });
  }
  if (content.length) params.content = content;
  return params;
}

/**
 * @param {{
 *   sessionId: string,
 *   text: string,
 *   interjectionId: string,
 *   images?: { data: string, mimeType?: string }[],
 * }} opts
 * @returns {{ method: string, params: object }[]}
 */
export function interjectAttempts(opts) {
  const params = interjectRequestParams(opts);
  return [
    { method: "_x.ai/interject", params },
    { method: "x.ai/interject", params },
  ];
}

/** @param {unknown} method */
export function isSessionInterjectionMethod(method) {
  const m = String(method || "").replace(/^_/, "");
  return (
    m === "x.ai/session/interjection" || m.endsWith("/session/interjection")
  );
}

/**
 * Peel `ext_notification` wrappers around `x.ai/session/interjection`.
 * @param {unknown} method
 * @param {any} params
 * @returns {SessionInterjection | null}
 */
export function unwrapSessionInterjection(method, params) {
  let m = String(method || "");
  let p = params;
  for (let i = 0; i < 4; i += 1) {
    if (isSessionInterjectionMethod(m)) {
      const body = p && typeof p === "object" ? p : {};
      return {
        sessionId: String(body.sessionId || body.session_id || "").trim(),
        text: String(body.text || ""),
        interjectionId: String(
          body.interjectionId || body.interjection_id || "",
        ).trim(),
      };
    }
    if (!p || typeof p !== "object" || p.method == null) break;
    const inner = String(p.method);
    if (
      inner === "ext_notification" ||
      inner.endsWith("/ext_notification") ||
      isSessionInterjectionMethod(inner)
    ) {
      m = inner;
      p = p.params !== undefined ? p.params : p;
      continue;
    }
    break;
  }
  return null;
}
