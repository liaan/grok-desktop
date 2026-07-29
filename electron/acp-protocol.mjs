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
import {
  cancelledPermissionResult,
  pickAllowOptionId,
  selectedPermissionResult,
} from "../shared/permission-options.mjs";

/**
 * @param {{
 *   write: (msg: object) => void,
 *   permissionMode?: string,
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
      const toolName = String(
        params?.toolCall?.title ||
          params?.toolCall?._meta?.["x.ai/tool"]?.name ||
          params?.toolCall?._meta?.["x.ai/tool"]?.kind ||
          "",
      );
      const allowId = pickAllowOptionId(params?.options, {
        allowAlwaysOk: opts.permissionMode === "always-approve",
      });

      if (/exit_plan/i.test(toolName)) {
        once.respond(
          id,
          selectedPermissionResult(
            pickAllowOptionId(params?.options, { allowAlwaysOk: false }),
          ),
        );
        return;
      }

      if (opts.permissionMode === "always-approve") {
        once.respond(id, selectedPermissionResult(allowId));
        return;
      }

      const listeners =
        typeof opts.listenerCount === "function"
          ? opts.listenerCount("permission-request")
          : 1;
      if (listeners === 0) {
        once.respond(id, cancelledPermissionResult());
        return;
      }

      const oneshot = createPermissionOneshot();
      openPermissions.set(id, oneshot);
      try {
        opts.onPermissionRequest?.({ params, oneshot, requestId: id });
        const decision = await oneshot.wait();
        once.respond(id, decision ?? cancelledPermissionResult());
      } finally {
        openPermissions.delete(id);
      }
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
      const content = await opts.readFile(path);
      once.respond(id, { content });
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
      await opts.writeFile(path, params?.content ?? "");
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
