/**
 * Live MCP status shared by Settings and ACP overlay.
 * Labels match the TUI /mcps modal: ready, initializing, needs auth, unavailable.
 */

/** @typedef {'ready' | 'initializing' | 'unavailable' | 'needs-auth' | 'setup-required'} McpLiveStatus */

const INTERNAL_MCP = new Set(["desktop-preview", "desktop-preview-stdio"]);

/**
 * @param {unknown} name
 */
export function isDesktopInternalMcp(name) {
  const n = String(name || "").trim();
  return INTERNAL_MCP.has(n) || n.startsWith("desktop-preview");
}

/**
 * @param {unknown} raw
 * @returns {McpLiveStatus | null}
 */
export function normalizeMcpLiveStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!s) return null;
  if (s === "ready" || s === "ok" || s === "healthy" || s === "connected") {
    return "ready";
  }
  if (s === "initializing" || s === "starting" || s === "connecting") {
    return "initializing";
  }
  if (s === "needsauth" || s === "authrequired" || s === "unauthorized") {
    return "needs-auth";
  }
  if (s === "setuprequired" || s === "needssetup") {
    return "setup-required";
  }
  if (
    s === "unavailable" ||
    s === "failed" ||
    s === "error" ||
    s === "down" ||
    s === "disconnected"
  ) {
    return "unavailable";
  }
  return null;
}

/**
 * TUI /mcps status text.
 * @param {unknown} status
 */
export function mcpLiveLabel(status) {
  const s = normalizeMcpLiveStatus(status) || status;
  if (s === "ready") return "ready";
  if (s === "initializing") return "initializing";
  if (s === "needs-auth") return "needs auth";
  if (s === "setup-required") return "needs setup";
  if (s === "unavailable") return "unavailable";
  if (s === "unknown") return "unknown";
  return null;
}

/**
 * Card status: live ACP first, then Test, then unknown.
 * @param {{ enabled?: boolean | null, authRequired?: boolean, liveStatus?: string | null }} server
 * @param {{ status?: string, healthy?: boolean, needsAuth?: boolean } | null | undefined} view
 */
