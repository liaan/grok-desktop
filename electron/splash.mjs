/**
 * Native launch splash — a tiny static BrowserWindow, not the React app.
 *
 * An HTML overlay inside the main renderer cannot paint until Chromium has
 * loaded that renderer, so showing the main window early is always a blank
 * (or white) chrome. This file is loaded with loadFile() and paints in tens
 * of milliseconds while the real window stays hidden.
 */
import { BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('electron').BrowserWindow | null} */
let splashWindow = null;
/** When false, a pending ready-to-show must not surface the splash. */
let splashAllowed = false;

export function bootTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

export function bootBackground(theme) {
  return bootTheme(theme) === "light" ? "#f3f3f7" : "#0c0c0f";
}

export function hasSplash() {
  return Boolean(splashWindow && !splashWindow.isDestroyed());
}

/**
 * @param {unknown} theme
 * @returns {import('electron').BrowserWindow}
 */
export function createSplashWindow(theme) {
  closeSplash();
  splashAllowed = true;
  const t = bootTheme(theme);
  const splash = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: false,
    show: false,
    backgroundColor: bootBackground(t),
    autoHideMenuBar: true,
    title: "Grok Desktop",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splash.setMenu(null);
  splashWindow = splash;
  void splash.loadFile(path.join(__dirname, "splash.html"), {
    query: { theme: t },
  });
  splash.once("ready-to-show", () => {
    if (!splashAllowed || splash.isDestroyed()) {
      if (!splash.isDestroyed()) splash.destroy();
      return;
    }
    splash.center();
    splash.show();
  });
  splash.on("closed", () => {
    if (splashWindow === splash) splashWindow = null;
  });
  return splash;
}

export function closeSplash() {
  splashAllowed = false;
  const splash = splashWindow;
  splashWindow = null;
  if (!splash || splash.isDestroyed()) return;
  try {
    splash.close();
  } catch {
    /* already gone */
  }
}
