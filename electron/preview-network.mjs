/**
 * Preview guest network log (Chrome DevTools Protocol Network domain).
 * Pure event folding so tests do not need Electron. The window attaches
 * webContents.debugger and feeds handleCdp().
 */

export const MAX_NETWORK_ENTRIES = 500;

const SENSITIVE_HEADER =
  /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|x-auth-token|x-access-token)$/i;

/** @typedef {'doc' | 'css' | 'js' | 'img' | 'media' | 'font' | 'xhr' | 'ws' | 'other'} ResourceGroup */

/**
 * Electron session.webRequest resourceType → CDP Network.ResourceType.
 * @param {unknown} resourceType
 */
export function webRequestCdpType(resourceType) {
  switch (String(resourceType || "")) {
    case "mainFrame":
      return { type: "Document", frameId: "main" };
    case "subFrame":
      return { type: "Document", frameId: "sub" };
    case "stylesheet":
      return { type: "Stylesheet", frameId: "" };
    case "script":
      return { type: "Script", frameId: "" };
    case "image":
      return { type: "Image", frameId: "" };
    case "font":
      return { type: "Font", frameId: "" };
    case "xhr":
      return { type: "XHR", frameId: "" };
    case "media":
      return { type: "Media", frameId: "" };
    case "webSocket":
      return { type: "WebSocket", frameId: "" };
    default:
      return { type: "Other", frameId: "" };
  }
}

/**
 * Fold an Electron webRequest event into the CDP log (debugger fallback).
 * @param {PreviewNetworkLog} log
 * @param {'start' | 'done' | 'error'} phase
 * @param {Record<string, unknown>} details
 */
export function ingestWebRequest(log, phase, details) {
  const d = details && typeof details === "object" ? details : {};
  const requestId = `wr-${d.id}`;
  const mapped = webRequestCdpType(d.resourceType);
  const ts = Number(d.timestamp);
  if (phase === "start") {
    log.handleCdp("Network.requestWillBeSent", {
      requestId,
      timestamp: ts,
      type: mapped.type,
      frameId: mapped.frameId,
      initiator: { type: "other" },
      request: {
        url: String(d.url || ""),
        method: String(d.method || "GET"),
        headers: {},
      },
    });
    return;
  }
  if (phase === "done") {
    log.handleCdp("Network.responseReceived", {
      requestId,
      timestamp: ts,
      type: mapped.type,
      response: {
        status: Number(d.statusCode) || 0,
        statusText: "",
        mimeType: "",
        fromDiskCache: Boolean(d.fromCache),
        headers: {},
      },
    });
    log.handleCdp("Network.loadingFinished", {
      requestId,
      timestamp: ts,
      encodedDataLength: 0,
    });
    return;
  }
  log.handleCdp("Network.loadingFailed", {
    requestId,
    timestamp: ts,
    errorText: String(d.error || "failed"),
    canceled: String(d.error || "") === "net::ERR_ABORTED",
    type: mapped.type,
  });
}

/**
 * @param {unknown} type
 * @param {unknown} [mime]
 * @returns {ResourceGroup}
 */
export function resourceGroup(type, mime = "") {
  const t = String(type || "");
  const m = String(mime || "").toLowerCase();
  if (t === "Document") return "doc";
  if (t === "Stylesheet" || m.includes("text/css")) return "css";
  if (
    t === "Script" ||
    m.includes("javascript") ||
    m.includes("ecmascript")
  ) {
    return "js";
  }
  if (t === "Image" || m.startsWith("image/")) return "img";
  if (t === "Media" || m.startsWith("audio/") || m.startsWith("video/")) {
    return "media";
  }
  if (t === "Font" || m.includes("font") || m.includes("woff")) return "font";
  if (
    t === "XHR" ||
    t === "Fetch" ||
    t === "EventSource" ||
    t === "Preflight"
  ) {
    return "xhr";
  }
  if (t === "WebSocket") return "ws";
  return "other";
}

/**
 * @param {unknown} n
 * @returns {string}
 */
