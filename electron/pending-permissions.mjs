/**
 * Main-owned tool permission gates (session/request_permission).
 * Renderer mirrors this store; it does not invent open requests.
 */

import {
  isEnableAlwaysApproveOption,
  pickAllowOptionId,
  selectedPermissionResult,
} from "../shared/permission-options.mjs";
import {
  outcomeForAutoDecision,
  permissionAutoDecision,
} from "../shared/permission-risk.mjs";

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

/** @type {(() => void) | null} */
let onEnableAlwaysApprove = null;

/**
 * Invoked from settlePermission after the current tool is allowed once
 * with `enable-always-approve`. Main persists desktop-state + yolo.
 * @param {(() => void) | null | undefined} fn
 */
export function setOnEnableAlwaysApprove(fn) {
  onEnableAlwaysApprove = typeof fn === "function" ? fn : null;
}

/**
 * @param {any} outcome
 */
function selectedOptionIdFromOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return "";
  if (outcome.optionId != null && outcome.optionId !== "") {
    return String(outcome.optionId);
  }
  const inner = outcome.outcome;
  if (inner && typeof inner === "object" && inner.optionId != null) {
    return String(inner.optionId);
  }
  return "";
}

/**
 * Strip huge rawInput so IPC + React stay light. Keep risk fields so
 * Ask→Auto flush can reclassify without the original agent payload.
 * @param {any} params
 */
export function slimPermissionParams(params) {
  if (!params || typeof params !== "object") return {};
  const tool = params.toolCall || params.tool_call || {};
  const raw = tool.rawInput ?? tool.raw_input;
  const xai = tool._meta?.["x.ai/tool"] || tool._meta?.tool || {};
  const metaName = xai.name || xai.tool || tool._meta?.name;
  const metaKind = xai.kind || tool._meta?.kind;
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
  const keepCmd =
    raw && typeof raw === "object"
      ? {
          command: raw.command,
          cmd: raw.cmd,
          name: raw.name,
        }
      : {};
  if (rawSlim && typeof rawSlim === "object" && rawSlim._truncated) {
    rawSlim = { ...rawSlim, ...keepCmd };
  } else if (
    rawSlim == null &&
    (keepCmd.command != null || keepCmd.cmd != null || keepCmd.name != null)
  ) {
    rawSlim = keepCmd;
  }
  const slimMeta =
    metaName || metaKind
      ? { "x.ai/tool": { name: metaName, kind: metaKind } }
      : undefined;
  return {
    sessionId: params.sessionId || params.session_id,
    options: Array.isArray(params.options) ? params.options : [],
    toolCall: {
      toolCallId: tool.toolCallId || tool.tool_call_id || tool.id,
      title: tool.title,
      kind: tool.kind || metaKind,
      status: tool.status,
      rawInput: rawSlim,
      _meta: slimMeta,
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
  if (isEnableAlwaysApproveOption(selectedOptionIdFromOutcome(outcome))) {
    try {
      onEnableAlwaysApprove?.();
    } catch {
      /* ignore */
    }
  }
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

/**
 * Settle open gates matching pred. pickOutcome returns the ACP result, or
 * null/undefined to skip.
 *
 * @param {string | null | undefined} ownerId
 * @param {(p: { reqId: string, params: any }) => boolean} pred
 * @param {(p: { reqId: string, params: any }) => any} pickOutcome
 * @returns {number}
 */
export function settlePendingIf(ownerId, pred, pickOutcome) {
  const open = listPendingPermissionRequests(ownerId);
  let n = 0;
  for (const p of open) {
    if (typeof pred === "function" && !pred(p)) continue;
    const outcome = pickOutcome(p);
    if (outcome == null) continue;
    if (settlePermission(p.reqId, outcome, ownerId)) n++;
  }
  return n;
}

/** Grant remaining prompts with allow-once (never agent allow-always). */
export function settlePendingAllowOnce(ownerId) {
  return settlePendingIf(
    ownerId,
    () => true,
    (p) =>
      selectedPermissionResult(
        pickAllowOptionId(p.params?.options, { allowAlwaysOk: false }),
      ),
  );
}

/**
 * Ask→Auto / always-approve flush via shared policy.
 * @param {string | null | undefined} ownerId
 * @param {{ permissionMode?: string, allowWritesThisSession?: boolean }} ctx
 */
export function settlePendingByPolicy(ownerId, ctx) {
  return settlePendingIf(
    ownerId,
    (p) => permissionAutoDecision(p.params, ctx).allow,
    (p) =>
      outcomeForAutoDecision(p.params, permissionAutoDecision(p.params, ctx)),
  );
}
