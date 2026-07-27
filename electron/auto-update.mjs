/**
 * GitHub Releases auto-update via electron-updater.
 *
 * Requires Release assets: latest.yml / latest-mac.yml, installers, and
 * macOS .zip (updater cannot install from .dmg alone). See release.yml.
 *
 * Only runs in packaged apps. Dev (`npm run dev`) shows a clear dialog.
 */
import { createRequire } from "node:module";
import { app, dialog, BrowserWindow } from "electron";

const require = createRequire(import.meta.url);

/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;
let wired = false;
/** Prevent double-clicks while a check/download is in flight */
let busy = false;

function getAutoUpdater() {
  if (updater) return updater;
  const { autoUpdater } = require("electron-updater");
  updater = autoUpdater;
  return updater;
}

function parentWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const all = BrowserWindow.getAllWindows();
  return all.find((w) => !w.isDestroyed()) || null;
}

/**
 * @param {import('electron').MessageBoxOptions} opts
 */
async function box(opts) {
  const win = parentWindow();
  if (win) return dialog.showMessageBox(win, opts);
  return dialog.showMessageBox(opts);
}

/**
 * Wire updater events once. Safe to call from setup + interactive check.
 */
function ensureWired() {
  if (wired) return getAutoUpdater();
  let autoUpdater;
  try {
    autoUpdater = getAutoUpdater();
  } catch (err) {
    console.warn("[auto-update] unavailable:", err?.message || err);
    return null;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Public GitHub repo — no token required for download.
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("error", (err) => {
    busy = false;
    console.warn("[auto-update]", err?.message || err);
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[auto-update] available:", info?.version);
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("[auto-update] up to date:", info?.version || app.getVersion());
  });

  autoUpdater.on("download-progress", (p) => {
    const pct = typeof p?.percent === "number" ? p.percent.toFixed(0) : "?";
    console.log(`[auto-update] download ${pct}%`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    busy = false;
    const version = info?.version || "a new version";
    const { response } = await box({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Grok Desktop ${version} is ready to install.`,
      detail:
        "The update was downloaded in the background. Restart to apply it, or keep working and restart later (it installs on quit).",
    });
    if (response === 0) {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        console.warn("[auto-update] quitAndInstall failed:", err?.message || err);
      }
    }
  });

  wired = true;
  return autoUpdater;
}

/**
 * Background check a few seconds after launch (packaged only).
 */
export function setupAutoUpdater() {
  if (!app.isPackaged) return;
  const autoUpdater = ensureWired();
  if (!autoUpdater) return;

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn("[auto-update] silent check failed:", err?.message || err);
    });
  }, 5000);
}

/**
 * Menu / UI: “Check for updates…” with user-visible status dialogs.
 * Does not open the browser unless the user asks for the Releases page.
 */
export async function checkForUpdatesInteractive() {
  if (!app.isPackaged) {
    await box({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      title: "Updates",
      message: "Updates only work in an installed build.",
      detail: `You are running a development copy (v${app.getVersion()}). Install a Release build to use auto-update.`,
    });
    return { ok: false, reason: "dev" };
  }

  if (busy) {
    await box({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      title: "Updates",
      message: "An update check is already in progress.",
    });
    return { ok: false, reason: "busy" };
  }

  const autoUpdater = ensureWired();
  if (!autoUpdater) {
    await box({
      type: "error",
      buttons: ["OK", "Open Releases"],
      defaultId: 0,
      cancelId: 0,
      title: "Updates",
      message: "The auto-updater could not start.",
      detail: "You can download the latest installer from GitHub Releases.",
    }).then(({ response }) => {
      if (response === 1) {
        import("electron").then(({ shell }) =>
          shell.openExternal(
            "https://github.com/liaan/grok-desktop/releases/latest",
          ),
        );
      }
    });
    return { ok: false, reason: "unavailable" };
  }

  busy = true;
  try {
    // Checking dialog is non-blocking; result dialogs come after resolve.
    const result = await autoUpdater.checkForUpdates();
    const updateInfo = result?.updateInfo;
    const latest = updateInfo?.version;
    const current = app.getVersion();

    // If download already started (update-available + autoDownload),
    // update-downloaded will prompt to restart. Avoid a second "found" dialog
    // when we're already past available — but tell the user we found something.
    if (latest && latest !== current) {
      // electron-updater may report available even when equal on some channels;
      // compare semver-ish strings loosely.
      const newer = isVersionNewer(latest, current);
      if (newer) {
        await box({
          type: "info",
          buttons: ["OK"],
          defaultId: 0,
          title: "Update found",
          message: `Version ${latest} is available (you have ${current}).`,
          detail:
            "Downloading in the background. You will be asked to restart when it is ready.",
        });
        // Keep busy until download finishes or errors; clear on a short timeout fallback
        setTimeout(() => {
          busy = false;
        }, 30 * 60_000);
        return { ok: true, latest, current };
      }
    }

    busy = false;
    await box({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      title: "You’re up to date",
      message: `Grok Desktop ${current} is the latest version.`,
    });
    return { ok: true, latest: current, current };
  } catch (err) {
    busy = false;
    const msg = err?.message || String(err);
    console.warn("[auto-update] check failed:", msg);
    const { response } = await box({
      type: "warning",
      buttons: ["OK", "Open Releases"],
      defaultId: 0,
      cancelId: 0,
      title: "Could not check for updates",
      message: "Auto-update check failed.",
      detail:
        msg +
        "\n\nIf this build is older than the first release that ships update metadata (latest.yml), download the latest installer once from Releases — later checks will work in-app.",
    });
    if (response === 1) {
      const { shell } = await import("electron");
      await shell.openExternal(
        "https://github.com/liaan/grok-desktop/releases/latest",
      );
    }
    return { ok: false, reason: "error", error: msg };
  }
}

/**
 * Loose semver compare: true if a is greater than b.
 * @param {string} a
 * @param {string} b
 */
function isVersionNewer(a, b) {
  const pa = String(a)
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b)
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return true;
    if (da < db) return false;
  }
  return false;
}
