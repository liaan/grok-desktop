/**
 * Detachable Preview window (separate BrowserWindow + WebContentsView).
 * Lives on its own screen; not a column in the main GUI.
 *
 * Isolated session (no host cookies). http(s) only.
 */
import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  screen,
  session,
  shell,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateImageTokens, normalizePreviewUrl } from "./preview-url.mjs";
import {
  formatPreviewSnapshot,
  PAGE_SNAPSHOT_SCRIPT,
} from "./preview-snapshot.mjs";
import { previewActionScript } from "./preview-interact.mjs";
import {
  PreviewNetworkLog,
  formatNetworkDump,
  ingestWebRequest,
} from "./preview-network.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const VIEWPORTS = {
  fluid: { id: "fluid", label: "Fluid", width: 0, height: 0 },
  desktop: { id: "desktop", label: "1280×800", width: 1280, height: 800 },
  tablet: { id: "tablet", label: "768×1024", width: 768, height: 1024 },
  mobile: { id: "mobile", label: "390×844", width: 390, height: 844 },
};

const TOOLBAR_FALLBACK = 52;

/** @type {import('electron').BrowserWindow | null} */
let previewWin = null;
/** @type {import('electron').WebContentsView | null} */
let guestView = null;
/** @type {((state: Record<string, unknown>) => void) | null} */
let persist = null;
/** @type {(() => Record<string, unknown>) | null} */
let readState = null;
/** @type {((payload: Record<string, unknown>) => void) | null} */
let broadcast = null;

let toolbarHeight = TOOLBAR_FALLBACK;
let sideWidth = 0;
let bottomHeight = 0;
let viewportId = "fluid";
let lastUrl = "about:blank";
let lastTitle = "";
let loading = false;
let ipcReady = false;

/** @type {PreviewNetworkLog} */
let networkLog = new PreviewNetworkLog();
let detachNetwork = () => {};
let networkHint = "";
/** @type {ReturnType<typeof setTimeout> | null} */
let netTimer = null;

function themeFromState() {
  const t = readState?.()?.theme;
  return t === "light" ? "light" : "dark";
}

function isLive() {
  return Boolean(previewWin && !previewWin.isDestroyed());
}

function guestWc() {
  if (!guestView) return null;
  const wc = guestView.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

function chromeWc() {
  if (!isLive()) return null;
  const wc = previewWin.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

export function getPreviewWindow() {
  return isLive() ? previewWin : null;
}

export function isPreviewOpen() {
  return isLive();
}

/**
 * Prefer a display that is not the owner window — that is the point.
 * @param {import('electron').BrowserWindow | null | undefined} owner
 * @param {unknown} saved
 */
export function preferredPreviewBounds(owner, saved) {
  const displays = screen.getAllDisplays();
  const savedBounds =
    saved &&
    typeof saved === "object" &&
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y) &&
    Number(saved.width) >= 480 &&
    Number(saved.height) >= 360
      ? {
          x: Number(saved.x),
          y: Number(saved.y),
          width: Number(saved.width),
          height: Number(saved.height),
        }
      : null;

  if (savedBounds) {
    const hits = displays.some((d) => {
      const a = d.workArea;
      return (
        savedBounds.x + 40 < a.x + a.width &&
        savedBounds.x + savedBounds.width - 40 > a.x &&
        savedBounds.y + 40 < a.y + a.height &&
        savedBounds.y + savedBounds.height - 40 > a.y
      );
    });
    if (hits) return savedBounds;
  }

  const ownerBounds = owner && !owner.isDestroyed() ? owner.getBounds() : null;
  const ownerDisplay = ownerBounds
    ? screen.getDisplayMatching(ownerBounds)
    : screen.getPrimaryDisplay();
  const other = displays.find((d) => d.id !== ownerDisplay.id);
  const target = other || ownerDisplay;
  const wa = target.workArea;
  const width = Math.min(1180, Math.max(720, wa.width - 48));
  const height = Math.min(860, Math.max(520, wa.height - 48));
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height,
  };
}

function persistNow() {
  if (!persist || !isLive()) return;
  persist({
    previewBounds: previewWin.getBounds(),
    previewLastUrl: lastUrl === "about:blank" ? "" : lastUrl,
    previewViewport: viewportId,
  });
}

function emitChrome() {
  const payload = previewPublicState();
  try {
    chromeWc()?.send("preview:state", payload);
  } catch {
    /* chrome may be gone */
  }
  try {
    broadcast?.(payload);
  } catch {
    /* ignore */
  }
}

