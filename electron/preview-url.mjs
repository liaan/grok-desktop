/**
 * Allowlist + normalize URLs for the detachable Preview window.
 * http(s) only. about:blank is the empty document, not a user target.
 */

const BLOCKED = new Set(["file:", "javascript:", "data:", "blob:", "chrome:", "chrome-extension:"]);

/**
 * @param {unknown} raw
 * @returns {{ ok: true, href: string } | { ok: false, error: string }}
 */
export function normalizePreviewUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return { ok: false, error: "Enter a URL" };

  let href = input;
  // `localhost:5173` looks like a scheme to URL() — only treat real
  // schemes (with ://) or a short known list as already-absolute.
  const hasAuthority = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(href);
  const known = /^(about|https?|file|javascript|data|blob|chrome|chrome-extension):/i.test(
    href,
  );
  if (!hasAuthority && !known) {
    href = `http://${href}`;
  }

  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === "about:" && parsed.pathname === "blank") {
    return { ok: true, href: "about:blank" };
  }
  if (BLOCKED.has(protocol)) {
    return { ok: false, error: `${parsed.protocol} URLs are not allowed` };
  }
  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, error: "Only http(s) URLs are allowed" };
  }
  return { ok: true, href: parsed.href };
}

/** @param {unknown} href */
export function isAllowedPreviewHref(href) {
  return normalizePreviewUrl(href).ok;
}

/** Rough text-token estimate (same 4-char heuristic as most UIs). */
export function estimateTextTokens(text) {
  const n = String(text || "").length;
  return Math.ceil(n / 4);
}

/**
 * Viewport JPEG token ballpark. Vision encoders tile the image;
 * a typical 1280×800 capture lands around 1–2k tokens — not free,
 * which is why Preview prefers the text snapshot.
 */
export function estimateImageTokens(width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
  return tiles * 170;
}
