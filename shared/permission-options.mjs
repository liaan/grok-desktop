/**
 * ACP session/request_permission option helpers.
 * Agents vary optionId strings (allow-once, allow_once, proceed, …).
 */

/**
 * @typedef {{ optionId?: string, name?: string, kind?: string }} PermOption
 * @typedef {'reject' | 'allow_once' | 'allow_always' | 'unknown'} OptionClass
 */

/**
 * @param {PermOption | null | undefined} opt
 * @returns {OptionClass}
 */
export function classifyPermissionOption(opt) {
  if (!opt) return "unknown";
  const id = String(opt.optionId || "").toLowerCase().replace(/_/g, "-");
  const name = String(opt.name || "").toLowerCase();
  const kind = String(opt.kind || "").toLowerCase().replace(/_/g, "-");
  const blob = `${id} ${name} ${kind}`;

  // Reject family first (before substring "allow" checks)
  if (
    kind === "reject" ||
    kind.startsWith("reject") ||
    /^(reject|deny|abort|cancel)$/.test(id) ||
    /\b(reject|deny|abort)\b/.test(name) ||
    // disallow / not-allowed are denials, not allows
    /^(disallow|not-allowed|no)$/.test(id) ||
    /\b(disallow|not allowed)\b/.test(name)
  ) {
    return "reject";
  }

  // Always / session-scoped allow (must not be used for batch "Allow all")
  if (
    kind === "allow-always" ||
    kind === "allowalways" ||
    /allow[-]?always|always[-]?allow|allow[-]?session|remember/.test(id) ||
    /always allow|allow for session|remember|always approve/.test(name) ||
    (kind.startsWith("allow") && /always|session|remember/.test(kind))
  ) {
    return "allow_always";
  }

  // Once / single allow
  if (
    kind === "allow-once" ||
    kind === "allowonce" ||
    kind === "allow" ||
    /allow[-]?once|allowonce|allow[-]?this|proceed|approve|continue|yes|accept/.test(
      id,
    ) ||
    /\b(allow once|allow this|proceed|approve|continue|yes|accept)\b/.test(
      name,
    ) ||
    (kind.startsWith("allow") && !/always|session|remember/.test(kind))
  ) {
    return "allow_once";
  }

  // Bare "allow" in id without always
  if (/^allow/.test(id) && !/always|session|remember/.test(id)) {
    return "allow_once";
  }

  return "unknown";
}

/**
 * @param {string | null | undefined} optionId
 * @param {PermOption[] | null | undefined} options
 * @returns {OptionClass}
 */
export function classifyOptionId(optionId, options) {
  if (
    optionId === "cancelled" ||
    optionId === "cancel" ||
    optionId == null ||
    optionId === ""
  ) {
    return "reject";
  }
  if (Array.isArray(options)) {
    const hit = options.find((o) => o?.optionId === optionId);
    if (hit) return classifyPermissionOption(hit);
  }
  // Synthetic id without catalog entry
  return classifyPermissionOption({ optionId, name: optionId, kind: "" });
}

/**
 * Pick an allow optionId for a single auto/once-style approval.
 * Prefers allow_once; only falls back to allow_always when preferOnce is false
 * (always-approve mode) or no once option exists and allowAlwaysOk is true.
 *
 * @param {PermOption[] | null | undefined} options
 * @param {{ allowAlwaysOk?: boolean }} [opts]
 * @returns {string}
 */
export function pickAllowOptionId(options, opts = {}) {
  const allowAlwaysOk = Boolean(opts.allowAlwaysOk);
  if (!Array.isArray(options) || options.length === 0) {
    return "allow-once";
  }

  const once = [];
  const always = [];
  const unknown = [];

  for (const opt of options) {
    const id = String(opt?.optionId || "");
    if (!id) continue;
    const cls = classifyPermissionOption(opt);
    if (cls === "allow_once") once.push(id);
    else if (cls === "allow_always") always.push(id);
    else if (cls === "unknown") unknown.push({ opt, id });
    // reject skipped
  }

  if (once.length) return once[0];

  // Fuzzy unknown: kind empty but name looks like proceed / allow once
  for (const { opt, id } of unknown) {
    const name = String(opt?.name || "").toLowerCase();
    if (/\b(proceed|allow once|allow this|approve|continue|yes)\b/.test(name)) {
      return id;
    }
  }

  if (allowAlwaysOk && always.length) return always[0];

  // Last resort: first non-reject listed id (may still be wrong catalog)
  for (const opt of options) {
    const id = String(opt?.optionId || "");
    if (id && classifyPermissionOption(opt) !== "reject") {
      // Prefer not always when batch-like safety is default
      if (!allowAlwaysOk && classifyPermissionOption(opt) === "allow_always") {
        continue;
      }
      return id;
    }
  }

  return "allow-once";
}

