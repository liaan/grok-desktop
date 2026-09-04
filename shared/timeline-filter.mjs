export const TIMELINE_VIEW_FILTERS = [
  { id: "all", label: "All", title: "Show the full thread" },
  { id: "user", label: "Prompts", title: "Show your prompts only" },
  { id: "assistant", label: "Grok", title: "Show Grok replies only" },
  { id: "thought", label: "Thinking", title: "Show thinking only" },
];

export function isTimelineViewFilter(value) {
  return (
    value === "all" ||
    value === "user" ||
    value === "assistant" ||
    value === "thought"
  );
}

export function filterTimelineItems(items, filter) {
  if (filter === "all") return items;
  return items.filter((item) => item.kind === filter);
}

export function countTimelineKinds(items) {
  let user = 0;
  let assistant = 0;
  let thought = 0;
  for (const item of items) {
    if (item.kind === "user") user += 1;
    else if (item.kind === "assistant") assistant += 1;
    else if (item.kind === "thought") thought += 1;
  }
  return { user, assistant, thought };
}

export function timelineFilterEmptyLabel(filter) {
  if (filter === "user") return "prompts";
  if (filter === "assistant") return "Grok replies";
  if (filter === "thought") return "thinking";
  return "messages";
}

export function shouldSnapTimelineFilterToAll(last, prevUserId) {
  return last?.kind === "user" && last.id !== prevUserId;
}
