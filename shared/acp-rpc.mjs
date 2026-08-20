/**
 * Pure ACP / JSON-RPC 2.0 helpers for the Desktop client.
 * Mirrors grok-build xai-acp-lib: one request id → one response (oneshot);
 * session/update is progress-only and must not gate tool completion.
 *
 * Spec: https://agentclientprotocol.com/protocol/overview
 * Prompt turn: https://agentclientprotocol.com/protocol/prompt-turn
 */

/**
 * @typedef {'invalid' | 'session-update' | 'server-request' | 'notification' | 'client-response'} InboundKind
 * @typedef {{
 *   kind: InboundKind,
 *   method?: string,
 *   id?: string | number,
 *   params?: any,
 *   result?: any,
 *   error?: any,
 *   expectsEmptyAck?: boolean,
 * }} ClassifiedMessage
 */

/**
 * Progress methods: ACP session/update and grok-build session_notification
 * (AutoCompactCompleted and other XaiSessionUpdate events).
 * @param {unknown} method
 */
export function isSessionUpdateMethod(method) {
  const m = String(method || "");
  return (
    m === "session/update" ||
    m === "_x.ai/session/update" ||
    m === "x.ai/session/update" ||
    m.endsWith("/session/update") ||
    m === "x.ai/session_notification" ||
    m === "_x.ai/session_notification" ||
    m.endsWith("/session_notification")
  );
}

/**
 * Peel `ext_notification` / nested `{ method, params }` so compact and other
 * XaiSessionUpdate events look like a normal session/update to the UI.
 * @param {any} msg
 * @returns {{ method: string, params: any }}
 */
export function unwrapInboundSessionEnvelope(msg) {
  let method = String(msg?.method || "");
  let params = msg?.params;

  const peel = () => {
    if (!params || typeof params !== "object") return false;
    if (params.method == null || params.params === undefined) return false;
    const inner = String(params.method);
    if (
      inner === "ext_notification" ||
      inner.endsWith("/ext_notification") ||
      isSessionUpdateMethod(inner)
    ) {
      method = inner;
      params = params.params;
      return true;
    }
    return false;
  };

  if (
    method === "ext_notification" ||
    method === "_ext_notification" ||
    method.endsWith("/ext_notification")
  ) {
    peel();
  }
  if (isSessionUpdateMethod(method)) {
    peel();
  }

  return { method, params };
}

/**
 * grok-build CompactConversationRequest (session/acp_types.rs).
 * Optional `/compact` note is `userContext`.
 * @param {string} sessionId
 * @param {string} [hint]
 */
export function compactConversationRequestParams(sessionId, hint = "") {
  const context = String(hint || "").trim();
  return {
    sessionId,
    ...(context ? { userContext: context } : {}),
  };
}

/**
 * Wire method for `grok agent stdio`.
 *
 * Official ACP (`AgentSide::decode_request`) only routes names that start
 * with `_` into `ext_method`. The pager's private channel uses
 * `ext_method` + `x.ai/compact_conversation`; on stdio that is
 * `_x.ai/compact_conversation` and the JSON-RPC params *are* the
 * CompactConversationRequest (ExtRequest is serde-transparent).
 * @param {string} sessionId
 * @param {string} [hint]
 * @returns {{ method: string, params: object }[]}
 */
export function compactConversationAttempts(sessionId, hint = "") {
  const params = compactConversationRequestParams(sessionId, hint);
  return [{ method: "_x.ai/compact_conversation", params }];
}

/**
 * grok-build `McpAuthTriggerRequest` (extensions/mcp.rs). The struct has no
 * serde rename, so the wire fields are snake_case. Also send camelCase so
 * a future rename_all does not break Desktop.
 * @param {string} sessionId
 * @param {string} serverName
 */
export function mcpAuthTriggerRequestParams(sessionId, serverName) {
  const sid = String(sessionId || "").trim();
  const name = String(serverName || "").trim();
  return {
    sessionId: sid,
    session_id: sid,
    serverName: name,
    server_name: name,
  };
}

/**
 * Wire method for `grok agent stdio` MCP OAuth (TUI `/mcps` + `i`).
 * @param {string} sessionId
 * @param {string} serverName
 * @returns {{ method: string, params: object }[]}
 */