export function resolveMcpCardStatus(server, view) {
  if (server?.enabled === false) return "unavailable";
  if (view?.needsAuth || server?.authRequired) return "needs-auth";
  if (view?.status === "running") return "initializing";
  if (view?.healthy === true) return "ready";
  if (view?.status === "fail") return "unavailable";
  return normalizeMcpLiveStatus(server?.liveStatus) || "unknown";
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function sessionToolNames(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    let name = "";
    if (typeof item === "string") name = item.trim();
    else if (item && typeof item === "object") {
      const rec = /** @type {Record<string, unknown>} */ (item);
      name = String(rec.name ?? rec.id ?? rec.tool ?? "").trim();
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Sanitize one `x.ai/mcp/list` row. Never copies env/header values.
 * @param {unknown} raw
 */
export function mapMcpSessionEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      name: "",
      displayName: null,
      liveStatus: /** @type {McpLiveStatus | null} */ (null),
      authRequired: false,
      setupRequired: false,
      liveEnabled: null,
      liveToolCount: null,
      source: null,
      transport: null,
      url: null,
      command: null,
    };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const name = String(o.name || o.id || "").trim();
  const session =
    o.session && typeof o.session === "object"
      ? /** @type {Record<string, unknown>} */ (o.session)
      : {};
  const authRequired =
    session.authRequired === true ||
    session.auth_required === true ||
    o.authRequired === true ||
    o.auth_required === true;
  const setupRequired =
    session.setupRequired === true ||
    session.setup_required === true ||
    normalizeMcpLiveStatus(session.status) === "setup-required";
  let liveStatus = normalizeMcpLiveStatus(session.status ?? o.status);
  if (authRequired) liveStatus = "needs-auth";
  else if (setupRequired && !liveStatus) liveStatus = "setup-required";

  const type = String(o.type || o.transport || "").toLowerCase();
  let transport = null;
  if (type === "http" || type === "sse" || type === "stdio") transport = type;
  else if (type === "managedgateway" || type === "managed") transport = "http";

  const url = o.url == null || o.url === "" ? null : String(o.url);
  const command = o.command == null || o.command === "" ? null : String(o.command);
  const tools = sessionToolNames(session.tools ?? o.tools);
  let liveEnabled = null;
  if (typeof session.enabled === "boolean") liveEnabled = session.enabled;
  else if (typeof o.enabled === "boolean") liveEnabled = o.enabled;

  let source = null;
  if (typeof o.source === "string" && o.source) source = o.source.toLowerCase();
  if (String(name).startsWith("managed_gateway:")) source = "managed";

  const displayName =
    o.displayName == null || o.displayName === ""
      ? o.display_name == null || o.display_name === ""
        ? null
        : String(o.display_name)
      : String(o.displayName);

  return {
    name,
    displayName,
    liveStatus,
    authRequired,
    setupRequired,
    liveEnabled,
    liveToolCount: tools.length ? tools.length : null,
    source,
    transport,
    url,
    command,
  };
}

/**
 * @param {unknown} data
 */
export function mapMcpSessionCatalog(data) {
  if (!data || typeof data !== "object") return [];
  const o = /** @type {Record<string, unknown>} */ (data);
  const rows = Array.isArray(o.servers)
    ? o.servers
    : Array.isArray(o.mcpServers)
      ? o.mcpServers
      : Array.isArray(data)
        ? data
        : [];
  return rows.map(mapMcpSessionEntry).filter((s) => Boolean(s.name));
}

/**
 * Overlay live ACP status onto `grok mcp list` rows.
 * @param {Array<Record<string, any>>} servers
 * @param {ReturnType<typeof mapMcpSessionCatalog>} liveRows
 * @param {{ assumeInitializing?: boolean }} [opts]
 */
export function mergeMcpLiveStatus(servers, liveRows = [], opts = {}) {
  const byName = new Map(liveRows.map((row) => [row.name, row]));
  const out = (servers || []).map((s) => {
    if (s.enabled === false) {
      return { ...s, liveStatus: "unavailable", authRequired: false };
    }
    const live = byName.get(s.name);
    if (!live) {
      // Only guess "initializing" when we have no live catalog at all
      // (first paint / ACP list failed). Never leave a known catalog
      // stuck on initializing because a name did not match.
      const assume = Boolean(opts.assumeInitializing) && liveRows.length === 0;
      return {
        ...s,
        liveStatus: assume ? "initializing" : s.liveStatus || null,
      };
    }
    return {
      ...s,
      liveStatus: live.liveStatus,
      authRequired: live.authRequired,
      liveToolCount: live.liveToolCount,
      source: s.source || live.source,
    };
  });
  const seen = new Set(out.map((s) => s.name));
  for (const live of liveRows) {
    if (!live.name || seen.has(live.name) || isDesktopInternalMcp(live.name)) {
      continue;
    }
    out.push({
      name: live.name,
      displayName: live.displayName || null,
      transport: live.transport,
      enabled: live.liveEnabled,
      scope: live.source === "managed" ? "managed" : null,
      command: live.command,
      args: [],
      url: live.url,
      envKeys: [],
      headerKeys: [],
      source: live.source,
      signedIn: false,
      liveStatus: live.liveStatus,
      authRequired: live.authRequired,
      liveToolCount: live.liveToolCount,
    });
    seen.add(live.name);
  }
  return out;
}

/**
 * Patch one card from `x.ai/mcp/server_status`.
 * @param {Record<string, any>} server
 * @param {Record<string, any>} payload
 */
export function applyMcpServerStatus(server, payload) {
  const status = normalizeMcpLiveStatus(payload?.status);
  if (!status) return server;
  return {
    ...server,
    liveStatus: status,
    authRequired: status === "needs-auth",
  };
}

/**
 * Sign in is only for servers that actually need OAuth — never every HTTP row.
 * @param {{ authRequired?: boolean, liveStatus?: string | null }} server
 * @param {{ needsAuth?: boolean } | null | undefined} [testView]
 */
/**
 * Doctor check details often include Rust type paths from rmcp. Settings
 * should show a short reason, not the full debug dump.
 * @param {unknown} detail
 */
export function summarizeMcpDoctorDetail(detail) {
  const raw = String(detail || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (/failed to get tools after auth/i.test(raw) && /auth requir/i.test(raw)) {
    return "Signed in, but the server still rejected the handshake";
  }
  if (
    /oauth authorization required|no stored tokens|authenticate in tui|authorization required, when send initialize|re-authenticate in tui|stored credentials unusable/i.test(
      raw,
    )
  ) {
    return "OAuth sign-in required";
  }
  const auth = raw.match(/auth(?:orization)? error:\s*([^[\]]+?)(?:\s*,?\s*when |\s*$)/i);
  if (auth) return auth[1].trim().replace(/\.$/, "");
  let cleaned = raw
    .replace(/Transport\s*\[[\s\S]*?\]\s*/g, "")
    .replace(/[A-Za-z0-9_]+::[A-Za-z0-9_:<>,\s]+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:(,-]+|[\s:),-]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 4) {
    if (/handshake/i.test(raw)) return "handshake failed";
    return null;
  }
  if (cleaned.length > 120) cleaned = `${cleaned.slice(0, 117)}…`;
  return cleaned;
}

export function mcpNeedsSignIn(server, testView) {
  if (testView?.needsAuth) return true;
  if (server?.authRequired) return true;
  return normalizeMcpLiveStatus(server?.liveStatus) === "needs-auth";
}