export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "—";
  if (v < 1024) return `${Math.round(v)} B`;
  if (v < 1024 * 1024) {
    const k = v / 1024;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)} kB`;
  }
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {unknown} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  if (v < 10_000) return `${(v / 1000).toFixed(2)} s`;
  return `${(v / 1000).toFixed(1)} s`;
}

/**
 * @param {unknown} url
 * @returns {string}
 */
export function entryName(url) {
  const raw = String(url || "");
  if (!raw) return "(unknown)";
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    const leaf = parts.length ? parts[parts.length - 1] : u.host || "/";
    const q = u.search.length > 48 ? `${u.search.slice(0, 45)}…` : u.search;
    return `${leaf}${q}` || u.host;
  } catch {
    return raw.length > 64 ? `${raw.slice(0, 61)}…` : raw;
  }
}

/**
 * @param {Record<string, string> | undefined} headers
 * @returns {Record<string, string>}
 */
export function redactHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER.test(k) ? "…" : String(v ?? "");
  }
  return out;
}

function asHeaders(h) {
  if (!h || typeof h !== "object") return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = Array.isArray(v) ? v.join("\n") : String(v ?? "");
  }
  return out;
}

function initiatorOf(initiator) {
  if (!initiator || typeof initiator !== "object") {
    return { type: "other", url: "" };
  }
  const type = String(initiator.type || "other").toLowerCase();
  let url = String(initiator.url || "");
  const stack = initiator.stack;
  if (!url && stack && typeof stack === "object") {
    const frames = Array.isArray(stack.callFrames) ? stack.callFrames : [];
    url = String(frames[0]?.url || "");
  }
  return { type, url };
}

function emptyEntry(id) {
  return {
    id,
    url: "",
    method: "GET",
    type: "Other",
    group: /** @type {ResourceGroup} */ ("other"),
    status: 0,
    statusText: "",
    mime: "",
    protocol: "",
    startTs: 0,
    endTs: /** @type {number | null} */ (null),
    encodedSize: 0,
    decodedSize: 0,
    fromCache: false,
    failed: false,
    canceled: false,
    errorText: "",
    initiatorType: "other",
    initiatorUrl: "",
    reqHeaders: {},
    resHeaders: {},
    timing: /** @type {Record<string, number> | null} */ (null),
    redirects: /** @type {object[]} */ ([]),
    frameId: "",
  };
}

/**
 * In-memory request log. Times are CDP timestamps (seconds).
 */
export class PreviewNetworkLog {
  constructor() {
    /** @type {Map<string, ReturnType<typeof emptyEntry>>} */
    this.entries = new Map();
    /** @type {string[]} */
    this.order = [];
    this.originTs = /** @type {number | null} */ (null);
    this.lastTs = 0;
    this.dclTs = /** @type {number | null} */ (null);
    this.loadTs = /** @type {number | null} */ (null);
    this.idleTs = /** @type {number | null} */ (null);
    this.mainFrameId = "";
    this.preserveLog = false;
    this.generation = 0;
  }

  setPreserveLog(on) {
    this.preserveLog = Boolean(on);
  }

  clear() {
    this.entries.clear();
    this.order = [];
    this.originTs = null;
    this.dclTs = null;
    this.loadTs = null;
    this.idleTs = null;
    this.generation += 1;
  }

  /**
   * @param {number} ts
   */
  noteTime(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n)) return;
    this.lastTs = n;
    if (this.originTs == null) this.originTs = n;
  }

  markDomContentLoaded(ts) {
    this.noteTime(ts ?? this.lastTs);
    this.dclTs = this.lastTs || this.originTs;
  }

  markLoad(ts) {
    this.noteTime(ts ?? this.lastTs);
    this.loadTs = this.lastTs || this.originTs;
  }

  markNetworkIdle(ts) {
    this.noteTime(ts ?? this.lastTs);
    this.idleTs = this.lastTs || this.originTs;
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   */
  handleCdp(method, params = {}) {
    const p = params && typeof params === "object" ? params : {};
    if (p.timestamp != null) this.noteTime(p.timestamp);

    switch (method) {
      case "Network.requestWillBeSent":
        this._onRequestWillBeSent(p);
        break;
      case "Network.requestServedFromCache":
        this._patch(String(p.requestId || ""), (e) => {
          e.fromCache = true;
        });
        break;
      case "Network.responseReceived":
        this._onResponseReceived(p);
        break;
      case "Network.responseReceivedExtraInfo":
        this._patch(String(p.requestId || ""), (e) => {
          e.resHeaders = { ...e.resHeaders, ...asHeaders(p.headers) };
        });
        break;
      case "Network.requestWillBeSentExtraInfo":
        this._patch(String(p.requestId || ""), (e) => {
          e.reqHeaders = { ...e.reqHeaders, ...asHeaders(p.headers) };
        });
        break;
      case "Network.dataReceived":
        this._patch(String(p.requestId || ""), (e) => {
          e.decodedSize += Number(p.dataLength) || 0;
          if (p.encodedDataLength != null) {
            e.encodedSize += Number(p.encodedDataLength) || 0;
          }
        });
        break;
      case "Network.loadingFinished":
        this._patch(String(p.requestId || ""), (e) => {
          e.endTs = Number(p.timestamp) || e.endTs || this.lastTs;
          if (p.encodedDataLength != null) {
            e.encodedSize = Number(p.encodedDataLength) || e.encodedSize;
          }
        });
        break;
      case "Network.loadingFailed":
        this._patch(String(p.requestId || ""), (e) => {
          e.endTs = Number(p.timestamp) || this.lastTs;
          e.failed = true;
          e.canceled = Boolean(p.canceled);
          e.errorText = String(p.errorText || p.blockedReason || "failed");
          if (p.type) {
            e.type = String(p.type);
            e.group = resourceGroup(e.type, e.mime);
          }
        });
        break;
      case "Page.domContentEventFired":
        this.markDomContentLoaded(p.timestamp);
        break;
      case "Page.loadEventFired":
        this.markLoad(p.timestamp);
        break;
      case "Page.lifecycleEvent": {
        const name = String(p.name || "");
        if (name === "DOMContentLoaded") this.markDomContentLoaded(p.timestamp);
        if (name === "load") this.markLoad(p.timestamp);
        if (name === "networkIdle") this.markNetworkIdle(p.timestamp);
        break;
      }
      default:
        break;
    }
  }

  _onRequestWillBeSent(p) {
    const requestId = String(p.requestId || "");
    if (!requestId) return;
    const request = p.request && typeof p.request === "object" ? p.request : {};
    const type = String(p.type || "Other");
    const frameId = String(p.frameId || "");
    const ts = Number(p.timestamp) || this.lastTs;
    const isMain =
      type === "Document" &&
      (!this.mainFrameId || !frameId || frameId === this.mainFrameId);

    if (isMain && !p.redirectResponse) {
      if (!this.preserveLog) this.clear();
      this.mainFrameId = frameId || this.mainFrameId;
    }

    const init = initiatorOf(p.initiator);
    const existing = this.entries.get(requestId);

    if (existing && p.redirectResponse) {
      const redir = p.redirectResponse;
      existing.redirects.push(
        this._freezeHop(existing, {
          status: Number(redir.status) || 0,
          statusText: String(redir.statusText || ""),
          mime: String(redir.mimeType || existing.mime),
          headers: asHeaders(redir.headers),
          url: String(redir.url || existing.url),
          endTs: ts,
        }),
      );
      existing.url = String(request.url || existing.url);
      existing.method = String(request.method || existing.method || "GET");
      existing.reqHeaders = asHeaders(request.headers);
      existing.resHeaders = {};
      existing.status = 0;
      existing.statusText = "";
      existing.startTs = ts;
      existing.endTs = null;
      existing.failed = false;
      existing.canceled = false;
      existing.errorText = "";
      existing.encodedSize = 0;
      existing.decodedSize = 0;
      existing.fromCache = false;
      existing.timing = null;
      this.noteTime(ts);
      return;
    }

    if (existing) return;

    const entry = emptyEntry(requestId);
    entry.url = String(request.url || "");
    entry.method = String(request.method || "GET");
    entry.type = type;
    entry.group = resourceGroup(type);
    entry.startTs = ts;
    entry.reqHeaders = asHeaders(request.headers);
    entry.initiatorType = init.type;
    entry.initiatorUrl = init.url;
    entry.frameId = frameId;
    this.entries.set(requestId, entry);
    this.order.push(requestId);
    this.noteTime(ts);
    this._trim();
  }

  _onResponseReceived(p) {
    const response = p.response && typeof p.response === "object" ? p.response : {};
    this._patch(String(p.requestId || ""), (e) => {
      e.status = Number(response.status) || 0;
      e.statusText = String(response.statusText || "");
      e.mime = String(response.mimeType || "");
      e.protocol = String(response.protocol || "");
      e.resHeaders = { ...e.resHeaders, ...asHeaders(response.headers) };
      e.fromCache = Boolean(
        response.fromDiskCache ||
          response.fromServiceWorker ||
          response.fromPrefetchCache ||
          e.fromCache,
      );
      if (p.type) {
        e.type = String(p.type);
      }
      e.group = resourceGroup(e.type, e.mime);
      if (response.timing && typeof response.timing === "object") {
        e.timing = response.timing;
      }
      if (response.encodedDataLength) {
        e.encodedSize = Math.max(
          e.encodedSize,
          Number(response.encodedDataLength) || 0,
        );
      }
    });
  }

  _freezeHop(entry, hop) {
    const n = entry.redirects.length;
    return {
      ...emptyEntry(`${entry.id}#r${n}`),
      url: hop.url,
      method: entry.method,
      type: entry.type,
      group: entry.group,
      status: hop.status,
      statusText: hop.statusText,
      mime: hop.mime,
      startTs: entry.startTs,
      endTs: hop.endTs,
      encodedSize: 0,
      initiatorType: entry.initiatorType,
      initiatorUrl: entry.initiatorUrl,
      reqHeaders: { ...entry.reqHeaders },
      resHeaders: hop.headers || {},
      fromCache: false,
    };
  }

  _patch(id, fn) {
    const e = this.entries.get(id);
    if (!e) return;
    fn(e);
  }

  _trim() {
    while (this.order.length > MAX_NETWORK_ENTRIES) {
      const id = this.order.shift();
      if (id) this.entries.delete(id);
    }
  }

  /**
   * @param {number} [nowTs]
   */
  snapshot(nowTs) {
    const now = Number.isFinite(nowTs) ? Number(nowTs) : this.lastTs;
    const origin = this.originTs == null ? now : this.originTs;
    const rel = (ts) =>
      ts == null || !Number.isFinite(ts) ? null : Math.max(0, (ts - origin) * 1000);

    /** @type {object[]} */
    const rows = [];
    for (const id of this.order) {
      const e = this.entries.get(id);
      if (!e) continue;
      for (const hop of e.redirects) rows.push(this._row(hop, origin, now));
      rows.push(this._row(e, origin, now));
    }

    let rangeMs = 0;
    let transferred = 0;
    let pending = 0;
    for (const row of rows) {
      rangeMs = Math.max(rangeMs, row.startMs + row.durationMs);
      if (!row.fromCache && row.size > 0) transferred += row.size;
      if (row.pending) pending += 1;
    }
    if (rangeMs < 1) rangeMs = 1;

    return {
      originTs: origin,
      nowTs: now,
      rangeMs,
      dclMs: rel(this.dclTs),
      loadMs: rel(this.loadTs),
      idleMs: rel(this.idleTs),
      count: rows.length,
      pending,
      transferred,
      generation: this.generation,
      rows,
    };
  }

  _row(e, origin, now) {
    const startMs = Math.max(0, (e.startTs - origin) * 1000);
    const end = e.endTs == null ? now : e.endTs;
    const durationMs = Math.max(0, (end - e.startTs) * 1000);
    const pending = e.endTs == null && !e.failed;
    return {
      id: e.id,
      url: e.url,
      name: entryName(e.url),
      method: e.method,
      status: e.status,
      statusText: e.statusText,
      type: e.group,
      typeRaw: e.type,
      mime: e.mime,
      protocol: e.protocol,
      size: e.encodedSize || e.decodedSize,
      sizeLabel: e.fromCache
        ? `${formatBytes(e.encodedSize || e.decodedSize)} cache`
        : formatBytes(e.encodedSize || e.decodedSize),
      startMs,
      durationMs,
      timeLabel: pending ? "pending" : formatDuration(durationMs),
      pending,
      failed: e.failed,
      canceled: e.canceled,
      error: e.errorText,
      fromCache: e.fromCache,
      initiator: e.initiatorType,
      initiatorUrl: e.initiatorUrl,
    };
  }

  /**
   * Full entry for the chrome detail pane (headers included).
   * @param {string} id
   */
  detail(id) {
    const key = String(id || "");
    const base = key.replace(/#r\d+$/, "");
    const e = this.entries.get(base);
    if (!e) return null;
    if (key !== base) {
      const hop = e.redirects.find((h) => h.id === key);
      if (!hop) return null;
      return this._detailPayload(hop);
    }
    return this._detailPayload(e);
  }

  _detailPayload(e) {
    const totalMs =
      e.endTs != null && e.startTs != null
        ? (e.endTs - e.startTs) * 1000
        : null;
    return {
      id: e.id,
      url: e.url,
      method: e.method,
      status: e.status,
      statusText: e.statusText,
      type: e.type,
      group: e.group,
      mime: e.mime,
      protocol: e.protocol,
      fromCache: e.fromCache,
      failed: e.failed,
      canceled: e.canceled,
      error: e.errorText,
      initiatorType: e.initiatorType,
      initiatorUrl: e.initiatorUrl,
      encodedSize: e.encodedSize,
      decodedSize: e.decodedSize,
      timing: e.timing,
      phases: timingPhases(e.timing, totalMs),
      reqHeaders: e.reqHeaders,
      resHeaders: e.resHeaders,
    };
  }
}