export function previewPublicState() {
  return {
    open: isLive(),
    url: lastUrl,
    title: lastTitle,
    viewport: viewportId,
    loading,
    canGoBack: Boolean(guestWc()?.navigationHistory?.canGoBack?.()),
    canGoForward: Boolean(guestWc()?.navigationHistory?.canGoForward?.()),
  };
}

function emitNetwork() {
  const payload = {
    ...networkLog.snapshot(),
    error: networkHint || "",
  };
  try {
    chromeWc()?.send("preview:network", payload);
  } catch {
    /* chrome may be gone */
  }
}

function emitNetworkSoon() {
  if (netTimer) return;
  netTimer = setTimeout(() => {
    netTimer = null;
    emitNetwork();
  }, 100);
}

/**
 * CDP Network + Page on the guest. One debugger client — do not open
 * guest DevTools while this is attached (Electron allows one attach).
 * @param {import('electron').WebContents} wc
 */
function attachGuestNetwork(wc) {
  detachNetwork();
  networkLog = new PreviewNetworkLog();
  networkHint = "";
  const dbg = wc.debugger;
  const onMessage = (_event, method, params) => {
    networkLog.handleCdp(method, params);
    emitNetworkSoon();
  };
  const onDetach = (_event, reason) => {
    if (reason && reason !== "target closed" && reason !== "canceled") {
      attachWebRequestFallback(wc.session);
    }
    emitNetworkSoon();
  };
  try {
    if (!dbg.isAttached()) dbg.attach("1.3");
    dbg.on("message", onMessage);
    dbg.on("detach", onDetach);
    void dbg
      .sendCommand("Network.enable", { maxPostDataSize: 0 })
      .then(async () => {
        try {
          await dbg.sendCommand("Page.enable");
          await dbg.sendCommand("Page.setLifecycleEventsEnabled", {
            enabled: true,
          });
        } catch {
          /* Page events optional — did-finish-load is the fallback */
        }
      })
      .catch(() => {
        try {
          if (dbg.isAttached()) dbg.detach();
        } catch {
          /* ignore */
        }
        attachWebRequestFallback(wc.session);
        emitNetworkSoon();
      });
  } catch {
    attachWebRequestFallback(wc.session);
  }

  const onDomReady = () => {
    if (networkLog.dclTs == null) networkLog.markDomContentLoaded();
    emitNetworkSoon();
  };
  const onFinish = () => {
    if (networkLog.loadTs == null) networkLog.markLoad();
    emitNetworkSoon();
  };
  wc.on("dom-ready", onDomReady);
  wc.on("did-finish-load", onFinish);

  detachNetwork = () => {
    wc.removeListener("dom-ready", onDomReady);
    wc.removeListener("did-finish-load", onFinish);
    detachWebRequest(wc.session);
    try {
      dbg.removeListener("message", onMessage);
    } catch {
      /* ignore */
    }
    try {
      dbg.removeListener("detach", onDetach);
    } catch {
      /* ignore */
    }
    try {
      if (dbg.isAttached()) dbg.detach();
    } catch {
      /* ignore */
    }
    detachNetwork = () => {};
  };
}

function attachWebRequestFallback(ses) {
  if (!ses?.webRequest) return;
  detachWebRequest(ses);
  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      ingestWebRequest(networkLog, "start", details);
      emitNetworkSoon();
    } finally {
      callback?.({});
    }
  });
  ses.webRequest.onCompleted((details) => {
    ingestWebRequest(networkLog, "done", details);
    emitNetworkSoon();
  });
  ses.webRequest.onErrorOccurred((details) => {
    ingestWebRequest(networkLog, "error", details);
    emitNetworkSoon();
  });
}

function detachWebRequest(ses) {
  try {
    ses?.webRequest.onBeforeRequest(null);
    ses?.webRequest.onCompleted(null);
    ses?.webRequest.onErrorOccurred(null);
  } catch {
    /* ignore */
  }
}

export function snapshotPreviewNetwork(opts = {}) {
  if (!guestWc()) throw new Error("Preview is not open");
  const snap = networkLog.snapshot();
  return {
    ...snap,
    text: formatNetworkDump(snap, opts),
    error: networkHint || "",
  };
}