export function mcpAuthTriggerAttempts(sessionId, serverName) {
  return [
    {
      method: "_x.ai/mcp/auth_trigger",
      params: mcpAuthTriggerRequestParams(sessionId, serverName),
    },
  ];
}

/**
 * grok-build `McpListRequest` (camelCase). Send both casings.
 * @param {string} sessionId
 * @param {{ cache?: boolean }} [opts]
 */
export function mcpSessionListRequestParams(sessionId, opts = {}) {
  const sid = String(sessionId || "").trim();
  const cache = opts.cache !== false;
  return {
    sessionId: sid,
    session_id: sid,
    cache,
  };
}

/**
 * @param {string} sessionId
 * @param {{ cache?: boolean }} [opts]
 * @returns {{ method: string, params: object }[]}
 */
export function mcpSessionListAttempts(sessionId, opts = {}) {
  const params = mcpSessionListRequestParams(sessionId, opts);
  return [
    { method: "_x.ai/mcp/list", params },
    { method: "x.ai/mcp/list", params },
  ];
}

/**
 * grok-build `SessionRenameRequest` (camelCase). Send both casings.
 * Kind defaults to build (coding sessions); chat conversations are separate.
 * @param {{ sessionId: string, title: string, cwd: string, resetToAuto?: boolean }} opts
 */
export function sessionRenameRequestParams(opts) {
  const sid = String(opts?.sessionId || "").trim();
  const title = String(opts?.title || "");
  const cwd = String(opts?.cwd || "");
  const resetToAuto = Boolean(opts?.resetToAuto);
  return {
    sessionId: sid,
    session_id: sid,
    title,
    cwd,
    kind: "build",
    ...(resetToAuto ? { resetToAuto: true, reset_to_auto: true } : {}),
  };
}

/**
 * Wire method for `grok agent stdio` session rename (TUI `/rename`).
 * @param {{ sessionId: string, title: string, cwd: string, resetToAuto?: boolean }} opts
 * @returns {{ method: string, params: object }[]}
 */
export function sessionRenameAttempts(opts) {
  const params = sessionRenameRequestParams(opts);
  return [
    { method: "_x.ai/session/rename", params },
    { method: "x.ai/session/rename", params },
  ];
}

/**
 * grok-build `DeleteRequest` (camelCase). Send both casings.
 * @param {{ sessionId: string, cwd: string }} opts
 */
export function sessionDeleteRequestParams(opts) {
  const sid = String(opts?.sessionId || "").trim();
  const cwd = String(opts?.cwd || "");
  return {
    sessionId: sid,
    session_id: sid,
    cwd,
    kind: "build",
  };
}

/**
 * Wire method for `grok agent stdio` session delete (CLI `grok sessions delete`).
 * @param {{ sessionId: string, cwd: string }} opts
 * @returns {{ method: string, params: object }[]}
 */
export function sessionDeleteAttempts(opts) {
  const params = sessionDeleteRequestParams(opts);
  return [
    { method: "_x.ai/session/delete", params },
    { method: "x.ai/session/delete", params },
  ];
}

const MCP_LIVE_METHODS = new Set([
  "x.ai/mcp/server_status",
  "x.ai/mcp/init_progress",
  "x.ai/mcp/tools_changed",
  "x.ai/mcp/servers_updated",
  "x.ai/mcp_initialized",
]);

/**
 * @param {unknown} method
 */
export function isMcpLiveEventMethod(method) {
  const m = String(method || "").replace(/^_/, "");
  return MCP_LIVE_METHODS.has(m);
}

/**
 * Peel `ext_notification` wrappers around `x.ai/mcp/*` live events.
 * @param {unknown} method
 * @param {any} params
 * @returns {{ method: string, params: any } | null}
 */
