export type SessionUsage = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastContextTokens: number;
  cachedReadTokens: number;
  reasoningTokens: number;
  modelCalls: number;
  costUsdTicks: number;
  lastModel?: string;
};

export function emptyUsage(): SessionUsage;
export function applyUsageUpdate(prev: SessionUsage, params: any): SessionUsage;
export function formatTokens(n: number): string;
export function formatCostUsd(ticks: number): string | null;
export function formatUsageBar(u: SessionUsage): string;
export function formatUsageTooltip(u: SessionUsage): string;
