import test from "node:test";
import assert from "node:assert/strict";
import {
  countTimelineKinds,
  filterTimelineItems,
  isTimelineViewFilter,
  shouldSnapTimelineFilterToAll,
  timelineFilterEmptyLabel,
  TIMELINE_VIEW_FILTERS,
} from "../shared/timeline-filter.mjs";

const items = [
  { id: "1", kind: "user", text: "hi", at: 1 },
  { id: "2", kind: "thought", text: "hmm", at: 2 },
  { id: "3", kind: "assistant", text: "yo", at: 3 },
  { id: "4", kind: "tool", toolCallId: "t", title: "x", status: "done", at: 4 },
  { id: "5", kind: "plan", entries: [], at: 5 },
  { id: "6", kind: "user", text: "again", at: 6 },
];

test("All keeps the same array identity", () => {
  assert.equal(filterTimelineItems(items, "all"), items);
});

test("Prompts / Grok / Thinking isolate those kinds", () => {
  assert.deepEqual(
    filterTimelineItems(items, "user").map((i) => i.id),
    ["1", "6"],
  );
  assert.deepEqual(
    filterTimelineItems(items, "assistant").map((i) => i.id),
    ["3"],
  );
  assert.deepEqual(
    filterTimelineItems(items, "thought").map((i) => i.id),
    ["2"],
  );
});

test("counts ignore tools, plans, and system rows", () => {
  assert.deepEqual(countTimelineKinds(items), {
    user: 2,
    assistant: 1,
    thought: 1,
  });
});

test("filter ids and empty-state labels", () => {
  assert.deepEqual(
    TIMELINE_VIEW_FILTERS.map((f) => f.id),
    ["all", "user", "assistant", "thought"],
  );
  assert.equal(isTimelineViewFilter("all"), true);
  assert.equal(isTimelineViewFilter("user"), true);
  assert.equal(isTimelineViewFilter("tool"), false);
  assert.equal(isTimelineViewFilter("prompts"), false);
  assert.equal(timelineFilterEmptyLabel("all"), "messages");
  assert.equal(timelineFilterEmptyLabel("user"), "prompts");
  assert.equal(timelineFilterEmptyLabel("assistant"), "Grok replies");
  assert.equal(timelineFilterEmptyLabel("thought"), "thinking");
});

test("kind counts are keyed by every non-All filter", () => {
  const counts = countTimelineKinds(items);
  const kindIds = TIMELINE_VIEW_FILTERS.map((f) => f.id).filter(
    (id) => id !== "all",
  );
  assert.deepEqual(Object.keys(counts).sort(), [...kindIds].sort());
});

test("empty list and unknown kinds do not invent counts or matches", () => {
  assert.deepEqual(countTimelineKinds([]), {
    user: 0,
    assistant: 0,
    thought: 0,
  });
  const odd = [{ id: "x", kind: "system", text: "n", at: 1 }];
  assert.deepEqual(countTimelineKinds(odd), {
    user: 0,
    assistant: 0,
    thought: 0,
  });
  assert.deepEqual(filterTimelineItems(odd, "user"), []);
  assert.deepEqual(filterTimelineItems(odd, "assistant"), []);
  assert.deepEqual(filterTimelineItems(odd, "thought"), []);
  assert.equal(filterTimelineItems(odd, "all"), odd);
});

test("send-snap only when the tail is a new user message", () => {
  const user = { id: "u1", kind: "user" };
  const assistant = { id: "a1", kind: "assistant" };
  const thought = { id: "t1", kind: "thought" };
  assert.equal(shouldSnapTimelineFilterToAll(assistant, null), false);
  assert.equal(shouldSnapTimelineFilterToAll(thought, null), false);
  assert.equal(shouldSnapTimelineFilterToAll(undefined, null), false);
  assert.equal(shouldSnapTimelineFilterToAll(user, "u1"), false);
  assert.equal(shouldSnapTimelineFilterToAll(user, "u0"), true);
  assert.equal(shouldSnapTimelineFilterToAll(user, null), true);
});
