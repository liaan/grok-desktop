/**
 * Folder-trust ACP reverse-request (project MCP gated until trust).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  acpClientCapabilities,
  folderTrustResponse,
  isFolderTrustMethod,
  isMcpElicitCompleteMethod,
  isMcpElicitMethod,
  mcpElicitResponse,
  parseFolderTrustRequest,
  parseMcpElicitRequest,
  unwrapExtParams,
} from "../shared/acp-rpc.mjs";
import {
  handleExitPlanMode,
  handleFolderTrustRequest,
  handleMcpElicit,
} from "../electron/acp-ext-methods.mjs";

test("isFolderTrustMethod matches stdio underscore and nested names", () => {
  assert.equal(isFolderTrustMethod("x.ai/folder_trust/request"), true);
  assert.equal(isFolderTrustMethod("_x.ai/folder_trust/request"), true);
  assert.equal(isFolderTrustMethod("session/request_permission"), false);
});

test("acpClientCapabilities advertises folderTrust.interactive", () => {
  const caps = acpClientCapabilities();
  assert.equal(caps._meta["x.ai/folderTrust"].interactive, true);
  assert.equal(caps.terminal, true);
  assert.equal(caps.fs.readTextFile, true);
});

test("parseFolderTrustRequest accepts camelCase and snake_case", () => {
  const a = parseFolderTrustRequest({
    sessionId: "s1",
    cwd: "/wt",
    workspace: "/wt",
    configKinds: ["mcp", "hooks"],
  });
  assert.equal(a.sessionId, "s1");
  assert.deepEqual(a.configKinds, ["mcp", "hooks"]);
  const b = parseFolderTrustRequest({
    session_id: "s2",
    cwd: "/repo",
    config_kinds: ["lsp"],
  });
  assert.equal(b.sessionId, "s2");
  assert.equal(b.workspace, "/repo");
  assert.deepEqual(b.configKinds, ["lsp"]);
});

test("unwrapExtParams peels nested ext_method for folder-trust and elicit", () => {
  const inner = { sessionId: "s", cwd: "/p", configKinds: ["mcp"] };
  assert.equal(
    unwrapExtParams("_x.ai/folder_trust/request", inner, isFolderTrustMethod),
    inner,
  );
  const nested = unwrapExtParams(
    "ext_method",
    { method: "x.ai/folder_trust/request", params: inner },
    isFolderTrustMethod,
  );
  assert.equal(nested, inner);

  const elicit = { sessionId: "s", mode: "form", message: "Need email" };
  assert.equal(
    unwrapExtParams("_x.ai/mcp/elicit", elicit, isMcpElicitMethod),
    elicit,
  );
  assert.deepEqual(
    unwrapExtParams(
      "ext_method",
      { method: "x.ai/mcp/elicit", params: elicit },
      isMcpElicitMethod,
    ),
    elicit,
  );
});

test("folderTrustResponse is fail-closed", () => {
  assert.deepEqual(folderTrustResponse("trust"), { outcome: "trust" });
  assert.deepEqual(folderTrustResponse("reject"), { outcome: "reject" });
  assert.deepEqual(folderTrustResponse("banana"), { outcome: "reject" });
  assert.deepEqual(folderTrustResponse(null), { outcome: "reject" });
});

test("handleFolderTrustRequest auto-trusts without UI", async () => {
  let result = null;
  await handleFolderTrustRequest(
    {
      emitter: new EventEmitter(),
      listenerCount: 0,
      shouldAutoTrust: () => true,
      respond: (_id, value) => {
        result = value;
      },
    },
    1,
    { sessionId: "s", cwd: "/home/u/.grok/worktrees/a", configKinds: ["mcp"] },
    "_x.ai/folder_trust/request",
  );
  assert.deepEqual(result, { outcome: "trust" });
});

test("handleFolderTrustRequest rejects when no listener and not auto", async () => {
  let result = null;
  await handleFolderTrustRequest(
    {
      emitter: new EventEmitter(),
      listenerCount: 0,
      shouldAutoTrust: () => false,
      respond: (_id, value) => {
        result = value;
      },
    },
    1,
    { sessionId: "s", cwd: "/repo", configKinds: ["mcp"] },
    "_x.ai/folder_trust/request",
  );
  assert.deepEqual(result, { outcome: "reject" });
});

test("handleFolderTrustRequest waits for UI trust", async () => {
  const emitter = new EventEmitter();
  let captured = null;
  let result = null;
  emitter.on("folder-trust-request", (payload) => {
    captured = payload;
    payload.respond({ outcome: "trust" });
  });
  await handleFolderTrustRequest(
    {
      emitter,
      listenerCount: 1,
      shouldAutoTrust: () => false,
      respond: (_id, value) => {
        result = value;
      },
    },
    9,
    { sessionId: "s", cwd: "/repo", configKinds: ["hooks"] },
    "_x.ai/folder_trust/request",
  );
  assert.equal(captured?.params?.cwd, "/repo");
  assert.deepEqual(captured?.params?.configKinds, ["hooks"]);
  assert.deepEqual(result, { outcome: "trust" });
});

test("handleFolderTrustRequest UI reject stays fail-closed", async () => {
  const emitter = new EventEmitter();
  let result = null;
  emitter.on("folder-trust-request", (payload) => {
    payload.respond({ outcome: "reject" });
  });
  await handleFolderTrustRequest(
    {
      emitter,
      listenerCount: 1,
      shouldAutoTrust: () => false,
      respond: (_id, value) => {
        result = value;
      },
    },
    10,
    { sessionId: "s", cwd: "/repo" },
    "_x.ai/folder_trust/request",
  );
  assert.deepEqual(result, { outcome: "reject" });
});

test("plan request_changes maps to cancelled + feedback", async () => {
  const emitter = new EventEmitter();
  let result = null;
  emitter.on("plan-approval-request", (payload) => {
    payload.respond({
      type: "request_changes",
      feedback: "Please add error handling",
    });
  });
  await handleExitPlanMode(
    {
      emitter,
      sessionDir: () => null,
      respond: (_id, value) => {
        result = value;
      },
    },
    3,
    { planContent: "# Plan" },
  );
  assert.deepEqual(result, {
    outcome: "cancelled",
    feedback: "Please add error handling",
  });
  assert.equal(result.type, undefined);
});

test("plan request_changes omits empty feedback", async () => {
  const emitter = new EventEmitter();
  let result = null;
  emitter.on("plan-approval-request", (payload) => {
    payload.respond({ type: "request_changes", feedback: "   " });
  });
  await handleExitPlanMode(
    {
      emitter,
      sessionDir: () => null,
      respond: (_id, value) => {
        result = value;
      },
    },
    4,
    { planContent: "# Plan" },
  );
  assert.deepEqual(result, { outcome: "cancelled" });
});

test("plan approved / abandoned stay distinct outcomes", async () => {
  const emitter = new EventEmitter();
  const results = [];
  emitter.on("plan-approval-request", (payload) => {
    payload.respond({ type: results.length ? "abandoned" : "approved" });
  });
  const ctx = {
    emitter,
    sessionDir: () => null,
    respond: (_id, value) => results.push(value),
  };
  await handleExitPlanMode(ctx, 5, { planContent: "a" });
  await handleExitPlanMode(ctx, 6, { planContent: "b" });
  assert.deepEqual(results, [{ outcome: "approved" }, { outcome: "abandoned" }]);
});

test("isMcpElicitMethod matches stdio underscore name", () => {
  assert.equal(isMcpElicitMethod("_x.ai/mcp/elicit"), true);
  assert.equal(isMcpElicitMethod("x.ai/mcp/elicit"), true);
  assert.equal(isMcpElicitCompleteMethod("_x.ai/mcp/elicit_complete"), true);
  assert.equal(isMcpElicitMethod("_x.ai/mcp/list"), false);
});

test("parseMcpElicitRequest accepts camelCase form and url", () => {
  const form = parseMcpElicitRequest({
    sessionId: "s1",
    toolCallId: "t1",
    serverName: "github",
    message: "Need email",
    mode: "form",
    requestedSchema: { type: "object", properties: {} },
  });
  assert.equal(form.mode, "form");
  assert.equal(form.serverName, "github");
  assert.equal(form.requestedSchema.type, "object");

  const url = parseMcpElicitRequest({
    session_id: "s2",
    tool_call_id: "t2",
    server_name: "oauth",
    message: "Login",
    mode: "url",
    url: "https://example.com/auth",
    elicitation_id: "el-1",
  });
  assert.equal(url.mode, "url");
  assert.equal(url.url, "https://example.com/auth");
  assert.equal(url.elicitationId, "el-1");

  const formWithUrl = parseMcpElicitRequest({
    mode: "form",
    url: "https://example.com/docs",
    requestedSchema: { type: "object" },
  });
  assert.equal(formWithUrl.mode, "form");
  assert.equal(formWithUrl.requestedSchema.type, "object");
});

test("mcpElicitResponse matches grok-build tagged outcome", () => {
  assert.deepEqual(mcpElicitResponse("accept", { email: "a@b.com" }), {
    outcome: "accept",
    content: { email: "a@b.com" },
  });
  assert.deepEqual(mcpElicitResponse("decline"), { outcome: "decline" });
  assert.deepEqual(mcpElicitResponse("cancel"), { outcome: "cancel" });
  assert.deepEqual(mcpElicitResponse(null), { outcome: "cancel" });
});

test("handleMcpElicit cancels when no UI listener", async () => {
  let result = null;
  await handleMcpElicit(
    {
      emitter: new EventEmitter(),
      listenerCount: 0,
      respond: (_id, value) => {
        result = value;
      },
    },
    1,
    {
      sessionId: "s",
      toolCallId: "t",
      serverName: "github",
      message: "Need email",
      mode: "form",
    },
    "_x.ai/mcp/elicit",
  );
  assert.deepEqual(result, { outcome: "cancel" });
});

test("handleMcpElicit waits for UI accept with content", async () => {
  const emitter = new EventEmitter();
  let captured = null;
  let result = null;
  emitter.on("mcp-elicit-request", (payload) => {
    captured = payload;
    payload.respond({ outcome: "accept", content: { email: "a@b.com" } });
  });
  await handleMcpElicit(
    {
      emitter,
      listenerCount: 1,
      respond: (_id, value) => {
        result = value;
      },
    },
    2,
    {
      sessionId: "s",
      toolCallId: "t",
      serverName: "github",
      message: "Need email",
      mode: "form",
      requestedSchema: {
        type: "object",
        properties: { email: { type: "string" } },
      },
    },
    "_x.ai/mcp/elicit",
  );
  assert.equal(captured?.params?.serverName, "github");
  assert.deepEqual(result, {
    outcome: "accept",
    content: { email: "a@b.com" },
  });
});

test("handleMcpElicit maps decline and cancel", async () => {
  const emitter = new EventEmitter();
  const results = [];
  emitter.on("mcp-elicit-request", (payload) => {
    payload.respond({
      outcome: results.length ? "cancel" : "decline",
    });
  });
  const ctx = {
    emitter,
    listenerCount: 1,
    respond: (_id, value) => results.push(value),
  };
  await handleMcpElicit(
    ctx,
    3,
    { sessionId: "s", mode: "form", message: "x" },
    "_x.ai/mcp/elicit",
  );
  await handleMcpElicit(
    ctx,
    4,
    { sessionId: "s", mode: "form", message: "x" },
    "_x.ai/mcp/elicit",
  );
  assert.deepEqual(results, [{ outcome: "decline" }, { outcome: "cancel" }]);
});

test("handleMcpElicit URL accept has no content", async () => {
  const emitter = new EventEmitter();
  let result = null;
  emitter.on("mcp-elicit-request", (payload) => {
    assert.equal(payload.params.mode, "url");
    assert.equal(payload.params.url, "https://example.com/auth");
    payload.respond({ outcome: "accept" });
  });
  await handleMcpElicit(
    {
      emitter,
      listenerCount: 1,
      respond: (_id, value) => {
        result = value;
      },
    },
    5,
    {
      sessionId: "s",
      mode: "url",
      url: "https://example.com/auth",
      message: "Login",
    },
    "_x.ai/mcp/elicit",
  );
  assert.deepEqual(result, { outcome: "accept" });
});

