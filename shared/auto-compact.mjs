/**
 * When Desktop should call the agent compact API (same as topbar Compress)
 * before the CLI hits the window ceiling. Off by default — CLI still
 * auto-compacts near the hard limit.
 */

/** @typedef {'off' | '64k' | '128k' | '192k'} AutoCompactAt */

/** @type {{ id: AutoCompactAt, tokens: number, label: string, hint: string }[]} */
export const AUTO_COMPACT_OPTIONS = [
  { id: "off", tokens: 0, label: "Off", hint: "Only when you press Compress (or the CLI is nearly full)" },
  { id: "64k", tokens: 64_000, label: "64k tokens", hint: "Earlier — good when chats carry screenshots" },
  { id: "128k", tokens: 128_000, label: "128k tokens", hint: "Mid-session" },
  { id: "192k", tokens: 192_000, label: "192k tokens", hint: "Later — closer to a 256k window" },
];

/**
 * @param {unknown} value
 * @returns {AutoCompactAt}
 */
export function normalizeAutoCompactAt(value) {
  const v = String(value ?? "off")
    .toLowerCase()
    .trim();
  if (v === "64k" || v === "128k" || v === "192k") return v;
  return "off";
}

/**
 * @param {unknown} value
 * @returns {number} 0 = disabled
 */
export function autoCompactTokenThreshold(value) {
  const id = normalizeAutoCompactAt(value);
  const row = AUTO_COMPACT_OPTIONS.find((o) => o.id === id);
  return row ? row.tokens : 0;
}

/**
 * Fire once per growth past the threshold (not again until context grows).
 * @param {{ at?: unknown, lastContextTokens?: number, alreadyFiredAt?: number }} opts
 */
export function shouldAutoCompact(opts = {}) {
  const threshold = autoCompactTokenThreshold(opts.at);
  if (threshold <= 0) return false;
  const ctx = Number(opts.lastContextTokens) || 0;
  if (ctx < threshold) return false;
  const fired = Number(opts.alreadyFiredAt) || 0;
  if (fired >= ctx) return false;
  return true;
}
