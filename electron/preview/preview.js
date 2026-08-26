const api = window.previewChrome;

function applyTheme(theme) {
  document.documentElement.setAttribute(
    "data-theme",
    theme === "light" ? "light" : "dark",
  );
}

const params = new URLSearchParams(location.search);
applyTheme(params.get("theme") || "dark");

const bar = document.getElementById("bar");
const form = document.getElementById("form");
const urlEl = document.getElementById("url");
const back = document.getElementById("back");
const fwd = document.getElementById("fwd");
const reload = document.getElementById("reload");
const viewport = document.getElementById("viewport");
const snap = document.getElementById("snap");
const shot = document.getElementById("shot");
const netBtn = document.getElementById("net");
const netBadge = document.getElementById("net-badge");
const ext = document.getElementById("ext");
const hint = document.getElementById("hint");
const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelMeta = document.getElementById("panel-meta");
const panelBody = document.getElementById("panel-body");
const panelClose = document.getElementById("panel-close");
const network = document.getElementById("network");
const netGrip = document.getElementById("net-grip");
const netSummary = document.getElementById("net-summary");
const netFilter = document.getElementById("net-filter");
const netType = document.getElementById("net-type");
const netLate = document.getElementById("net-late");
const netPreserve = document.getElementById("net-preserve");
const netClear = document.getElementById("net-clear");
const netClose = document.getElementById("net-close");
const netRows = document.getElementById("net-rows");
const netDetail = document.getElementById("net-detail");
const netDetailTitle = document.getElementById("net-detail-title");
const netDetailBody = document.getElementById("net-detail-body");
const netDetailClose = document.getElementById("net-detail-close");
const wfScale = document.getElementById("wf-scale");

const NET_MIN = 140;
const NET_MAX_RATIO = 0.72;
let netHeight = 240;
let lastSnap = null;
let selectedId = "";
let pendingTick = null;

function showHint(msg) {
  if (!msg) {
    hint.hidden = true;
    hint.textContent = "";
    return;
  }
  hint.hidden = false;
  hint.textContent = msg;
}

function showPanel(title, meta, body) {
  panel.hidden = false;
  panelTitle.textContent = title;
  panelMeta.textContent = meta || "";
  panelBody.textContent = body || "";
  void reportLayout();
}

function reportLayout() {
  const hintH = hint.hidden ? 0 : Math.ceil(hint.getBoundingClientRect().height);
  const h = Math.ceil(bar.getBoundingClientRect().height) + hintH;
  const side = panel.hidden ? 0 : Math.ceil(panel.getBoundingClientRect().width);
  const maxNet = Math.floor(window.innerHeight * NET_MAX_RATIO);
  if (netHeight > maxNet) netHeight = Math.max(NET_MIN, maxNet);
  const bottom = network.hidden ? 0 : netHeight;
  panel.style.top = `${h}px`;
  panel.style.bottom = `${bottom}px`;
  if (!network.hidden) network.style.height = `${netHeight}px`;
  return api.ready({ height: h, side, bottom });
}

function applyState(s) {
  if (!s) return;
  if (document.activeElement !== urlEl) {
    urlEl.value = !s.url || s.url === "about:blank" ? "" : s.url;
  }
  back.disabled = !s.canGoBack;
  fwd.disabled = !s.canGoForward;
  if (s.viewport && viewport.value !== s.viewport) viewport.value = s.viewport;
}

function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "—";
  if (v < 1024) return `${Math.round(v)} B`;
  if (v < 1024 * 1024) {
    const k = v / 1024;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)} kB`;
  }
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function visibleRows(snap) {
  if (!snap || !Array.isArray(snap.rows)) return [];
  const q = String(netFilter.value || "").trim().toLowerCase();
  const type = netType.value || "all";
  const late = netLate.checked;
  const loadMs = snap.loadMs;
  return snap.rows.filter((r) => {
    if (type !== "all") {
      if (type === "xhr") {
        if (r.type !== "xhr" && r.type !== "ws") return false;
      } else if (r.type !== type) return false;
    }
    if (late && (loadMs == null || r.startMs < loadMs)) return false;
    if (q) {
      const hay = `${r.name} ${r.url} ${r.method} ${r.initiator}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function applyNetwork(snap) {
  lastSnap = snap;
  const pending = snap?.pending || 0;
  const count = snap?.count || 0;
  if (pending > 0) {
    netBadge.hidden = false;
    netBadge.textContent = String(pending);
    netBadge.classList.add("is-pending");
  } else if (count > 0) {
    netBadge.hidden = false;
    netBadge.textContent = String(count);
    netBadge.classList.remove("is-pending");
  } else {
    netBadge.hidden = true;
    netBadge.textContent = "";
    netBadge.classList.remove("is-pending");
  }

  const bits = [];
  if (snap?.error) bits.push(snap.error);
  if (count) bits.push(`${count} req`);
  if (snap?.transferred) bits.push(fmtBytes(snap.transferred));
  if (pending) bits.push(`${pending} pending`);
  if (snap?.dclMs != null) bits.push(`DCL ${fmtMs(snap.dclMs)}`);
  if (snap?.loadMs != null) bits.push(`Load ${fmtMs(snap.loadMs)}`);
  netSummary.textContent = bits.join(" · ");

  if (!network.hidden) renderNetworkTable(snap);
  syncPendingTick(snap);
}

