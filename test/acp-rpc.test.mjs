/**
 * ACP JSON-RPC protocol tests — drives shipped shared/acp-rpc.mjs and
 * electron/acp-protocol.mjs (real entry points, no reimplementation).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyInboundMessage,
  compactConversationAttempts,
  compactConversationRequestParams,
  unwrapExtMethodResult,
  worktreeCreateFromSyncAttempts,
  worktreeListAttempts,
  parseWorktreeCreateResponse,
  parseWorktreeListResponse,
  sessionRenameAttempts,
  sessionRenameRequestParams,
  sessionDeleteAttempts,
  sessionDeleteRequestParams,
  isMcpLiveEventMethod,
  mcpAuthTriggerAttempts,
  mcpAuthTriggerRequestParams,
  mcpSessionListAttempts,
  unwrapMcpExtNotification,
  createOnceResponder,
  createPermissionOneshot,
  dispatchInboundMessage,
  isPermissionMethod,
  isFsReadMethod,
  buildJsonRpcResult,
  buildJsonRpcError,
  jsonRpcErrorCode,
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

test("classify ext_notification session_notification as session-update", () => {
  const inner = {
    sessionId: "s1",
    update: {
      sessionUpdate: "auto_compact_completed",
      tokens_before: 31000,
      tokens_after: 12000,
    },
  };
  const c = classifyInboundMessage({
    jsonrpc: "2.0",
    method: "ext_notification",
    params: {
      method: "x.ai/session_notification",
      params: inner,
    },
  });
  assert.equal(c.kind, "session-update");
  assert.equal(c.method, "x.ai/session_notification");
  assert.deepEqual(c.params, inner);
});

test("classify _x.ai/session_notification as session-update", () => {
  const inner = {
    update: { sessionUpdate: "auto_compact_started" },
  };
  const c = classifyInboundMessage({
    jsonrpc: "2.0",
    method: "_x.ai/session_notification",
    params: inner,
  });
  assert.equal(c.kind, "session-update");
  assert.deepEqual(c.params, inner);
});

test("classify nested session_notification params.method + params.params", () => {
  const update = {
    sessionUpdate: "auto_compact_completed",
    tokens_before: 10,
    tokens_after: 4,
  };
  const c = classifyInboundMessage({
    jsonrpc: "2.0",
    method: "ext_notification",
    params: {
      method: "x.ai/session_notification",
      params: {
        method: "session/update",
        params: { update },
      },
    },
  });
  assert.equal(c.kind, "session-update");
  assert.deepEqual(c.params, { update });
});

test("classify ext_notification yolo_mode_changed stays a notification", () => {
  const c = classifyInboundMessage({
    jsonrpc: "2.0",
    method: "ext_notification",
    params: {
      method: "x.ai/yolo_mode_changed",
      params: { yolo_mode: true },
    },
  });
  assert.equal(c.kind, "notification");
  assert.equal(c.method, "ext_notification");
});

test("compactConversationRequestParams matches grok-build CompactConversationRequest", () => {
  assert.deepEqual(compactConversationRequestParams("sess-1"), {
    sessionId: "sess-1",
  });
  assert.deepEqual(compactConversationRequestParams("sess-1", " keep this "), {
    sessionId: "sess-1",
    userContext: "keep this",
  });
});

test("compactConversationAttempts uses underscore ACP ext method on stdio", () => {
  const attempts = compactConversationAttempts("sess-1", "keep auth");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].method, "_x.ai/compact_conversation");
  assert.deepEqual(attempts[0].params, {
    sessionId: "sess-1",
    userContext: "keep auth",
  });
});

test("worktree ACP helpers match TUI create_from_worktree_sync", () => {
  const attempts = worktreeCreateFromSyncAttempts({
    sourceWorktreePath: "/repo",
    newSessionId: "desktop-abc",
    copyMode: "dirty",
  });
  assert.equal(attempts[0].method, "_x.ai/git/worktree/create_from_worktree_sync");
  assert.equal(attempts[0].params.sourceWorktreePath, "/repo");
  assert.equal(attempts[0].params.newSessionId, "desktop-abc");
  assert.equal(worktreeListAttempts({ repo: "/repo" })[0].method, "_x.ai/git/worktree/list");

  const created = parseWorktreeCreateResponse({
    result: { worktreePath: "/home/u/.grok/worktrees/repo/wt-1", newSessionId: "desktop-abc" },
    error: null,
  });
  assert.equal(created.path, "/home/u/.grok/worktrees/repo/wt-1");

  const listed = parseWorktreeListResponse([
    { path: "/home/u/.grok/worktrees/repo/wt-1", git_ref: "HEAD", metadata: { label: "fix" } },
  ]);
  assert.equal(listed[0].label, "fix");
  assert.equal(listed[0].gitRef, "HEAD");

  assert.equal(unwrapExtMethodResult({ result: { ok: true }, error: null }).ok, true);
  assert.throws(() => unwrapExtMethodResult({ error: "nope" }), /nope/);
});

test("mcpAuthTriggerAttempts uses underscore ACP ext method and both casings", () => {
  assert.deepEqual(mcpAuthTriggerRequestParams("sess-1", "atlassian"), {
    sessionId: "sess-1",
    session_id: "sess-1",
    serverName: "atlassian",
    server_name: "atlassian",
  });
  const attempts = mcpAuthTriggerAttempts("sess-1", "atlassian");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].method, "_x.ai/mcp/auth_trigger");
  assert.equal(attempts[0].params.server_name, "atlassian");
});

test("sessionRenameAttempts uses underscore ACP ext method and both casings", () => {
  const params = sessionRenameRequestParams({
    sessionId: "sess-1",
    title: "Auth refactor",
    cwd: "/proj",
  });
  assert.equal(params.sessionId, "sess-1");
  assert.equal(params.session_id, "sess-1");
  assert.equal(params.title, "Auth refactor");
  assert.equal(params.cwd, "/proj");
  assert.equal(params.kind, "build");
  assert.equal(params.resetToAuto, undefined);
  const attempts = sessionRenameAttempts({
    sessionId: "sess-1",
    title: "Auth refactor",
    cwd: "/proj",
  });
  assert.equal(attempts[0].method, "_x.ai/session/rename");
  assert.equal(attempts[1].method, "x.ai/session/rename");
  assert.deepEqual(attempts[0].params, params);
});

test("sessionDeleteAttempts uses underscore ACP ext method and both casings", () => {
  const params = sessionDeleteRequestParams({
    sessionId: "sess-1",
    cwd: "/proj",
  });
  assert.equal(params.sessionId, "sess-1");
  assert.equal(params.session_id, "sess-1");
  assert.equal(params.cwd, "/proj");
  assert.equal(params.kind, "build");
  const attempts = sessionDeleteAttempts({
    sessionId: "sess-1",
    cwd: "/proj",
  });
  assert.equal(attempts[0].method, "_x.ai/session/delete");
  assert.equal(attempts[1].method, "x.ai/session/delete");
  assert.deepEqual(attempts[0].params, params);
});

test("mcpSessionListAttempts uses underscore ACP ext method", () => {
  const attempts = mcpSessionListAttempts("sess-1", { cache: true });
  assert.equal(attempts[0].method, "_x.ai/mcp/list");
  assert.equal(attempts[1].method, "x.ai/mcp/list");
  assert.equal(attempts[0].params.sessionId, "sess-1");
  assert.equal(attempts[0].params.session_id, "sess-1");
  assert.equal(attempts[0].params.cache, true);
});

test("unwrapMcpExtNotification peels server_status and init_progress", () => {
  const nested = unwrapMcpExtNotification("ext_notification", {
    method: "x.ai/mcp/server_status",
    params: { name: "mysql", status: "ready" },
  });
  assert.deepEqual(nested, {
    method: "x.ai/mcp/server_status",
    params: { name: "mysql", status: "ready" },
  });
  const direct = unwrapMcpExtNotification("_x.ai/mcp/init_progress", {
    total: 3,
    connected: 1,
  });
  assert.equal(direct?.method, "x.ai/mcp/init_progress");
  assert.equal(isMcpLiveEventMethod("x.ai/mcp/server_status"), true);
  assert.equal(isMcpLiveEventMethod("session/update"), false);
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

test("fs/read ENOENT returns empty content (write-before-create)", async () => {
  /** @type {object[]} */
  const out = [];
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    readFile: async () => {
      const err = new Error("ENOENT: no such file");
      err.code = "ENOENT";
      throw err;
    },
    resolvePath: (p) => p,
  });
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 77,
    method: "fs/read_text_file",
    params: { path: "/proj/docs/NEWFILE.md" },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const reply = out.find((m) => m.id === 77);
  assert.ok(reply);
  assert.equal(reply.error, undefined);
  assert.equal(reply.result.content, "");
});

