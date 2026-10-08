/**
 * One-line trace of a thinking block.
 * Keeps the end of the text so a live stream stays readable while folded.
 *
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function thoughtPreview(text, max = 160) {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  const limit = Math.max(8, max);
  if (flat.length <= limit) return flat;
  const tail = flat.slice(-(limit - 1)).trimStart();
  return `…${tail}`;
}