function syncPendingTick(snap) {
  const need = !network.hidden && snap && snap.pending > 0;
  if (need && !pendingTick) {
    pendingTick = setInterval(() => {
      void api.network().then(applyNetwork);
    }, 250);
  }
  if (!need && pendingTick) {
    clearInterval(pendingTick);
    pendingTick = null;
  }
}

function renderScale(snap, rangeMs) {
  wfScale.replaceChildren();
  const addLabel = (ms, text) => {
    const el = document.createElement("span");
    el.textContent = text;
    el.style.left = `${Math.min(98, Math.max(2, (ms / rangeMs) * 100))}%`;
    wfScale.appendChild(el);
  };
  addLabel(0, "0");
  addLabel(rangeMs / 2, fmtMs(rangeMs / 2));
  addLabel(rangeMs, fmtMs(rangeMs));
  const mark = (ms, title) => {
    if (ms == null || !Number.isFinite(ms)) return;
    const i = document.createElement("i");
    i.title = title;
    i.style.left = `${Math.min(99, (ms / rangeMs) * 100)}%`;
    wfScale.appendChild(i);
  };
  mark(snap.dclMs, `DOMContentLoaded ${fmtMs(snap.dclMs)}`);
  mark(snap.loadMs, `Load ${fmtMs(snap.loadMs)}`);
}

function renderNetworkTable(snap) {
  const rows = visibleRows(snap);
  const rangeMs = Math.max(1, snap?.rangeMs || 1);
  renderScale(snap || {}, rangeMs);

  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    if (r.id === selectedId) tr.classList.add("is-selected");
    if (r.failed) tr.classList.add("is-fail");
    if (r.pending) tr.classList.add("is-pending");
    if (snap.loadMs != null && r.startMs >= snap.loadMs) {
      tr.classList.add("is-late");
    }
    tr.title = `${r.method} ${r.url}\ninitiator: ${r.initiator || "—"}${
      r.initiatorUrl ? `\n${r.initiatorUrl}` : ""
    }`;

    const name = document.createElement("td");
    name.className = "col-name";
    name.textContent = `${r.method !== "GET" ? `${r.method} ` : ""}${r.name}`;
    tr.appendChild(name);

    const st = document.createElement("td");
    st.className = "col-status";
    st.textContent = r.failed ? "ERR" : r.pending ? "…" : String(r.status || "—");
    tr.appendChild(st);

    const ty = document.createElement("td");
    ty.className = "col-type";
    ty.textContent = r.type;
    tr.appendChild(ty);

    const sz = document.createElement("td");
    sz.className = "col-size";
    sz.textContent = r.pending ? "—" : r.sizeLabel || "—";
    tr.appendChild(sz);

    const tm = document.createElement("td");
    tm.className = "col-time";
    tm.textContent = r.timeLabel || "—";
    tr.appendChild(tm);

    const wfTd = document.createElement("td");
    wfTd.className = "col-water";
    const wf = document.createElement("div");
    wf.className = "wf";
    const barEl = document.createElement("div");
    barEl.className = `wf-bar g-${r.type}${r.failed ? " is-fail" : ""}${
      r.pending ? " is-pending" : ""
    }`;
    barEl.style.left = `${(r.startMs / rangeMs) * 100}%`;
    barEl.style.width = `${Math.max(0.4, (r.durationMs / rangeMs) * 100)}%`;
    wf.appendChild(barEl);
    wfTd.appendChild(wf);
    tr.appendChild(wfTd);
    frag.appendChild(tr);
  }
  netRows.replaceChildren(frag);
}

function setNetworkOpen(open) {
  network.hidden = !open;
  netBtn.classList.toggle("is-on", open);
  if (open) {
    void api.network().then(applyNetwork);
  } else {
    syncPendingTick({ pending: 0 });
  }
  void reportLayout();
}