test("jsonRpcErrorCode coerces Node string codes to integers", () => {
  assert.equal(jsonRpcErrorCode("ENOENT"), -32000);
  assert.equal(jsonRpcErrorCode("EACCES"), -32000);
  assert.equal(jsonRpcErrorCode(-32601), -32601);
  assert.equal(jsonRpcErrorCode(undefined), -32000);
  const errMsg = buildJsonRpcError(1, { code: "ENOENT", message: "missing" });
  assert.equal(typeof errMsg.error.code, "number");
  assert.equal(errMsg.error.code, -32000);
  assert.equal(errMsg.error.message, "missing");
});

test("fs/read other errors use numeric JSON-RPC codes (not Node string codes)", async () => {
  /** @type {object[]} */
  const out = [];
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    readFile: async () => {
      const err = new Error("EACCES: permission denied");
      err.code = "EACCES"; // Node string code — must not leak into JSON-RPC
      throw err;
    },
    resolvePath: (p) => p,
  });
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 78,
    method: "fs/read_text_file",
    params: { path: "/secret" },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const reply = out.find((m) => m.id === 78);
  assert.ok(reply?.error);
  assert.equal(typeof reply.error.code, "number");
  assert.equal(reply.error.code, -32000);
  assert.match(String(reply.error.message), /EACCES|permission/i);
});

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