export function unwrapMcpExtNotification(method, params) {
  let m = String(method || "");
  let p = params;
  for (let i = 0; i < 4; i += 1) {
    const bare = m.replace(/^_/, "");
    if (bare.startsWith("x.ai/mcp/") || bare === "x.ai/mcp_initialized") {
      return { method: bare, params: p };
    }
    if (!p || typeof p !== "object" || p.method == null) break;
    const inner = String(p.method);
    if (
      inner === "ext_notification" ||
      inner.endsWith("/ext_notification") ||
      inner.replace(/^_/, "").startsWith("x.ai/mcp")
    ) {
      m = inner;
      p = p.params !== undefined ? p.params : p;
      continue;
    }
    break;
  }
  return null;
}

/**
 * Classify an inbound JSON-RPC message from the agent (stdout).
 * @param {any} msg
 * @returns {ClassifiedMessage}
 */
export function classifyInboundMessage(msg) {
  if (!msg || typeof msg !== "object") {
    return { kind: "invalid" };
  }

  // Client→agent response (result/error for a request we sent)
  if (
    msg.id !== undefined &&
    msg.method === undefined &&
    (msg.result !== undefined || msg.error !== undefined)
  ) {
    return {
      kind: "client-response",
      id: msg.id,
      result: msg.result,
      error: msg.error,
    };
  }

  if (!msg.method) {
    return { kind: "invalid" };
  }

  const { method, params } = unwrapInboundSessionEnvelope(msg);

  // Progress notifications (and Grok variants that attach id + expect empty ack)
  if (isSessionUpdateMethod(method) && params != null && !msg.result && !msg.error) {
    return {
      kind: "session-update",
      method,
      id: msg.id,
      params,
      expectsEmptyAck: msg.id !== undefined,
    };
  }

  // Agent→client request that expects a result with the same id
  if (msg.id !== undefined && !msg.result && !msg.error) {
    return {
      kind: "server-request",
      method,
      id: msg.id,
      params: msg.params,
    };
  }

  // Method without id → pure notification
  if (msg.id === undefined) {
    return { kind: "notification", method, params: msg.params };
  }

  return { kind: "invalid", method, id: msg.id };
}

export function isPermissionMethod(method) {
  const m = String(method || "");
  return (
    m === "session/request_permission" ||
    m === "request_permission" ||
    m.endsWith("/request_permission")
  );
}

export function isFsReadMethod(method) {
  const m = String(method || "");
  return (
    m === "fs/read_text_file" ||
    m === "fs/readTextFile" ||
    m === "fs/read"
  );
}

export function isFsWriteMethod(method) {
  const m = String(method || "");
  return (
    m === "fs/write_text_file" ||
    m === "fs/writeTextFile" ||
    m === "fs/write"
  );
}

export function isTerminalMethod(method) {
  return String(method || "").startsWith("terminal/");
}

/**
 * JSON-RPC 2.0 error codes must be integers. Node fs/spawn use string codes
 * (ENOENT, EACCES); never pass those through on the wire — agents can hang.
 * @param {unknown} code
 * @param {number} [fallback=-32000]
 * @returns {number}
 */
export function jsonRpcErrorCode(code, fallback = -32000) {
  if (typeof code === "number" && Number.isFinite(code)) return code;
  return fallback;
}

/**
 * Build a JSON-RPC success response (same id as the request).
 * @param {string|number} id
 * @param {any} [result]
 */
export function buildJsonRpcResult(id, result = {}) {
  return { jsonrpc: "2.0", id, result: result ?? {} };
}

/**
 * Build a JSON-RPC error response.
 * @param {string|number} id
 * @param {{ code?: number, message?: string }} error
 */
export function buildJsonRpcError(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: jsonRpcErrorCode(error?.code),
      message: error?.message || String(error || "ACP error"),
    },
  };
}

/**
 * Ensure each *in-flight* request id is answered at most once (handler + catch
 * must not double-write). JSON-RPC allows the agent to reuse numeric ids after
 * a prior request completes — so we must NOT lifetime-block ids.
 *
 * Lifecycle per id:
 *   beginRequest(id)  → open a response slot (clears any prior mark for that id)
 *   respond(id, …)    → first successful write wins; write failure does not burn
 *   clear()           → dispose / session teardown
 *
 * @param {(msg: object) => void} write - send JSON-RPC line to agent stdin
 */