function formatDetail(d) {
  if (!d) return "No request.";
  const lines = [
    `${d.method} ${d.url}`,
    `Status ${d.failed ? d.error || "failed" : `${d.status} ${d.statusText || ""}`.trim()}`,
    `Type ${d.group || d.type}${d.mime ? ` (${d.mime})` : ""}${d.protocol ? ` · ${d.protocol}` : ""}`,
    `Initiator ${d.initiatorType || "—"}${d.initiatorUrl ? `\n  ${d.initiatorUrl}` : ""}`,
    `Cache ${d.fromCache ? "yes" : "no"}`,
    `Size ${fmtBytes(d.encodedSize || d.decodedSize)}`,
  ];
  if (Array.isArray(d.phases) && d.phases.length) {
    lines.push("", "Timing");
    for (const p of d.phases) lines.push(`  ${p.name}  ${fmtMs(p.ms)}`);
  }
  const dump = (title, headers) => {
    lines.push("", title);
    const keys = Object.keys(headers || {});
    if (!keys.length) {
      lines.push("  (none)");
      return;
    }
    for (const k of keys) lines.push(`  ${k}: ${headers[k]}`);
  };
  dump("Request headers", d.reqHeaders);
  dump("Response headers", d.resHeaders);
  return lines.join("\n");
}

async function showDetail(id) {
  selectedId = id;
  for (const tr of netRows.querySelectorAll("tr")) {
    tr.classList.toggle("is-selected", tr.dataset.id === id);
  }
  const d = await api.networkEntry(id);
  netDetail.hidden = !d;
  if (!d) return;
  netDetailTitle.textContent = d.url || "Request";
  netDetailBody.textContent = formatDetail(d);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showHint("");
  try {
    await api.navigate(urlEl.value);
  } catch (err) {
    showHint(err?.message || String(err));
  }
});

back.addEventListener("click", () => void api.back());
fwd.addEventListener("click", () => void api.forward());
reload.addEventListener("click", () => void api.reload());
viewport.addEventListener("change", () => void api.setViewport(viewport.value));
ext.addEventListener("click", () => void api.openExternal());
panelClose.addEventListener("click", () => {
  panel.hidden = true;
  void reportLayout();
});

snap.addEventListener("click", async () => {
  showHint("");
  try {
    const res = await api.snapshot();
    const tokens = Math.ceil((res.chars || res.text.length) / 4);
    showPanel(
      "Text snapshot",
      `${res.chars} chars · ~${tokens} tokens if sent to the model`,
      res.text,
    );
  } catch (err) {
    showHint(err?.message || String(err));
  }
});

shot.addEventListener("click", async () => {
  showHint("");
  try {
    const res = await api.screenshot();
    const kb = Math.round((res.bytes || 0) / 1024);
    showPanel(
      "Screenshot",
      `${res.width}×${res.height} JPEG · ${kb} KB · ~${res.tokens} tokens if sent to the model`,
      `Viewport capture only (not full page).\nThis is the expensive path — prefer Snapshot for structure.\n\ndata:${res.mimeType};base64,${res.data.slice(0, 48)}…`,
    );
  } catch (err) {
    showHint(err?.message || String(err));
  }
});

netBtn.addEventListener("click", () => setNetworkOpen(network.hidden));
netClose.addEventListener("click", () => setNetworkOpen(false));
netClear.addEventListener("click", () => {
  selectedId = "";
  netDetail.hidden = true;
  void api.networkClear().then(applyNetwork);
});
netPreserve.addEventListener("change", () => {
  void api.networkPreserve(netPreserve.checked);
});
netFilter.addEventListener("input", () => {
  if (lastSnap) renderNetworkTable(lastSnap);
});
netType.addEventListener("change", () => {
  if (lastSnap) renderNetworkTable(lastSnap);
});
netLate.addEventListener("change", () => {
  if (lastSnap) renderNetworkTable(lastSnap);
});
netRows.addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr?.dataset.id) return;
  void showDetail(tr.dataset.id);
});
netDetailClose.addEventListener("click", () => {
  selectedId = "";
  netDetail.hidden = true;
  for (const tr of netRows.querySelectorAll("tr.is-selected")) {
    tr.classList.remove("is-selected");
  }
});

netGrip.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const startY = e.clientY;
  const startH = netHeight;
  const onMove = (ev) => {
    const max = Math.floor(window.innerHeight * NET_MAX_RATIO);
    netHeight = Math.min(max, Math.max(NET_MIN, startH + (startY - ev.clientY)));
    void reportLayout();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
});

api.onState(applyState);
api.onTheme(applyTheme);
api.onNetwork(applyNetwork);

void reportLayout().then(applyState);
window.addEventListener("resize", () => {
  void reportLayout();
});