/**
 * Batch "Allow all" — once-only optionId, or null if the catalog has no
 * once option (caller must not escalate to allow-always).
 * Empty catalog → "allow-once" (ACP default).
 *
 * @param {PermOption[] | null | undefined} options
 * @returns {string | null}
 */
export function pickAllowOnceOptionId(options) {
  if (!Array.isArray(options) || options.length === 0) {
    return "allow-once";
  }
  for (const opt of options) {
    const id = String(opt?.optionId || "");
    if (!id) continue;
    if (classifyPermissionOption(opt) === "allow_once") return id;
  }
  for (const opt of options) {
    const id = String(opt?.optionId || "");
    if (!id) continue;
    if (classifyPermissionOption(opt) !== "unknown") continue;
    const name = String(opt?.name || "").toLowerCase();
    if (/\b(proceed|allow once|allow this|approve|continue|yes)\b/.test(name)) {
      return id;
    }
  }
  // Catalog only has allow-always / reject — do not invent allow-once or escalate
  return null;
}

/**
 * @param {string} [optionId]
 * @returns {{ outcome: { outcome: 'selected', optionId: string } }}
 */
export function selectedPermissionResult(optionId = "allow-once") {
  return {
    outcome: {
      outcome: "selected",
      optionId: optionId || "allow-once",
    },
  };
}

/**
 * @returns {{ outcome: { outcome: 'cancelled' } }}
 */
export function cancelledPermissionResult() {
  return { outcome: { outcome: "cancelled" } };
}

/**
 * Build the JSON-RPC result body for a UI decision.
 * Returns null when batchOnce cannot find a once option (do not escalate).
 *
 * @param {string | 'cancelled'} optionId
 * @param {PermOption[] | null | undefined} options
 * @param {{ batchOnce?: boolean }} [opts] batchOnce forces once-only allow mapping
 * @returns {{ outcome: object } | null}
 */
export function permissionOutcomeFromUi(optionId, options, opts = {}) {
  if (optionId === "cancelled" || optionId === "cancel") {
    return cancelledPermissionResult();
  }

  // Batch "Allow all": once-only, never allow-always
  if (opts.batchOnce) {
    const onceId = pickAllowOnceOptionId(options);
    if (!onceId) return null;
    return selectedPermissionResult(onceId);
  }

  const cls = classifyOptionId(optionId, options);

  if (cls === "reject") {
    // Prefer exact listed reject id when present
    if (
      optionId &&
      Array.isArray(options) &&
      options.some((o) => o?.optionId === optionId)
    ) {
      return selectedPermissionResult(optionId);
    }
    // Cancel-style synthetic
    if (/cancel/.test(String(optionId || "").toLowerCase())) {
      return cancelledPermissionResult();
    }
    return selectedPermissionResult(optionId || "reject");
  }

  // User clicked a specific listed option (including allow-always on a single card)
  if (
    optionId &&
    Array.isArray(options) &&
    options.some((o) => o?.optionId === optionId)
  ) {
    return selectedPermissionResult(optionId);
  }

  // Generic allow: map to best once (or always if that was the intent class)
  if (cls === "allow_once" || cls === "allow_always" || cls === "unknown") {
    const allowId = pickAllowOptionId(options, {
      allowAlwaysOk: cls === "allow_always",
    });
    return selectedPermissionResult(allowId);
  }

  return selectedPermissionResult(optionId);
}

/**
 * Extract toolCallId from permission params or tool objects.
 * @param {any} toolOrParams
 * @returns {string | null}
 */
export function extractToolCallId(toolOrParams) {
  if (!toolOrParams || typeof toolOrParams !== "object") return null;
  const t =
    toolOrParams.toolCall ||
    toolOrParams.tool_call ||
    toolOrParams;
  const id =
    t.toolCallId ??
    t.tool_call_id ??
    t.id ??
    toolOrParams.toolCallId ??
    toolOrParams.tool_call_id ??
    null;
  if (id == null || id === "") return null;
  return String(id);
}
