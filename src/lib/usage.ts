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
