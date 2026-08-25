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
  parseFolderTrustRequest,
  unwrapFolderTrustParams,
} from "../shared/acp-rpc.mjs";
import { handleFolderTrustRequest } from "../electron/acp-ext-methods.mjs";

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

test("unwrapFolderTrustParams peels nested ext_method", () => {
  const inner = { sessionId: "s", cwd: "/p", configKinds: ["mcp"] };
  assert.equal(
    unwrapFolderTrustParams("_x.ai/folder_trust/request", inner),
    inner,
  );
  const nested = unwrapFolderTrustParams("ext_method", {
    method: "x.ai/folder_trust/request",
    params: inner,
  });
  assert.equal(nested, inner);
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
