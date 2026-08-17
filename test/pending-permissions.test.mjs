import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cancelAllPermissions,
  listPendingPermissionRequests,
  registerPermissionRequest,
  slimPermissionParams,
  settlePendingAllowOnce,
  settlePendingByPolicy,
  settlePendingIf,
} from "../electron/pending-permissions.mjs";
import { classifyPermissionRisk } from "../shared/permission-risk.mjs";

const OWNER = "test-pending-owner";

const ONCE_ALWAYS = [
  { optionId: "allow-once", kind: "allow_once" },
  { optionId: "allow-always", kind: "allow_always" },
];

function park(reqId, params) {
  /** @type {any[]} */
  const outcomes = [];
  registerPermissionRequest({
    reqId,
    params,
    ownerId: OWNER,
    respond: (outcome) => outcomes.push(outcome),
  });
  return outcomes;
}

test.afterEach(() => {
  cancelAllPermissions(undefined, OWNER);
});

test("settlePendingIf filters and skips null outcomes", () => {
  const a = park("p-a", {
    toolCall: { title: "Read a", kind: "read" },
    options: ONCE_ALWAYS,
  });
  const b = park("p-b", {
    toolCall: { title: "Read b", kind: "read" },
    options: ONCE_ALWAYS,
  });
  const n = settlePendingIf(
    OWNER,
    (p) => p.reqId === "p-a",
    (p) =>
      p.reqId === "p-a"
        ? { outcome: { outcome: "selected", optionId: "allow-once" } }
        : null,
  );
  assert.equal(n, 1);
  assert.equal(a.length, 1);
  assert.equal(a[0].outcome.optionId, "allow-once");
  assert.equal(b.length, 0);
  assert.equal(listPendingPermissionRequests(OWNER).length, 1);
});

test("settlePendingAllowOnce never picks allow-always", () => {
  const onlyAlways = park("p-grant", {
    toolCall: { title: "Write file", kind: "edit" },
    options: [{ optionId: "allow-always", kind: "allow_always" }],
  });
  const both = park("p-grant-2", {
    toolCall: { title: "Write file", kind: "edit" },
    options: ONCE_ALWAYS,
  });
  const n = settlePendingAllowOnce(OWNER);
  assert.equal(n, 2);
  assert.equal(onlyAlways[0].outcome.optionId, "allow-once");
  assert.equal(both[0].outcome.optionId, "allow-once");
  assert.equal(listPendingPermissionRequests(OWNER).length, 0);
});

test("settlePendingByPolicy flushes safe reads, parks writes", () => {
  const read = park("p-read", {
    toolCall: { title: "Read foo", kind: "read" },
    options: ONCE_ALWAYS,
  });
  const snap = park("p-snap", {
    toolCall: { title: "desktop-preview__preview_snapshot" },
    options: ONCE_ALWAYS,
  });
  const write = park("p-write", {
    toolCall: { title: "Write foo", kind: "edit" },
    options: ONCE_ALWAYS,
  });
  const npm = park("p-npm", {
    toolCall: { title: "Execute `npm install`", kind: "execute" },
    options: ONCE_ALWAYS,
  });
  const n = settlePendingByPolicy(OWNER, { permissionMode: "auto" });
  assert.equal(n, 2);
  assert.equal(read[0].outcome.optionId, "allow-once");
  assert.equal(snap[0].outcome.optionId, "allow-once");
  assert.equal(write.length, 0);
  assert.equal(npm.length, 0);
  const left = listPendingPermissionRequests(OWNER).map((p) => p.reqId).sort();
  assert.deepEqual(left, ["p-npm", "p-write"]);
});

test("settlePendingIf skips when pickOutcome is null", () => {
  const kept = park("p-null", {
    toolCall: { title: "Read a", kind: "read" },
    options: ONCE_ALWAYS,
  });
  const n = settlePendingIf(OWNER, () => true, () => null);
  assert.equal(n, 0);
  assert.equal(kept.length, 0);
  assert.equal(listPendingPermissionRequests(OWNER).length, 1);
});

test("settlePendingByPolicy does not flush MCP create with kind fetch", () => {
  const create = park("p-linear", {
    toolCall: {
      title: "Create issue",
      kind: "fetch",
      _meta: { "x.ai/tool": { name: "linear__create_issue" } },
    },
    options: ONCE_ALWAYS,
  });
  const n = settlePendingByPolicy(OWNER, { permissionMode: "auto" });
  assert.equal(n, 0);
  assert.equal(create.length, 0);
  assert.deepEqual(
    listPendingPermissionRequests(OWNER).map((p) => p.reqId),
    ["p-linear"],
  );
});

test("slimPermissionParams keeps command when rawInput is truncated", () => {
  const slim = slimPermissionParams({
    toolCall: {
      title: "Execute",
      kind: "execute",
      rawInput: {
        command: "npm install",
        padding: "x".repeat(2000),
      },
    },
    options: ONCE_ALWAYS,
  });
  assert.ok(slim.toolCall.rawInput._truncated);
  assert.equal(slim.toolCall.rawInput.command, "npm install");
  assert.equal(classifyPermissionRisk(slim), "write");
});

test("slimPermissionParams keeps tool name so MCP writes stay write", () => {
  const full = {
    toolCall: {
      title: "Create issue",
      kind: "fetch",
      rawInput: { title: "x" },
      _meta: { "x.ai/tool": { name: "linear__create_issue" } },
    },
    options: ONCE_ALWAYS,
  };
  const slim = slimPermissionParams(full);
  assert.equal(
    slim.toolCall._meta["x.ai/tool"].name,
    "linear__create_issue",
  );
  assert.equal(classifyPermissionRisk(full), "write");
  assert.equal(classifyPermissionRisk(slim), "write");
});
