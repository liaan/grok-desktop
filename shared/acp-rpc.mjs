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

  const method = String(msg.method);
  const isSessionUpdate =
    method === "session/update" ||
    method === "_x.ai/session/update" ||
    method === "x.ai/session/update" ||
    method.endsWith("/session/update");

  // Progress notifications (and Grok variants that attach id + expect empty ack)
  if (isSessionUpdate && msg.params != null && !msg.result && !msg.error) {
    return {
      kind: "session-update",
      method,
      id: msg.id,
      params: msg.params,
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
      code: error?.code ?? -32000,
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
          code: err?.code ?? -32000,
          message: err?.message || String(err),
        });
      });
    return c;
  }

  return c;
}
