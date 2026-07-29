/**
 * Main-owned tool permission gates (session/request_permission).
 * Renderer mirrors this store; it does not invent open requests.
 */

/**
 * @typedef {{ optionId?: string, name?: string, kind?: string }} PermOption
 * @typedef {{
 *   settle: (outcome: any) => void,
 *   request: { reqId: string, params: any },
 * }} PendingPermissionEntry
 */

/** @type {Map<string, PendingPermissionEntry>} */
const pending = new Map();

/**
 * Strip huge rawInput so IPC + React stay light. Approvals only need
 * title, kind, toolCallId, options, and a short preview.
 * @param {any} params
 */
export function slimPermissionParams(params) {
  if (!params || typeof params !== "object") return {};
  const tool = params.toolCall || params.tool_call || {};
  const raw = tool.rawInput ?? tool.raw_input;
  let rawSlim = undefined;
  if (raw != null) {
    try {
      const s =
        typeof raw === "string" ? raw : JSON.stringify(raw, null, 0);
      rawSlim =
        s.length > 1200
          ? { _truncated: `${s.slice(0, 1200)}… (${s.length} chars)` }
          : typeof raw === "string"
            ? raw
            : raw;
    } catch {
      rawSlim = { _note: "(raw input not serializable)" };
    }
  }
  return {
    sessionId: params.sessionId || params.session_id,
    options: Array.isArray(params.options) ? params.options : [],
    toolCall: {
      toolCallId: tool.toolCallId || tool.tool_call_id || tool.id,
      title: tool.title,
      kind: tool.kind,
      status: tool.status,
      rawInput: rawSlim,
    },
  };
}

/**
 * @returns {Array<{ reqId: string, params: any }>}
 */
export function listPendingPermissionRequests() {
  return [...pending.entries()].map(([reqId, entry]) => ({
    reqId,
    params: entry.request?.params || {},
  }));
}

/**
 * Register an open gate. `respond` is the ACP callback; `onSettled` runs after
 * the first settle (dismiss UI, log, …).
 *
 * @param {{
 *   reqId: string,
 *   params: any,
 *   respond: (outcome: any) => void,
 *   onSettled?: (reqId: string, outcome: any) => void,
 * }} opts
 * @returns {{ reqId: string, params: any }} UI payload (slim)
 */
export function registerPermissionRequest(opts) {
  const { reqId, params, respond, onSettled } = opts;
  const slim = slimPermissionParams(params);
  let settled = false;
  const settle = (outcome) => {
    if (settled) return;
    settled = true;
    pending.delete(reqId);
    try {
      respond(outcome);
    } catch {
      /* ignore */
    }
    try {
      onSettled?.(reqId, outcome);
    } catch {
      /* ignore */
    }
  };
  const request = { reqId, params: slim };
  pending.set(reqId, { settle, request });
  return request;
}

/**
 * @param {string} reqId
 * @param {any} outcome
 * @returns {boolean}
 */
export function settlePermission(reqId, outcome) {
  const entry = pending.get(reqId);
  if (!entry) return false;
  entry.settle(outcome);
  return true;
}

/**
 * Cancel every open tool permission (Stop/cancel, dispose, project switch).
 * ACP requires pending session/request_permission to resolve with cancelled.
 * Each settle is single-shot (registerPermissionRequest guards double settle).
 * @param {(outcome: any) => any} [cancelOutcome]
 */
export function cancelAllPermissions(cancelOutcome) {
  const makeOutcome =
    typeof cancelOutcome === "function"
      ? cancelOutcome
      : () => ({ outcome: { outcome: "cancelled" } });
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) {
    try {
      entry.settle(makeOutcome());
    } catch {
      /* ignore */
    }
  }
}

export function pendingPermissionCount() {
  return pending.size;
}
