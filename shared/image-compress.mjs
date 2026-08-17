/**
 * Shared limits for composer / ACP image attachments.
 *
 * Vision tokens scale with pixel tiles (≈512px), not JPEG bytes. Compact is
 * the default for screenshots. High detail is a per-send opt-in (2000px).
 */

/** @typedef {'compact' | 'high'} ImageQuality */

export const IMAGE_QUALITIES = ["compact", "high"];

/** Default send: 1280 long edge — enough to read UI screenshots. */
export const COMPACT_IMAGE_EDGE = 1280;
export const COMPACT_TARGET_BYTES = 120 * 1024;

/** Per-send "higher detail" ceiling. */
export const MAX_IMAGE_EDGE = 2000;
export const TARGET_IMAGE_BYTES = 500 * 1024;

/** Reject before decode — not a vision-useful size. */
export const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;

/** JPEG quality start; main/renderer step down if still over target. */
export const JPEG_QUALITY_START = 82;
export const JPEG_QUALITY_MIN = 55;

/**
 * @param {unknown} value
 * @returns {ImageQuality}
 */
export function resolveImageQuality(value) {
  return value === "high" ? "high" : "compact";
}

/**
 * @param {unknown} quality
 * @returns {{ maxEdge: number, targetBytes: number, jpegQuality: number }}
 */
export function imageQualityLimits(quality) {
  if (resolveImageQuality(quality) === "high") {
    return {
      maxEdge: MAX_IMAGE_EDGE,
      targetBytes: TARGET_IMAGE_BYTES,
      jpegQuality: JPEG_QUALITY_START,
    };
  }
  return {
    maxEdge: COMPACT_IMAGE_EDGE,
    targetBytes: COMPACT_TARGET_BYTES,
    jpegQuality: 78,
  };
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} [maxEdge]
 * @returns {{ width: number, height: number }}
 */
export function scaleToMaxEdge(width, height, maxEdge = MAX_IMAGE_EDGE) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const cap = Math.max(1, Math.round(Number(maxEdge) || MAX_IMAGE_EDGE));
  const edge = Math.max(w, h);
  if (w < 1 || h < 1 || edge <= cap) return { width: Math.max(1, w || 1), height: Math.max(1, h || 1) };
  const scale = cap / edge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * @param {{ width?: number, height?: number, bytes?: number, maxEdge?: number, targetBytes?: number }} info
 */
export function shouldReencodeImage(info = {}) {
  const width = Number(info.width) || 0;
  const height = Number(info.height) || 0;
  const bytes = Number(info.bytes) || 0;
  const maxEdge = Number(info.maxEdge) || MAX_IMAGE_EDGE;
  const targetBytes = Number(info.targetBytes) || TARGET_IMAGE_BYTES;
  if (width < 1 || height < 1) return true;
  if (Math.max(width, height) > maxEdge) return true;
  if (bytes > targetBytes) return true;
  return false;
}

/**
 * Next JPEG quality in the step-down ladder (82 → 72 → 62 → 55).
 * @param {number} quality
 */
export function nextJpegQuality(quality) {
  const q = Math.round(Number(quality) || JPEG_QUALITY_START);
  if (q > 72) return 72;
  if (q > 62) return 62;
  return JPEG_QUALITY_MIN;
}