test("ext_notification session_notification is forwarded as session-update", () => {
  /** @type {any[]} */
  const updates = [];
  const once = createOnceResponder(() => {});
  dispatchInboundMessage(
    {
      jsonrpc: "2.0",
      method: "ext_notification",
      params: {
        method: "x.ai/session_notification",
        params: {
          update: {
            sessionUpdate: "auto_compact_completed",
            tokens_before: 8000,
            tokens_after: 3000,
          },
        },
      },
    },
    {
      once,
      onSessionUpdate: (p) => updates.push(p),
      onNotification: () => {
        assert.fail("compact session_notification must not stay a generic notification");
      },
      handleServerRequest: async () => {
        assert.fail("session_notification must not run handleServerRequest");
      },
    },
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].update.sessionUpdate, "auto_compact_completed");
  assert.equal(updates[0].update.tokens_after, 3000);
});

test("auto mode silent-allows read permissions", async () => {
  /** @type {object[]} */
  const out = [];
  let parked = false;
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "auto",
    listenerCount: () => 1,
    onPermissionRequest: () => {
      parked = true;
    },
  });
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "session/request_permission",
    params: {
      toolCall: { title: "Read src/App.tsx", kind: "read" },
      options: [{ optionId: "allow-once", kind: "allow_once" }],
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(parked, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].result.outcome.optionId, "allow-once");
});

test("auto mode still parks write permissions", async () => {
  /** @type {object[]} */
  const out = [];
  let parked = false;
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "auto",
    listenerCount: () => 1,
    onPermissionRequest: ({ oneshot }) => {
      parked = true;
      oneshot.settle({
        outcome: { outcome: "selected", optionId: "allow-once" },
      });
    },
  });
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 71,
    method: "session/request_permission",
    params: {
      toolCall: { title: "Write file", kind: "edit" },
      options: [{ optionId: "allow-once", kind: "allow_once" }],
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(parked, true);
  assert.equal(out.length, 1);
});

test("auto mode silent-allows preview_snapshot and preview_open", async () => {
  for (const title of ["preview_snapshot", "preview_open"]) {
    /** @type {object[]} */
    const out = [];
    let parked = false;
    const rt = createAcpClientRuntime({
      write: (m) => out.push(m),
      permissionMode: "auto",
      listenerCount: () => 1,
      onPermissionRequest: () => {
        parked = true;
      },
    });
    rt.handleMessage({
      jsonrpc: "2.0",
      id: 72,
      method: "session/request_permission",
      params: {
        toolCall: { title },
        options: [{ optionId: "allow-once", kind: "allow_once" }],
      },
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(parked, false, title);
    assert.equal(out.length, 1, title);
    assert.equal(out[0].result.outcome.optionId, "allow-once", title);
  }
});

test("auto mode parks npm install and preview fill/click", async () => {
  for (const toolCall of [
    { title: "Execute `npm install`", kind: "execute" },
    { title: "preview_fill" },
    { title: "preview_click" },
  ]) {
    /** @type {object[]} */
    const out = [];
    let parked = false;
    const rt = createAcpClientRuntime({
      write: (m) => out.push(m),
      permissionMode: "auto",
      listenerCount: () => 1,
      onPermissionRequest: ({ oneshot }) => {
        parked = true;
        oneshot.settle({
          outcome: { outcome: "selected", optionId: "allow-once" },
        });
      },
    });
    rt.handleMessage({
      jsonrpc: "2.0",
      id: 73,
      method: "session/request_permission",
      params: {
        toolCall,
        options: [{ optionId: "allow-once", kind: "allow_once" }],
      },
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(parked, true, toolCall.title);
    assert.equal(out.length, 1, toolCall.title);
  }
});

test("session grant auto-allows writes without allowAlwaysOk", async () => {
  /** @type {object[]} */
  const out = [];
  let parked = false;
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "auto",
    allowWritesThisSession: true,
    listenerCount: () => 1,
    onPermissionRequest: () => {
      parked = true;
    },
  });
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 74,
    method: "session/request_permission",
    params: {
      toolCall: { title: "Write file", kind: "edit" },
      options: [
        { optionId: "allow-once", kind: "allow_once" },
        { optionId: "allow-always", kind: "allow_always" },
      ],
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(parked, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].result.outcome.optionId, "allow-once");
});

test("session grant still picks allow-once when catalog is allow-always only", async () => {
  /** @type {object[]} */
  const out = [];
  const rt = createAcpClientRuntime({
    write: (m) => out.push(m),
    permissionMode: "ask",
    allowWritesThisSession: true,
    listenerCount: () => 1,
    onPermissionRequest: () => {},
  });
  rt.handleMessage({
    jsonrpc: "2.0",
    id: 75,
    method: "session/request_permission",
    params: {
      toolCall: { title: "Write file", kind: "edit" },
      options: [{ optionId: "allow-always", kind: "allow_always" }],
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(out.length, 1);
  assert.equal(out[0].result.outcome.optionId, "allow-once");
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
