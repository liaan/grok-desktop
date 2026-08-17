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
const ext = document.getElementById("ext");
const hint = document.getElementById("hint");
const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelMeta = document.getElementById("panel-meta");
const panelBody = document.getElementById("panel-body");
const panelClose = document.getElementById("panel-close");

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
  panel.style.top = `${h}px`;
  return api.ready({ height: h, side });
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

api.onState(applyState);
api.onTheme(applyTheme);

void reportLayout().then(applyState);
window.addEventListener("resize", () => {
  void reportLayout();
});