export function createOnceResponder(write) {
  /** ids that already received a successful response for the current lifecycle */
  /** @type {Set<string>} */
  const answered = new Set();
  /** ids opened via beginRequest (optional; respond still works without it) */
  /** @type {Set<string>} */
  const open = new Set();

  return {
    /**
     * Start a new request lifecycle for `id` so a prior completed response
     * does not block a later agent request that reuses the same id.
     * @param {string|number} id
     */
    beginRequest(id) {
      if (id === undefined || id === null) return;
      const key = String(id);
      answered.delete(key);
      open.add(key);
    },

    /**
     * @param {string|number} id
     * @param {any} [result]
     * @param {{ code?: number, message?: string } | null} [error]
     * @returns {boolean} true if this call wrote the response
     */
    respond(id, result, error = null) {
      if (id === undefined || id === null) return false;
      const key = String(id);
      if (answered.has(key)) return false;
      const msg = error
        ? buildJsonRpcError(id, error)
        : buildJsonRpcResult(id, result);
      try {
        write(msg);
      } catch (err) {
        // Do not burn the id when stdin write fails — caller may retry.
        throw err;
      }
      answered.add(key);
      open.delete(key);
      return true;
    },

    hasResponded(id) {
      if (id === undefined || id === null) return false;
      return answered.has(String(id));
    },

    clear() {
      answered.clear();
      open.clear();
    },

    size() {
      return answered.size;
    },
  };
}

/**
 * Park until UI settles a permission request (oneshot). Exactly one settle wins.
 * @returns {{
 *   wait: () => Promise<any>,
 *   settle: (outcome: any) => boolean,
 *   isSettled: () => boolean,
 * }}
 */
export function createPermissionOneshot() {
  let settled = false;
  /** @type {((outcome: any) => void) | null} */
  let resolveWait = null;
  /** @type {any} */
  let buffered = undefined;
  let hasBuffered = false;

  return {
    wait() {
      if (settled && hasBuffered) {
        return Promise.resolve(buffered);
      }
      return new Promise((resolve) => {
        if (settled && hasBuffered) {
          resolve(buffered);
          return;
        }
        resolveWait = resolve;
      });
    },
    settle(outcome) {
      if (settled) return false;
      settled = true;
      buffered = outcome;
      hasBuffered = true;
      if (resolveWait) {
        resolveWait(outcome);
        resolveWait = null;
      }
      return true;
    },
    isSettled() {
      return settled;
    },
  };
}

/**
 * Dispatch one inbound message through a client handler table.
 * Server requests are started without awaiting each other (concurrent),
 * matching grok-build gateway spawn semantics.
 *
 * @param {any} msg
 * @param {{
 *   once: ReturnType<typeof createOnceResponder>,
 *   onSessionUpdate?: (params: any) => void,
 *   onNotification?: (method: string, params: any) => void,
 *   onClientResponse?: (id: any, result: any, error: any) => void,
 *   handleServerRequest: (req: { method: string, id: any, params: any }) => Promise<void>,
 * }} handlers
 */
export function dispatchInboundMessage(msg, handlers) {
  const c = classifyInboundMessage(msg);

  if (c.kind === "session-update") {
    handlers.onSessionUpdate?.(c.params);
    if (c.expectsEmptyAck) {
      handlers.once.beginRequest?.(c.id);
      handlers.once.respond(c.id, {});
    }
    return c;
  }

  if (c.kind === "notification") {
    handlers.onNotification?.(c.method, c.params);
    return c;
  }

  if (c.kind === "client-response") {
    handlers.onClientResponse?.(c.id, c.result, c.error);
    return c;
  }

  if (c.kind === "server-request") {
    // Open a fresh response slot for this id (allows JSON-RPC id reuse).
    handlers.once.beginRequest?.(c.id);
    // Concurrent: do not await — independent RPCs must not head-of-line block.
    Promise.resolve()
      .then(() =>
        handlers.handleServerRequest({
          method: c.method,
          id: c.id,
          params: c.params,
        }),
      )
      .catch((err) => {
        handlers.once.respond(c.id, null, {
          code: jsonRpcErrorCode(err?.code),
          message: err?.message || String(err),
        });
      });
    return c;
  }

  return c;
}
