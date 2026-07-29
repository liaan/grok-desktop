/**
 * ACP JSON-RPC protocol tests — drives shipped shared/acp-rpc.mjs and
 * electron/acp-protocol.mjs (real entry points, no reimplementation).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyInboundMessage,
  createOnceResponder,
  createPermissionOneshot,
  dispatchInboundMessage,
  isPermissionMethod,
  isFsReadMethod,
  buildJsonRpcResult,
  buildJsonRpcError,
} from "../shared/acp-rpc.mjs";
import { createAcpClientRuntime } from "../electron/acp-protocol.mjs";
import {
  cancelledPermissionResult,
  selectedPermissionResult,
} from "../shared/permission-options.mjs";

// --- classify ---

test("classify session/update as progress notification", () => {
  const c = classifyInboundMessage({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      update: { sessionUpdate: "tool_call", toolCallId: "c1", status: "pending" },
    },
  });
  assert.equal(c.kind, "session-update");
  assert.equal(c.expectsEmptyAck, false);
});

test("classify session/update with id expects empty ack only", () => {
  const c = classifyInboundMessage({
    jsonrpc: "2.0",
    id: 9,
    method: "session/update",
    params: { update: { sessionUpdate: "tool_call" } },
  });
  assert.equal(c.kind, "session-update");
  assert.equal(c.expectsEmptyAck, true);
  assert.equal(c.id, 9);
});

test("classify session/request_permission as server-request", () => {
  const c = classifyInboundMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "session/request_permission",
    params: {
      toolCall: { toolCallId: "call_001" },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    },
  });
  assert.equal(c.kind, "server-request");
  assert.equal(c.id, 5);
  assert.ok(isPermissionMethod(c.method));
});

test("classify fs/read_text_file as server-request", () => {
  const c = classifyInboundMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "fs/read_text_file",
    params: { path: "/proj/a.txt" },
  });
  assert.equal(c.kind, "server-request");
  assert.ok(isFsReadMethod(c.method));
});

// --- once responder ---

test("once responder writes exactly one response per open request lifecycle", () => {
  /** @type {object[]} */
  const out = [];
  const once = createOnceResponder((m) => out.push(m));
  once.beginRequest(1);
  assert.equal(once.respond(1, { ok: true }), true);
  assert.equal(once.respond(1, { ok: false }), false);
  assert.equal(once.respond(1, null, { code: 1, message: "x" }), false);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], buildJsonRpcResult(1, { ok: true }));
});

test("once responder allows JSON-RPC id reuse after prior response completed", () => {
  /** @type {object[]} */
  const out = [];
  const once = createOnceResponder((m) => out.push(m));
  once.beginRequest(1);
  assert.equal(once.respond(1, { first: true }), true);
  // Agent reuses id 1 for a later independent request
  once.beginRequest(1);
  assert.equal(once.respond(1, { content: "x" }), true);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].result, { first: true });
  assert.deepEqual(out[1].result, { content: "x" });
});

test("once responder write failure does not burn the id", () => {
  let fail = true;
  /** @type {object[]} */
  const out = [];
  const once = createOnceResponder((m) => {
    if (fail) throw new Error("stdin not writable");
    out.push(m);
  });
  once.beginRequest(3);
  assert.throws(() => once.respond(3, { a: 1 }), /stdin not writable/);
  assert.equal(once.hasResponded(3), false);
  fail = false;
  assert.equal(once.respond(3, { a: 1 }), true);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].result, { a: 1 });
});

test("once responder error body uses same id", () => {
  /** @type {object[]} */
  const out = [];
  const once = createOnceResponder((m) => out.push(m));
  once.beginRequest(7);
  once.respond(7, null, { code: -32601, message: "nope" });
  assert.deepEqual(out[0], buildJsonRpcError(7, { code: -32601, message: "nope" }));
});

test("runtime: second independent request reusing id still gets a response", async () => {
  /** @type {object[]} */
  const out = [];
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "always-approve",
    readFile: async () => "v1",
    resolvePath: (p) => p,
  });
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "fs/read_text_file",
    params: { path: "/a.txt" },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(out.filter((m) => m.id === 1).length, 1);

  // Reuse id 1 for a new request (legal JSON-RPC after prior completed)
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "fs/read_text_file",
    params: { path: "/b.txt" },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const replies = out.filter((m) => m.id === 1);
  assert.equal(replies.length, 2, "reused id must get a second response");
});

// --- permission oneshot ---