function layoutGuest() {
  if (!isLive() || !guestView) return;
  const [cw, ch] = previewWin.getContentSize();
  const top = Math.max(36, toolbarHeight);
  const side = Math.max(0, Math.min(sideWidth, Math.floor(cw * 0.5)));
  const bottom = Math.max(0, Math.min(bottomHeight, Math.floor(ch * 0.72)));
  const availW = Math.max(0, cw - side);
  const availH = Math.max(0, ch - top - bottom);
  const spec = VIEWPORTS[viewportId] || VIEWPORTS.fluid;
  let x = 0;
  let y = top;
  let width = availW;
  let height = availH;
  if (spec.width && spec.height) {
    width = Math.min(spec.width, availW);
    height = Math.min(spec.height, availH);
    x = Math.max(0, Math.floor((availW - width) / 2));
    y = top + Math.max(0, Math.floor((availH - height) / 2));
  }
  if (width < 1 || height < 1) return;
  try {
    guestView.setBounds({ x, y, width, height });
  } catch {
    /* guest not attached yet */
  }
}

function applyViewport() {
  const wc = guestWc();
  const spec = VIEWPORTS[viewportId] || VIEWPORTS.fluid;
  if (wc) {
    try {
      if (spec.width) {
        wc.enableDeviceEmulation({
          screenPosition: spec.id === "mobile" ? "mobile" : "desktop",
          screenSize: { width: spec.width, height: spec.height },
          viewSize: { width: spec.width, height: spec.height },
          deviceScaleFactor: spec.id === "mobile" ? 2 : 1,
          scale: 1,
        });
      }
    } catch {
      /* older Electron / empty guest */
    }
  }
  layoutGuest();
  emitChrome();
}

/**
 * @param {string} href
 */
async function loadGuest(href) {
  const wc = guestWc();
  if (!wc) throw new Error("Preview is not open");
  const parsed = normalizePreviewUrl(href);
  if (!parsed.ok) throw new Error(parsed.error);
  lastUrl = parsed.href;
  loading = true;
  emitChrome();
  await wc.loadURL(parsed.href);
}

function attachGuestHandlers(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    const parsed = normalizePreviewUrl(url);
    if (parsed.ok && parsed.href !== "about:blank") {
      void wc.loadURL(parsed.href);
    }
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    const parsed = normalizePreviewUrl(url);
    if (!parsed.ok) {
      event.preventDefault();
    }
  });
  wc.on("page-title-updated", (_e, title) => {
    lastTitle = title || "";
    if (isLive()) previewWin.setTitle(lastTitle ? `${lastTitle} · Preview` : "Preview · Grok");
    emitChrome();
  });
  wc.on("did-start-loading", () => {
    loading = true;
    emitChrome();
  });
  wc.on("did-stop-loading", () => {
    loading = false;
    lastUrl = wc.getURL() || lastUrl;
    lastTitle = wc.getTitle() || lastTitle;
    emitChrome();
  });
  wc.on("did-navigate", (_e, url) => {
    lastUrl = url || lastUrl;
    emitChrome();
  });
  wc.on("did-navigate-in-page", (_e, url) => {
    lastUrl = url || lastUrl;
    emitChrome();
  });
  wc.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    loading = false;
    lastUrl = url || lastUrl;
    emitChrome();
    void desc;
  });
}

function createGuest() {
  const ses = session.fromPartition("grok-preview");
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
    },
  });
  view.setBackgroundColor("#111113");
  attachGuestHandlers(view.webContents);
  return view;
}

/**
 * @param {object} opts
 * @param {import('electron').BrowserWindow | null} [opts.owner]
 * @param {string} [opts.url]
 */
