/**
 * GitHub Releases auto-update (electron-updater).
 * Only runs in packaged apps. Dev (`npm run dev`) skips this.
 *
 * Requires release assets to include electron-builder update metadata:
 *   latest.yml / latest-mac.yml / latest-linux.yml + installers (+ blockmaps).
 * See AGENTS.md shipping checklist.
 */
import { createRequire } from "node:module";
import { app, dialog } from "electron";

const require = createRequire(import.meta.url);

/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;

function getAutoUpdater() {
  if (updater) return updater;
  // electron-updater is CJS; keep this require so ESM main process stays simple.
  const { autoUpdater } = require("electron-updater");
  updater = autoUpdater;
  return updater;
}

/**
 * Start background update checks against GitHub Releases.
 * Safe no-op when unpackaged or when updater cannot start.
 */
export function setupAutoUpdater() {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    autoUpdater = getAutoUpdater();
  } catch (err) {
    console.warn("[auto-update] unavailable:", err?.message || err);
    return;
  }

  // Public repo: no token needed to read Releases.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    console.warn("[auto-update]", err?.message || err);
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[auto-update] available:", info?.version);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const version = info?.version || "a new version";
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Grok Desktop ${version} is ready to install.`,
      detail:
        "Restart to apply the update. You can keep working and restart later if you prefer.",
    });
    if (response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  // Delay slightly so first window can open without competing for network.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn("[auto-update] check failed:", err?.message || err);
    });
  }, 5000);
}
