/**
 * Renderer reasoning-effort surface: re-export shared helpers + UI options.
 */
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORTS,
  normalizeReasoningEffort as normalizeShared,
  reasoningEffortDescription as descShared,
  reasoningEffortLabel as labelShared,
  type ReasoningEffort as SharedEffort,
} from "../../shared/reasoning-effort.mjs";

export type ReasoningEffort = SharedEffort;

export { DEFAULT_REASONING_EFFORT, REASONING_EFFORTS };

export const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
  description: string;
}> = REASONING_EFFORTS.map((value) => ({
  value,
  label: labelShared(value),
  description: descShared(value),
}));

export function normalizeReasoningEffort(
  value: unknown,
  fallback: ReasoningEffort = DEFAULT_REASONING_EFFORT,
): ReasoningEffort {
  return normalizeShared(value, fallback);
}

export function reasoningEffortLabel(level: ReasoningEffort): string {
  return labelShared(level);
}

export function reasoningEffortDescription(level: ReasoningEffort): string {
  return descShared(level);
}
