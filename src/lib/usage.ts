/**
 * Session usage from ACP / Grok turn_completed (and live totalTokens meta).
 * Core logic lives in shared/usage.mjs so Electron main can hydrate from disk.
 */

// shared/*.mjs is executed by Node/Electron and Vite; tsc does not attach
// shared/usage.mjs.d.ts to this relative import under moduleResolution bundler.
// Keep SessionUsage typed here; cast shared helpers at the boundary.
// @ts-ignore -- see shared/usage.mjs.d.ts for the runtime shape
import * as shared from "../../shared/usage.mjs";

export type SessionUsage = {
  /** Completed agent turns (turn_completed events) in this Desktop session view */
  turns: number;
  /** Sum of per-turn input tokens */
  inputTokens: number;
  /** Sum of per-turn output tokens */
  outputTokens: number;
  /** Sum of per-turn totalTokens (can exceed context — sum of billable totals) */
  totalTokens: number;
  /** Live window occupancy (`_meta.totalTokens`), not billed turn totals */
  lastContextTokens: number;
  cachedReadTokens: number;
  reasoningTokens: number;
  modelCalls: number;
  /** Agent cost ticks (1 USD = 1e10 ticks; grok-build USD_TICKS_PER_USD) */
  costUsdTicks: number;
  lastModel?: string;
};

export function emptyUsage(): SessionUsage {
  return shared.emptyUsage() as SessionUsage;
}

export function applyUsageUpdate(
  prev: SessionUsage,
  params: unknown,
): SessionUsage {
  return shared.applyUsageUpdate(prev, params) as SessionUsage;
}

export function formatTokens(n: number): string {
  return shared.formatTokens(n) as string;
}

export function formatCostUsd(ticks: number): string | null {
  return shared.formatCostUsd(ticks) as string | null;
}

export function formatUsageBar(u: SessionUsage): string {
  return shared.formatUsageBar(u) as string;
}

export function formatUsageTooltip(u: SessionUsage): string {
  return shared.formatUsageTooltip(u) as string;
}
