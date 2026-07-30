/**
 * Main-owned tool permission gates (session/request_permission).
 * Renderer mirrors this store; it does not invent open requests.
 */

/**
 * @typedef {{ optionId?: string, name?: string, kind?: string }} PermOption
 * @typedef {{
 *   settle: (outcome: any) => void,
 *   request: { reqId: string, params: any },
 *   ownerId: string | null,
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
 * @param {string | null | undefined} [ownerId] When set, only that window's gates
 * @returns {Array<{ reqId: string, params: any }>}
 */
export function listPendingPermissionRequests(ownerId) {
  return [...pending.entries()]
    .filter(([, entry]) =>
      ownerId == null || ownerId === ""
        ? true
        : entry.ownerId === ownerId,
    )
    .map(([reqId, entry]) => ({
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
 *   ownerId?: string | null,
 * }} opts
 * @returns {{ reqId: string, params: any }} UI payload (slim)
 */
export function registerPermissionRequest(opts) {
  const { reqId, params, respond, onSettled, ownerId = null } = opts;
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
  pending.set(reqId, {
    settle,
    request,
    ownerId: ownerId == null ? null : String(ownerId),
  });
  return request;
}

/**
 * @param {string} reqId
 * @param {any} outcome
 * @param {string | null | undefined} [ownerId] When set, reject cross-window settle
 * @returns {boolean}
 */
export function settlePermission(reqId, outcome, ownerId) {
  const entry = pending.get(reqId);
  if (!entry) return false;
  if (ownerId != null && ownerId !== "") {
    if (entry.ownerId !== String(ownerId)) return false;
  }
  entry.settle(outcome);
  return true;
}

/**
 * Cancel every open tool permission (Stop/cancel, dispose, project switch).
 * ACP requires pending session/request_permission to resolve with cancelled.
 * Each settle is single-shot (registerPermissionRequest guards double settle).
 * @param {(outcome: any) => any} [cancelOutcome]
 * @param {string | null | undefined} [ownerId] When set, only cancel that window
 */
export function cancelAllPermissions(cancelOutcome, ownerId) {
  const makeOutcome =
    typeof cancelOutcome === "function"
      ? cancelOutcome
      : () => ({ outcome: { outcome: "cancelled" } });
  const scope =
    ownerId == null || ownerId === "" ? null : String(ownerId);
  const entries = [...pending.entries()].filter(([, entry]) =>
    scope == null ? true : entry.ownerId === scope,
  );
  for (const [reqId] of entries) {
    pending.delete(reqId);
  }
  for (const [, entry] of entries) {
    try {
      entry.settle(makeOutcome());
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string | null | undefined} [ownerId]
 */
export function pendingPermissionCount(ownerId) {
  if (ownerId == null || ownerId === "") return pending.size;
  const scope = String(ownerId);
  let n = 0;
  for (const entry of pending.values()) {
    if (entry.ownerId === scope) n++;
  }
  return n;
}
