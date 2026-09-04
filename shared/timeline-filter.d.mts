export type TimelineViewFilter = "all" | "user" | "assistant" | "thought";

export const TIMELINE_VIEW_FILTERS: readonly {
  id: TimelineViewFilter;
  label: string;
  title: string;
}[];

export function isTimelineViewFilter(
  value: unknown,
): value is TimelineViewFilter;

export function filterTimelineItems<T extends { kind: string }>(
  items: T[],
  filter: TimelineViewFilter,
): T[];

export type TimelineKindFilter = Exclude<TimelineViewFilter, "all">;

export function countTimelineKinds(
  items: readonly { kind: string }[],
): Record<TimelineKindFilter, number>;

export function timelineFilterEmptyLabel(filter: TimelineViewFilter): string;

export function shouldSnapTimelineFilterToAll(
  last: { kind: string; id: string } | undefined | null,
  prevUserId: string | null,
): last is { kind: "user"; id: string };
