/**
 * Timeline reducer: tool status inference for ACP tool_call / tool_call_update.
 * Grok write/edit often omit status:"completed" on the final diff update.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applySessionUpdate,
  finalizeOpenTools,
  looksLikeFinalToolResult,
  resolveToolUpdateStatus,
} from "../shared/session-timeline.mjs";

test("looksLikeFinalToolResult: diff content is final", () => {
  assert.equal(
    looksLikeFinalToolResult({
      content: [
        {
          type: "diff",
          path: "/tmp/a.md",
          oldText: "",
          newText: "hello",
        },
      ],
    }),
    true,
  );
});

test("looksLikeFinalToolResult: typed rawOutput is final", () => {
  assert.equal(
    looksLikeFinalToolResult({ rawOutput: { type: "ListDir", Content: {} } }),
    true,
  );
});

test("looksLikeFinalToolResult: bare rawOutput without type is not final", () => {
  assert.equal(looksLikeFinalToolResult({ rawOutput: {} }), false);
  assert.equal(looksLikeFinalToolResult({ rawOutput: "partial" }), false);
});

test("looksLikeFinalToolResult: text-only content is not assumed final", () => {
  assert.equal(
    looksLikeFinalToolResult({
      content: [
        {
          type: "content",
          content: { type: "text", text: "still working…" },
        },
      ],
    }),
    false,
  );
});

test("resolveToolUpdateStatus: explicit status wins", () => {
  assert.equal(
    resolveToolUpdateStatus(
      { status: "failed", content: [{ type: "diff", path: "x" }] },
      "in_progress",
    ),
    "failed",
  );
});

test("resolveToolUpdateStatus: diff without status → completed", () => {
  assert.equal(
    resolveToolUpdateStatus(
      {
        content: [
          { type: "diff", path: "BACKLOG.md", oldText: "", newText: "# hi" },
        ],
      },
      "in_progress",
    ),
    "completed",
  );
});

test("write tool_call_update with diff completes open card (Grok quirk)", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call-write-20",
      title: "write",
      rawInput: { file_path: "docs/BACKLOG.md", content: "…" },
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "pending");

  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call-write-20",
      kind: "edit",
      title: "Write `docs/BACKLOG.md`",
      content: [
        {
          type: "diff",
          path: "docs/BACKLOG.md",
          oldText: "",
          newText: "# Product backlog\n",
        },
      ],
      // no status — matches live Grok 0.2.114 session dumps
    },
  });
  assert.equal(items[0].status, "completed");
  assert.ok(Array.isArray(items[0].content));
});

test("edit tool batch: both finish from diff updates without status", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "w1",
      title: "write",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "w1",
      content: [{ type: "diff", path: "a.md", oldText: "", newText: "a" }],
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "e1",
      title: "search_replace",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "e1",
      content: [{ type: "diff", path: "b.md", oldText: "x", newText: "y" }],
    },
  });
  assert.equal(items.find((i) => i.toolCallId === "w1")?.status, "completed");
  assert.equal(items.find((i) => i.toolCallId === "e1")?.status, "completed");
});

test("tool_call_update upsert when tool_call was never seen", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "only-update",
      title: "Write file",
      content: [{ type: "diff", path: "x", oldText: null, newText: "z" }],
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].toolCallId, "only-update");
  assert.equal(items[0].status, "completed");
});

test("explicit in_progress without final payload stays open", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "run",
      status: "pending",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "in_progress",
    },
  });
  assert.equal(items[0].status, "in_progress");
});

test("turn_completed finalizes leftover open tools", () => {
  let items = [
    {
      id: "1",
      kind: "tool",
      toolCallId: "open",
      title: "Write",
      status: "in_progress",
    },
    {
      id: "2",
      kind: "tool",
      toolCallId: "done",
      title: "Read",
      status: "completed",
    },
  ];
  items = applySessionUpdate(items, {
    update: { sessionUpdate: "turn_completed" },
  });
  assert.equal(items.find((i) => i.toolCallId === "open")?.status, "completed");
  assert.equal(items.find((i) => i.toolCallId === "done")?.status, "completed");
});

test("finalizeOpenTools cancels open cards", () => {
  const items = finalizeOpenTools(
    [
      { id: "1", kind: "tool", toolCallId: "a", status: "pending" },
      { id: "2", kind: "assistant", text: "hi" },
    ],
    "cancelled",
  );
  assert.equal(items[0].status, "cancelled");
  assert.equal(items[1].kind, "assistant");
});

test("read tools with explicit completed still work", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "r1",
      title: "read_file",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "r1",
      kind: "read",
      title: "Read README",
    },
  });
  assert.equal(items[0].status, "pending");
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "r1",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "file body" },
        },
      ],
    },
  });
  assert.equal(items[0].status, "completed");
});