/**
 * @param {ResourceGroup | string} group
 * @param {string} filter
 */
export function matchesNetworkFilter(group, filter) {
  const f = String(filter || "").toLowerCase();
  if (!f || f === "all") return true;
  if (f === "xhr") return group === "xhr" || group === "ws";
  return group === f;
}

/**
 * Compact text waterfall for the agent (no cookie/auth headers).
 * @param {ReturnType<PreviewNetworkLog['snapshot']>} snap
 * @param {{ filter?: string, afterLoad?: boolean, limit?: number }} [opts]
 */
export function formatNetworkDump(snap, opts = {}) {
  if (!snap || !Array.isArray(snap.rows)) {
    return "Preview network: no data. Open Preview and load a page first.";
  }
  const filter = String(opts.filter || "");
  const afterLoad = Boolean(opts.afterLoad);
  const limit = Math.min(120, Math.max(1, Number(opts.limit) || 80));
  const loadMs = snap.loadMs;
  const rows = snap.rows.filter((r) => {
    if (!matchesNetworkFilter(r.type, filter)) return false;
    if (afterLoad && loadMs != null && r.startMs < loadMs) return false;
    return true;
  });

  const lines = [];
  const bits = [
    `Network · ${snap.count} req`,
    `${formatBytes(snap.transferred)} transferred`,
    snap.pending ? `${snap.pending} pending` : null,
    snap.dclMs != null ? `DCL ${formatDuration(snap.dclMs)}` : null,
    snap.loadMs != null ? `Load ${formatDuration(snap.loadMs)}` : null,
    snap.idleMs != null ? `idle ${formatDuration(snap.idleMs)}` : null,
  ].filter(Boolean);
  lines.push(bits.join(" · "));
  if (afterLoad) {
    lines.push(
      loadMs == null
        ? "Filter: after load (Load event not recorded yet)"
        : `Filter: started after Load (${formatDuration(loadMs)})`,
    );
  }
  if (filter && filter !== "all") lines.push(`Type: ${filter}`);
  if (!rows.length) {
    lines.push("No matching requests.");
    return lines.join("\n");
  }

  lines.push(
    "start    status  type   size        time      initiator  name",
  );
  const shown = rows.slice(0, limit);
  for (const r of shown) {
    const st = r.failed
      ? "ERR"
      : r.pending
        ? "…"
        : String(r.status || "—").padStart(3, " ");
    const after =
      loadMs != null && r.startMs >= loadMs ? " *" : "  ";
    const name = `${r.method === "GET" ? "" : `${r.method} `}${r.name}`;
    lines.push(
      `${String(Math.round(r.startMs)).padStart(6, " ")}ms${after}${st.padStart(6, " ")}  ${String(r.type).padEnd(6, " ")} ${String(r.sizeLabel).padEnd(10, " ")} ${String(r.timeLabel).padEnd(9, " ")} ${String(r.initiator).padEnd(9, " ")}  ${name}`,
    );
  }
  if (rows.length > shown.length) {
    lines.push(`… ${rows.length - shown.length} more (pass a tighter filter)`);
  }
  if (rows.some((r) => loadMs != null && r.startMs >= loadMs)) {
    lines.push("* started after window load (lazy / deferred)");
  }
  return lines.join("\n");
}

/**
 * Timing phases from CDP ResourceTiming, milliseconds.
 * @param {Record<string, number> | null | undefined} timing
 * @param {number} [totalMs]
 */
export function timingPhases(timing, totalMs) {
  if (!timing || typeof timing !== "object") {
    return totalMs != null ? [{ name: "Total", ms: totalMs }] : [];
  }
  const span = (a, b) => {
    const x = Number(timing[a]);
    const y = Number(timing[b]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || y < x) {
      return null;
    }
    return y - x;
  };
  const parts = [
    ["DNS", span("dnsStart", "dnsEnd")],
    ["Connect", span("connectStart", "connectEnd")],
    ["SSL", span("sslStart", "sslEnd")],
    ["Send", span("sendStart", "sendEnd")],
    ["Wait", span("sendEnd", "receiveHeadersEnd")],
  ];
  /** @type {{ name: string, ms: number }[]} */
  const out = [];
  for (const [name, ms] of parts) {
    if (ms != null && ms > 0) out.push({ name, ms });
  }
  if (totalMs != null && Number.isFinite(totalMs)) {
    out.push({ name: "Total", ms: totalMs });
  }
  return out;
}
