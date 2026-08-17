/**
 * Testable ACP client request handlers (no Electron / no child process).
 * Used by GrokAcpClient and by unit tests with fixtures.
 */
import {
  createOnceResponder,
  createPermissionOneshot,
  dispatchInboundMessage,
  isFsReadMethod,
  isFsWriteMethod,
  isPermissionMethod,
  isTerminalMethod,
} from "../shared/acp-rpc.mjs";
import { cancelledPermissionResult } from "../shared/permission-options.mjs";
import {
  outcomeForAutoDecision,
  permissionAutoDecision,
} from "../shared/permission-risk.mjs";

/**
 * Auto-allow or park session/request_permission. Shared by the live client
 * and the test runtime so Auto / session-grant cannot drift.
 *
 * @param {{
 *   id: any,
 *   params: any,
 *   permissionMode?: string,
 *   allowWritesThisSession?: boolean | (() => boolean),
 *   listenerCount: number,
 *   gates: Map<any, ReturnType<typeof createPermissionOneshot>>,
 *   respond: (id: any, result: any, error?: any) => void,
 *   onPark?: (args: {
 *     params: any,
 *     oneshot: ReturnType<typeof createPermissionOneshot>,
 *     requestId: any,
 *   }) => void,
 *   onNoListener?: (toolName: string) => void,
 * }} ctx
 */
export async function handleAcpPermissionRequest(ctx) {
  const writesGranted =
    typeof ctx.allowWritesThisSession === "function"
      ? Boolean(ctx.allowWritesThisSession())
      : Boolean(ctx.allowWritesThisSession);
  const auto = permissionAutoDecision(ctx.params, {
    permissionMode: ctx.permissionMode,
    allowWritesThisSession: writesGranted,
  });
  if (auto.allow) {
    ctx.respond(ctx.id, outcomeForAutoDecision(ctx.params, auto));
    return;
  }

  const toolName = String(
    ctx.params?.toolCall?.title ||
      ctx.params?.toolCall?._meta?.["x.ai/tool"]?.name ||
      ctx.params?.toolCall?._meta?.["x.ai/tool"]?.kind ||
      "",
  );
  if (!ctx.listenerCount) {
    ctx.onNoListener?.(toolName);
    ctx.respond(ctx.id, cancelledPermissionResult());
    return;
  }

  const oneshot = createPermissionOneshot();
  ctx.gates.set(ctx.id, oneshot);
  try {
    ctx.onPark?.({
      params: ctx.params,
      oneshot,
      requestId: ctx.id,
    });
    const decision = await oneshot.wait();
    ctx.respond(ctx.id, decision ?? cancelledPermissionResult());
  } finally {
    ctx.gates.delete(ctx.id);
  }
}

/**
 * @param {{
 *   write: (msg: object) => void,
 *   permissionMode?: string,
 *   allowWritesThisSession?: boolean | (() => boolean),
 *   listenerCount?: (event: string) => number,
 *   onPermissionRequest?: (args: {
 *     params: any,
 *     oneshot: ReturnType<typeof createPermissionOneshot>,
 *   }) => void,
 *   readFile?: (path: string) => Promise<string>,
 *   writeFile?: (path: string, content: string) => Promise<void>,
 *   resolvePath?: (path: string) => string,
 *   handleTerminal?: (method: string, params: any) => Promise<any>,
 *   onSessionUpdate?: (params: any) => void,
 *   onClientResponse?: (id: any, result: any, error: any) => void,
 * }} opts
 */
export function createAcpClientRuntime(opts) {
  const once = createOnceResponder((msg) => opts.write(msg));
  /** @type {Map<string|number, ReturnType<typeof createPermissionOneshot>>} */
  const openPermissions = new Map();

  /**
   * Cancel all open permission oneshots (ACP cancel: MUST respond cancelled).
   * Only settle here; the parked handler awaits wait() and issues the single
   * JSON-RPC response (once-responder rejects doubles).
   */
  function cancelOpenPermissions() {
    const cancelled = cancelledPermissionResult();
    for (const [, gate] of openPermissions) {
      gate.settle(cancelled);
    }
  }

  async function handleServerRequest(req) {
    const { method, id, params } = req;
    // beginRequest is done by dispatchInboundMessage before spawn.

    if (isPermissionMethod(method)) {
      await handleAcpPermissionRequest({
        id,
        params,
        permissionMode: opts.permissionMode,
        allowWritesThisSession: opts.allowWritesThisSession,
        listenerCount:
          typeof opts.listenerCount === "function"
            ? opts.listenerCount("permission-request")
            : 1,
        gates: openPermissions,
        respond: (rid, result, error) => once.respond(rid, result, error),
        onPark: opts.onPermissionRequest,
      });
      return;
    }

    if (isFsReadMethod(method)) {
      const path = opts.resolvePath
        ? opts.resolvePath(params?.path)
        : params?.path;
      if (!opts.readFile) {
        once.respond(id, null, {
          code: -32000,
          message: "fs read not configured",
        });
        return;
      }
      try {
        const content = await opts.readFile(path);
        once.respond(id, { content });
      } catch (err) {
        // Missing file: empty content (Grok write probes path via read first)
        if (err?.code === "ENOENT") {
          once.respond(id, { content: "" });
          return;
        }
        once.respond(id, null, {
          code: err?.code, // buildJsonRpcError coerces non-integers
          message: err?.message || String(err),
        });
      }
      return;
    }

    if (isFsWriteMethod(method)) {
      const path = opts.resolvePath
        ? opts.resolvePath(params?.path)
        : params?.path;
      if (!opts.writeFile) {
        once.respond(id, null, {
          code: -32000,
          message: "fs write not configured",
        });
        return;
      }
      const body =
        params?.content != null
          ? String(params.content)
          : params?.text != null
            ? String(params.text)
            : "";
      await opts.writeFile(path, body);
      once.respond(id, {});
      return;
    }

    if (isTerminalMethod(method)) {
      if (!opts.handleTerminal) {
        once.respond(id, null, {
          code: -32601,
          message: `Unhandled terminal method: ${method}`,
        });
        return;
      }
      const result = await opts.handleTerminal(method, params || {});
      once.respond(id, result ?? {});
      return;
    }

    once.respond(id, null, {
      code: -32601,
      message: `Unhandled client method: ${method}`,
    });
  }

  return {
    once,
    openPermissions,
    cancelOpenPermissions,
    /**
     * Feed one JSON-RPC object from agent stdout.
     * @param {any} msg
     */
    handleMessage(msg) {
      return dispatchInboundMessage(msg, {
        once,
        onSessionUpdate: opts.onSessionUpdate,
        onClientResponse: opts.onClientResponse,
        handleServerRequest,
      });
    },
  };
}
