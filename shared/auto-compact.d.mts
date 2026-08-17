export type AutoCompactAt = "off" | "64k" | "128k" | "192k";

export const AUTO_COMPACT_OPTIONS: Array<{
  id: AutoCompactAt;
  tokens: number;
  label: string;
  hint: string;
}>;

export function normalizeAutoCompactAt(value: unknown): AutoCompactAt;
export function autoCompactTokenThreshold(value: unknown): number;
export function shouldAutoCompact(opts?: {
  at?: unknown;
  lastContextTokens?: number;
  alreadyFiredAt?: number;
}): boolean;
