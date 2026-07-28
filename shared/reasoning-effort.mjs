/**
 * Reasoning effort levels for Grok models (`/effort`, `--reasoning-effort`).
 * Canonical tiers from the CLI; a given model only accepts levels it advertises.
 */

/** @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffort */

/** @type {ReasoningEffort[]} */
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"];

/** Desktop default when none is stored (matches current grok-4.5 menu default). */
export const DEFAULT_REASONING_EFFORT = /** @type {ReasoningEffort} */ ("high");

/**
 * @param {unknown} value
 * @param {ReasoningEffort} [fallback]
 * @returns {ReasoningEffort}
 */
export function normalizeReasoningEffort(
  value,
  fallback = DEFAULT_REASONING_EFFORT,
) {
  const v = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/_/g, "-");
  if (v === "x-high" || v === "xhigh" || v === "x high") return "xhigh";
  if (v === "low" || v === "minimal" || v === "none") {
    // Map none/minimal → low for the topbar menu (model menus use low).
    if (v === "low") return "low";
    return "low";
  }
  if (v === "medium" || v === "med" || v === "default") return "medium";
  if (v === "high") return "high";
  if (v === "max") return "xhigh";
  return fallback;
}

/**
 * @param {ReasoningEffort} level
 */
export function reasoningEffortLabel(level) {
  if (level === "xhigh") return "X-High";
  if (level === "high") return "High";
  if (level === "medium") return "Medium";
  return "Low";
}

/**
 * @param {ReasoningEffort} level
 */
export function reasoningEffortDescription(level) {
  if (level === "xhigh") {
    return "Maximum reasoning depth when the model offers it (same as /effort xhigh).";
  }
  if (level === "high") {
    return "Highest typical quality with extensive reasoning (default for Grok 4.5).";
  }
  if (level === "medium") {
    return "Balanced reasoning for everyday implementation work.";
  }
  return "Faster, lighter reasoning for quick changes.";
}