export async function openPreviewWindow(opts = {}) {
  const owner = opts.owner || null;
  const state = readState?.() || {};
  viewportId = VIEWPORTS[state.previewViewport] ? state.previewViewport : "fluid";

  if (!isLive()) {
    const bounds = preferredPreviewBounds(owner, state.previewBounds);
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 520,
      minHeight: 400,
      title: "Preview · Grok",
      show: false,
      autoHideMenuBar: true,
      backgroundColor: themeFromState() === "light" ? "#f3f3f7" : "#0c0c0f",
      webPreferences: {
        preload: path.join(__dirname, "preview", "preview-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    previewWin = win;

    const persistSoon = debounce(persistNow, 250);
    win.on("resize", () => {
      layoutGuest();
      persistSoon();
    });
    win.on("move", persistSoon);
    win.on("closed", () => {
      persistNow();
      detachNetwork();
      if (netTimer) {
        clearTimeout(netTimer);
        netTimer = null;
      }
      previewWin = null;
      guestView = null;
      lastTitle = "";
      lastUrl = "about:blank";
      loading = false;
      networkLog = new PreviewNetworkLog();
      networkHint = "";
      bottomHeight = 0;
      emitChrome();
      try {
        broadcast?.(previewPublicState());
      } catch {
        /* ignore */
      }
    });

    const chromeFile = path.join(__dirname, "preview", "index.html");
    await win.loadFile(chromeFile, { query: { theme: themeFromState() } });
    guestView = createGuest();
    win.contentView.addChildView(guestView);
    attachGuestNetwork(guestView.webContents);
    win.show();
    win.focus();
  } else {
    if (previewWin.isMinimized()) previewWin.restore();
    previewWin.show();
    previewWin.focus();
  }

  applyViewport();

  const wanted =
    opts.url ||
    (lastUrl && lastUrl !== "about:blank" ? lastUrl : "") ||
    state.previewLastUrl ||
    "";
  if (wanted) {
    const parsed = normalizePreviewUrl(wanted);
    if (parsed.ok && parsed.href !== "about:blank") {
      await loadGuest(parsed.href);
    }
  } else {
    emitChrome();
  }

  return previewPublicState();
}

export function closePreviewWindow() {
  if (!isLive()) return false;
  persistNow();
  previewWin.close();
  return true;
}

export function applyPreviewTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  try {
    chromeWc()?.send("preview:theme", t);
  } catch {
    /* ignore */
  }
  if (isLive()) {
    previewWin.setBackgroundColor(t === "light" ? "#f3f3f7" : "#0c0c0f");
  }
}

export function setPreviewViewport(id) {
  viewportId = VIEWPORTS[id] ? id : "fluid";
  applyViewport();
  persistNow();
  return previewPublicState();
}

export async function navigatePreview(rawUrl) {
  if (!isLive()) {
    throw new Error("Preview is not open");
  }
  await loadGuest(rawUrl);
  return previewPublicState();
}

export async function snapshotPreview() {
  const wc = guestWc();
  if (!wc) throw new Error("Preview is not open");
  const raw = await wc.executeJavaScript(PAGE_SNAPSHOT_SCRIPT, true);
  const text = formatPreviewSnapshot(raw || {});
  return {
    text,
    url: raw?.url || lastUrl,
    title: raw?.title || lastTitle,
    chars: text.length,
  };
}

/**
 * @param {{ action?: string, ref?: string, selector?: string, name?: string, text?: string, value?: string, key?: string }} action
 */
export async function runPreviewAction(action) {
  const wc = guestWc();
  if (!wc) throw new Error("Preview is not open");
  const act = action && typeof action === "object" ? action : {};
  const result = await wc.executeJavaScript(previewActionScript(act), true);
  if (String(act.action || "") === "press") {
    const key = String(act.key || "Enter");
    const keyCode = key === "Enter" ? "Return" : key;
    try {
      wc.sendInputEvent({ type: "keyDown", keyCode });
      wc.sendInputEvent({ type: "char", keyCode: key === "Enter" ? "\u000d" : key });
      wc.sendInputEvent({ type: "keyUp", keyCode });
    } catch {
      /* guest may not accept synthetic keys */
    }
  }
  if (result && result.ok === false) {
    const err = new Error(result.error || "Preview action failed");
    err.detail = result;
    throw err;
  }
  return result || { ok: true };
}

export async function screenshotPreview() {
  const wc = guestWc();
  if (!wc) throw new Error("Preview is not open");
  const image = await wc.capturePage();
  const size = image.getSize();
  const maxW = 1280;
  const resized =
    size.width > maxW
      ? image.resize({ width: maxW, quality: "good" })
      : image;
  const jpeg = resized.toJPEG(62);
  const out = resized.getSize();
  return {
    mimeType: "image/jpeg",
    data: jpeg.toString("base64"),
    bytes: jpeg.length,
    width: out.width,
    height: out.height,
    tokens: estimateImageTokens(out.width, out.height),
  };
}

function fromChrome(event) {
  const wc = event?.sender;
  return Boolean(isLive() && wc && wc === previewWin.webContents);
}

function debounce(fn, ms) {
  let t = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

/**
 * @param {object} hooks
 * @param {() => Record<string, unknown>} hooks.loadState
 * @param {(patch: Record<string, unknown>) => void} hooks.savePatch
 * @param {() => import('electron').BrowserWindow | null} hooks.getOwner
 * @param {(state: Record<string, unknown>) => void} hooks.broadcast
 */
export function registerPreviewIpc(hooks) {
  if (ipcReady) return;
  ipcReady = true;
  readState = hooks.loadState;
  persist = (patch) => hooks.savePatch(patch);
  broadcast = hooks.broadcast;

  ipcMain.handle("preview:open", async (e, opts = {}) => {
    const owner =
      hooks.getOwner(e) ||
      BrowserWindow.fromWebContents(e.sender) ||
      null;
    return openPreviewWindow({
      owner,
      url: typeof opts?.url === "string" ? opts.url : "",
    });
  });

  ipcMain.handle("preview:close", async () => closePreviewWindow());

  ipcMain.handle("preview:state", async () => previewPublicState());

  ipcMain.handle("preview:navigate", async (_e, url) => navigatePreview(url));

  ipcMain.handle("preview:snapshot", async () => snapshotPreview());

  ipcMain.handle("preview:screenshot", async () => screenshotPreview());

  ipcMain.handle("preview:set-viewport", async (_e, id) => {
    viewportId = VIEWPORTS[id] ? id : "fluid";
    applyViewport();
    persistNow();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-ready", async (e, payload) => {
    if (!fromChrome(e)) return previewPublicState();
    const height =
      typeof payload === "number" ? payload : Number(payload?.height);
    const side =
      typeof payload === "object" && payload
        ? Number(payload.side)
        : 0;
    if (Number.isFinite(height) && height > 24) toolbarHeight = height;
    sideWidth = Number.isFinite(side) && side > 0 ? side : 0;
    const bottom =
      typeof payload === "object" && payload ? Number(payload.bottom) : 0;
    bottomHeight = Number.isFinite(bottom) && bottom > 0 ? bottom : 0;
    layoutGuest();
    emitChrome();
    emitNetwork();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-navigate", async (e, url) => {
    if (!fromChrome(e)) throw new Error("Preview chrome only");
    return navigatePreview(url);
  });

  ipcMain.handle("preview:chrome-back", async (e) => {
    if (!fromChrome(e)) return previewPublicState();
    const wc = guestWc();
    if (wc?.navigationHistory?.canGoBack?.()) wc.navigationHistory.goBack();
    else if (wc?.canGoBack?.()) wc.goBack();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-forward", async (e) => {
    if (!fromChrome(e)) return previewPublicState();
    const wc = guestWc();
    if (wc?.navigationHistory?.canGoForward?.()) wc.navigationHistory.goForward();
    else if (wc?.canGoForward?.()) wc.goForward();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-reload", async (e) => {
    if (!fromChrome(e)) return previewPublicState();
    guestWc()?.reload();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-viewport", async (e, id) => {
    if (!fromChrome(e)) return previewPublicState();
    viewportId = VIEWPORTS[id] ? id : "fluid";
    applyViewport();
    persistNow();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-snapshot", async (e) => {
    if (!fromChrome(e)) throw new Error("Preview chrome only");
    return snapshotPreview();
  });

  ipcMain.handle("preview:chrome-screenshot", async (e) => {
    if (!fromChrome(e)) throw new Error("Preview chrome only");
    return screenshotPreview();
  });

  ipcMain.handle("preview:chrome-open-external", async (e) => {
    if (!fromChrome(e)) return false;
    const href = lastUrl;
    const parsed = normalizePreviewUrl(href);
    if (!parsed.ok || parsed.href === "about:blank") return false;
    await shell.openExternal(parsed.href);
    return true;
  });

  ipcMain.handle("preview:chrome-network", async (e) => {
    if (!fromChrome(e)) return { rows: [], error: "Preview chrome only" };
    return { ...networkLog.snapshot(), error: networkHint || "" };
  });

  ipcMain.handle("preview:chrome-network-entry", async (e, id) => {
    if (!fromChrome(e)) return null;
    return networkLog.detail(String(id || ""));
  });

  ipcMain.handle("preview:chrome-network-clear", async (e) => {
    if (!fromChrome(e)) return { rows: [], error: "Preview chrome only" };
    networkLog.clear();
    const payload = { ...networkLog.snapshot(), error: networkHint || "" };
    emitNetwork();
    return payload;
  });

  ipcMain.handle("preview:chrome-network-preserve", async (e, on) => {
    if (!fromChrome(e)) return false;
    networkLog.setPreserveLog(Boolean(on));
    return networkLog.preserveLog;
  });
}
