/**
 * Session usage from ACP / Grok turn_completed (and live totalTokens meta).
 */

export type SessionUsage = {
  /** Completed agent turns (turn_completed events) in this Desktop session view */
  turns: number;
  /** Sum of per-turn input tokens */
  inputTokens: number;
  /** Sum of per-turn output tokens */
  outputTokens: number;
  /** Sum of per-turn totalTokens (can exceed context — sum of billable totals) */
  totalTokens: number;
  /** Latest context-ish size (last turn totalTokens or stream meta) */
  lastContextTokens: number;
  cachedReadTokens: number;
  reasoningTokens: number;
  modelCalls: number;
  /** Opaque cost units from the agent (costUsdTicks); display via formatCost */
  costUsdTicks: number;
  lastModel?: string;
};

export function emptyUsage(): SessionUsage {
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

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Apply a session/update params blob to cumulative usage.
 * Returns the same reference if nothing changed.
 */
export function applyUsageUpdate(
  prev: SessionUsage,
  params: any,
): SessionUsage {
  const update = params?.update ?? params;
  if (!update) return prev;

  const kind = update.sessionUpdate || update.session_update;

  // Live context size often on stream _meta
  const metaTotal =
    num(params?._meta?.totalTokens) ||
    num(update?._meta?.totalTokens) ||
    num(update?.totalTokens);

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

    return {
      turns: prev.turns + 1,
      inputTokens: prev.inputTokens + input,
      outputTokens: prev.outputTokens + output,
      totalTokens: prev.totalTokens + total,
      lastContextTokens: total || metaTotal || prev.lastContextTokens,
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
export function formatTokens(n: number): string {
  if (!n || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Agent reports costUsdTicks — empirically ~1e9 ticks per USD on recent builds.
 */
export function formatCostUsd(ticks: number): string | null {
  if (!ticks || ticks <= 0) return null;
  const usd = ticks / 1e9;
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(1)}`;
}

/** One-line status bar label */
export function formatUsageBar(u: SessionUsage): string {
  if (u.turns <= 0 && u.lastContextTokens <= 0) return "";
  const parts: string[] = [];
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

/** Tooltip with fuller breakdown */
export function formatUsageTooltip(u: SessionUsage): string {
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
    "Totals are summed from turn_completed usage on this open chat.",
  ];
  return lines.filter(Boolean).join("\n");
}
