/**
 * Session token/cost usage from ACP turn_completed (+ live totalTokens meta).
 * Shared by Electron main (disk hydrate) and the renderer.
 */

/**
 * @typedef {object} SessionUsage
 * @property {number} turns
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} totalTokens
 * @property {number} lastContextTokens
 * @property {number} cachedReadTokens
 * @property {number} reasoningTokens
 * @property {number} modelCalls
 * @property {number} costUsdTicks
 * @property {string} [lastModel]
 */

/** @returns {SessionUsage} */
export function emptyUsage() {
  return {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastContextTokens: 0,
    cachedReadTokens: 0,
    reasoningTokens: 0,
    modelCalls: 0,
    costUsdTicks: 0,
  };
}

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Live window occupancy from ACP `_meta.totalTokens`.
 * Do not use turn `usage.totalTokens` — that is billed input+output (includes
 * cache) and stays well above the real window after compact / cache hits.
 */
function metaContextTokens(params, update) {
  return (
    num(params?._meta?.totalTokens) ||
    num(update?._meta?.totalTokens) ||
    num(update?.totalTokens)
  );
}

/**
 * Request-time occupancy from a turn usage blob when stream meta is missing.
 * Cached prefix is not sitting in the live window.
 */
function occupancyFromTurnUsage(usage) {
  const input = num(usage.inputTokens ?? usage.input_tokens);
  const cached = num(usage.cachedReadTokens ?? usage.cached_read_tokens);
  if (input > 0 && cached > 0 && input >= cached) return input - cached;
  return input;
}

/**
 * Apply a session/update params blob to cumulative usage.
 * Returns the same reference if nothing changed.
 * @param {SessionUsage} prev
 * @param {any} params
 * @returns {SessionUsage}
 */
export function applyUsageUpdate(prev, params) {
  const update = params?.update ?? params;
  if (!update) return prev;

  const kind = update.sessionUpdate || update.session_update;

  const metaTotal = metaContextTokens(params, update);

  if (
    kind === "auto_compact_completed" ||
    kind === "compact_completed"
  ) {
    const after =
      num(update.tokens_after ?? update.tokensAfter) ||
      num(update.tokens_used ?? update.tokensUsed);
    if (after > 0 && after !== prev.lastContextTokens) {
      return { ...prev, lastContextTokens: after };
    }
    return prev;
  }

  if (kind === "turn_completed" || kind === "turn_complete") {
    const usage = update.usage || update.Usage || {};
    const input = num(usage.inputTokens ?? usage.input_tokens);
    const output = num(usage.outputTokens ?? usage.output_tokens);
    const total = num(usage.totalTokens ?? usage.total_tokens);
    const cached = num(usage.cachedReadTokens ?? usage.cached_read_tokens);
    const reasoning = num(usage.reasoningTokens ?? usage.reasoning_tokens);
    const calls = num(usage.modelCalls ?? usage.model_calls);
    const cost = num(usage.costUsdTicks ?? usage.cost_usd_ticks);
    const models = usage.modelUsage || usage.model_usage || {};
    let lastModel = prev.lastModel;
    if (models && typeof models === "object") {
      const keys = Object.keys(models);
      if (keys.length) lastModel = keys[keys.length - 1];
    }

    // Prefer live/stream occupancy already on `prev` over this turn's
    // billed input (cache-inflated). Occupancy is only a hydrate fallback.
    const ctx =
      metaTotal ||
      prev.lastContextTokens ||
      occupancyFromTurnUsage(usage);

    return {
      turns: prev.turns + 1,
      inputTokens: prev.inputTokens + input,
      outputTokens: prev.outputTokens + output,
      totalTokens: prev.totalTokens + total,
      lastContextTokens: ctx,
      cachedReadTokens: prev.cachedReadTokens + cached,
      reasoningTokens: prev.reasoningTokens + reasoning,
      modelCalls: prev.modelCalls + calls,
      costUsdTicks: prev.costUsdTicks + cost,
      lastModel,
    };
  }

  if (metaTotal > 0 && metaTotal !== prev.lastContextTokens) {
    return { ...prev, lastContextTokens: metaTotal };
  }

  return prev;
}

/** Compact token count: 1234 → 1.2k, 1_200_000 → 1.2M */
export function formatTokens(n) {
  if (!n || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Agent costUsdTicks scale (grok-build `USD_TICKS_PER_USD`):
 * 1 USD = 1e10 ticks. Same as CLI / headless `ticks_to_usd`.
 * @param {number} ticks
 * @returns {string | null}
 */
export function formatCostUsd(ticks) {
  if (!ticks || ticks <= 0) return null;
  const usd = ticks / 1e10;
  // Compact status-bar precision; CLI detailed view uses more decimals.
  if (usd < 0.1) return `$${usd.toFixed(3)}`;
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd)}`;
}

/**
 * One-line status bar label.
 * @param {SessionUsage} u
 */
export function formatUsageBar(u) {
  if (u.turns <= 0 && u.lastContextTokens <= 0) return "";
  const parts = [];
  if (u.turns > 0) parts.push(`${u.turns} turn${u.turns === 1 ? "" : "s"}`);
  if (u.inputTokens > 0 || u.outputTokens > 0) {
    parts.push(
      `${formatTokens(u.inputTokens)}↓ ${formatTokens(u.outputTokens)}↑`,
    );
  }
  if (u.lastContextTokens > 0) {
    parts.push(`ctx ${formatTokens(u.lastContextTokens)}`);
  }
  const cost = formatCostUsd(u.costUsdTicks);
  if (cost) parts.push(cost);
  return parts.join(" · ");
}

/**
 * Tooltip with fuller breakdown.
 * @param {SessionUsage} u
 */
export function formatUsageTooltip(u) {
  if (u.turns <= 0 && u.lastContextTokens <= 0) {
    return "Token usage appears after the first completed turn.";
  }
  const lines = [
    `Turns: ${u.turns}`,
    `Input: ${u.inputTokens.toLocaleString()} tokens`,
    `Output: ${u.outputTokens.toLocaleString()} tokens`,
    `Reasoning: ${u.reasoningTokens.toLocaleString()} tokens`,
    `Cached read: ${u.cachedReadTokens.toLocaleString()} tokens`,
    `Model calls: ${u.modelCalls}`,
    u.lastContextTokens
      ? `Last context size: ${u.lastContextTokens.toLocaleString()}`
      : null,
    u.lastModel ? `Model: ${u.lastModel}` : null,
    formatCostUsd(u.costUsdTicks)
      ? `Est. cost (session): ${formatCostUsd(u.costUsdTicks)}`
      : null,
    "Totals are summed from turn_completed usage for this session.",
  ];
  return lines.filter(Boolean).join("\n");
}