test("permission oneshot settles once", async () => {
  const gate = createPermissionOneshot();
  const p = gate.wait();
  assert.equal(gate.settle(selectedPermissionResult("allow-once")), true);
  assert.equal(gate.settle(cancelledPermissionResult()), false);
  const decision = await p;
  assert.equal(decision.outcome.outcome, "selected");
  assert.equal(decision.outcome.optionId, "allow-once");
});

// --- concurrent permission + fs ---

test("fs/read completes while permission is still open (concurrent)", async () => {
  /** @type {object[]} */
  const out = [];
  /** @type {ReturnType<typeof createPermissionOneshot> | null} */
  let openGate = null;

  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "ask",
    listenerCount: () => 1,
    onPermissionRequest: ({ oneshot }) => {
      openGate = oneshot;
    },
    readFile: async (p) => {
      assert.equal(p, "/proj/Dockerfile");
      return "FROM node\n";
    },
    resolvePath: (p) => p,
  });

  // Park permission first
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 10,
    method: "session/request_permission",
    params: {
      toolCall: { toolCallId: "c-shell", title: "Execute docker" },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    },
  });

  // Concurrent fs read — must not wait on permission UI
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 11,
    method: "fs/read_text_file",
    params: { path: "/proj/Dockerfile" },
  });

  // Allow event loop to run handlers
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const fsReply = out.find((m) => m.id === 11);
  assert.ok(fsReply, "fs response must arrive while permission still open");
  assert.equal(fsReply.result.content, "FROM node\n");
  assert.ok(!out.some((m) => m.id === 10), "permission must still be open");

  assert.ok(openGate);
  openGate.settle(selectedPermissionResult("allow-once"));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const permReply = out.find((m) => m.id === 10);
  assert.ok(permReply);
  assert.equal(permReply.result.outcome.outcome, "selected");
  assert.equal(permReply.result.outcome.optionId, "allow-once");
  // Exactly one response each
  assert.equal(out.filter((m) => m.id === 10).length, 1);
  assert.equal(out.filter((m) => m.id === 11).length, 1);
});

test("permission Allow once: one result with matching id", async () => {
  /** @type {object[]} */
  const out = [];
  /** @type {ReturnType<typeof createPermissionOneshot> | null} */
  let openGate = null;
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "ask",
    listenerCount: () => 1,
    onPermissionRequest: ({ oneshot }) => {
      openGate = oneshot;
    },
  });

  rt.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "session/request_permission",
    params: {
      toolCall: { toolCallId: "call_001" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(openGate);
  // Double settle must not double-respond
  assert.equal(openGate.settle(selectedPermissionResult("allow-once")), true);
  assert.equal(openGate.settle(selectedPermissionResult("allow-once")), false);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const replies = out.filter((m) => m.id === 5);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].result.outcome.optionId, "allow-once");
});

test("cancel open permission yields cancelled outcome once", async () => {
  /** @type {object[]} */
  const out = [];
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "ask",
    listenerCount: () => 1,
    onPermissionRequest: () => {},
  });

  rt.handleMessage({
    jsonrpc: "2.0",
    id: 42,
    method: "session/request_permission",
    params: {
      toolCall: { toolCallId: "c1" },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    },
  });
  await new Promise((r) => setImmediate(r));
  rt.cancelOpenPermissions();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const replies = out.filter((m) => m.id === 42);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].result.outcome.outcome, "cancelled");
});

test("session/update does not produce tool completion responses", () => {
  /** @type {object[]} */
  const out = [];
  /** @type {any[]} */
  const updates = [];
  const once = createOnceResponder((m) => out.push(m));
  dispatchInboundMessage(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "c1",
          status: "pending",
          title: "Read Dockerfile",
        },
      },
    },
    {
      once,
      onSessionUpdate: (p) => updates.push(p),
      handleServerRequest: async () => {
        assert.fail("session/update must not run handleServerRequest");
      },
    },
  );
  assert.equal(updates.length, 1);
  assert.equal(out.length, 0);
});

test("always-approve auto-responds permission without parking", async () => {
  /** @type {object[]} */
  const out = [];
  let parked = false;
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "always-approve",
    listenerCount: () => 1,
    onPermissionRequest: () => {
      parked = true;
    },
  });
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 8,
    method: "session/request_permission",
    params: {
      toolCall: { title: "Write file" },
      options: [{ optionId: "allow-once", kind: "allow_once" }],
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(parked, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 8);
  assert.equal(out[0].result.outcome.outcome, "selected");
});
