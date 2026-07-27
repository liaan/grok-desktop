import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  Menu,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { GrokAcpClient } from "./acp-client.mjs";
import {
  cancelLogin,
  getAuthStatus,
  setSessionApiKey,
  startLogin,
  startLogout,
} from "./auth.mjs";
import { inspectBackbone } from "./backbone.mjs";
import { resolveGrokBinary, grokHomeDir } from "./grok-home.mjs";
import { setupAutoUpdater } from "./auto-update.mjs";
import {
  listSessionsForCwd,
  loadTimelineFromDisk,
  mostRecentSession,
} from "./sessions.mjs";
import { assertPathInProject } from "./path-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {GrokAcpClient | null} */
let agent = null;
/** @type {Map<string, (outcome: any) => void>} */
const pendingPermissions = new Map();
/** Serialize agent lifecycle (open/switch/dispose). */
let agentChain = Promise.resolve();

const storePath = path.join(app.getPath("userData"), "desktop-state.json");

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return {
      recentProjects: [],
      alwaysApprove: false,
      /** When false (default), agent FS + terminal cwd cannot leave project root */
      allowOutsideProject: false,
      lastProject: null,
      ...raw,
    };
  } catch {
    return {
      recentProjects: [],
      alwaysApprove: false,
      allowOutsideProject: false,
      lastProject: null,
    };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2));
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function clearPendingPermissions() {
  for (const [, respond] of pendingPermissions) {
    try {
      respond({ outcome: { outcome: "cancelled" } });
    } catch {
      /* ignore */
    }
  }
  pendingPermissions.clear();
}

/**
 * Ensure agent process for cwd, optionally resuming a CLI session.
 * Serialized — concurrent open/switch cannot race dispose/start.
 * @param {string} cwd
 * @param {{ resumeSessionId?: string | null, forceNew?: boolean }} [opts]
 */
function ensureAgent(cwd, opts = {}) {
  const run = async () => {
    const resumeSessionId = opts.resumeSessionId || null;
    const forceNew = Boolean(opts.forceNew);

    if (agent?.ready && agent.cwd === cwd && agent.proc) {
      if (forceNew) {
        clearPendingPermissions();
        await agent.newSession();
        return agent;
      }
      if (resumeSessionId && resumeSessionId !== agent.sessionId) {
        clearPendingPermissions();
        await agent.loadSession(resumeSessionId);
        return agent;
      }
      if (resumeSessionId && resumeSessionId === agent.sessionId) {
        return agent;
      }
      if (!resumeSessionId && !forceNew) {
        return agent;
      }
    }

    if (agent) {
      clearPendingPermissions();
      await agent.dispose();
      agent = null;
    }

    const state = loadState();
    agent = new GrokAcpClient({
      cwd,
      alwaysApprove: state.alwaysApprove,
      allowOutsideProject: Boolean(state.allowOutsideProject),
      clientVersion: app.getVersion(),
    });

    agent.on("session-update", (params) => {
      send("agent:session-update", params);
    });

    agent.on("permission-request", ({ params, respond }) => {
      const reqId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pendingPermissions.set(reqId, respond);
      send("agent:permission-request", { reqId, params });
    });

    agent.on("stderr", (text) => send("agent:stderr", text));
    agent.on("error", (err) =>
      send("agent:error", { message: err?.message || String(err) }),
    );
    agent.on("exit", (info) => {
      clearPendingPermissions();
      send("agent:exit", info);
    });
    // Do not push agent:ready for conn — renderer only trusts open IPC results
    agent.on("ready", (info) => send("agent:ready", info));

    await agent.start({
      resumeSessionId: forceNew ? null : resumeSessionId,
    });
    return agent;
  };

  const next = agentChain.then(run, run);
  agentChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function rememberProjectSession(cwd, sessionId) {
  if (!cwd || !sessionId) return;
  const state = loadState();
  state.lastProject = cwd;
  state.recentProjects = [
    cwd,
    ...(state.recentProjects || []).filter((p) => p !== cwd),
  ].slice(0, 12);
  state.sessionsByProject = state.sessionsByProject || {};
  state.sessionsByProject[cwd] = sessionId;
  saveState(state);
}

/**
 * Standard app menu with Edit roles.
 * Without role-based Cut/Copy/Paste/Select All, Cmd/Ctrl+V often does nothing
 * in packaged Electron apps (macOS especially).
 */
function installApplicationMenu() {
  const isMac = process.platform === "darwin";
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ]
          : [{ role: "close" }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for updates…",
          click: () => {
            shell.openExternal(
              "https://github.com/liaan/grok-desktop/releases/latest",
            );
          },
        },
        {
          label: "Open Releases page",
          click: () => {
            shell.openExternal(
              "https://github.com/liaan/grok-desktop/releases",
            );
          },
        },
        { type: "separator" },
        {
          label: "Install guide (Mac “damaged” fix)",
          click: () => {
            shell.openExternal(
              "https://github.com/liaan/grok-desktop#mac-damaged-and-cant-be-opened",
            );
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  /** @type {import('electron').BrowserWindowConstructorOptions} */
  const winOpts = {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Grok Desktop",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0c0c0f" : "#f6f6f8",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  // Sit traffic lights in the brand top band (matches .platform-darwin sidebar padding)
  if (process.platform === "darwin") {
    winOpts.trafficLightPosition = { x: 14, y: 16 };
  }

  mainWindow = new BrowserWindow(winOpts);

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Never open data:/blob: via openExternal
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Keep navigation inside the app shell; open http(s) externally
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed =
      url.startsWith("http://127.0.0.1:") ||
      url.startsWith("http://localhost:") ||
      url.startsWith("file://");
    if (allowed) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });
}

function registerIpc() {
  ipcMain.handle("app:get-info", async () => {
    const state = loadState();
    const auth = getAuthStatus();
    return {
      version: app.getVersion(),
      platform: process.platform,
      grokBinary: resolveGrokBinary(),
      grokHome: grokHomeDir(),
      userData: app.getPath("userData"),
      alwaysApprove: state.alwaysApprove,
      allowOutsideProject: Boolean(state.allowOutsideProject),
      recentProjects: state.recentProjects || [],
      lastProject: state.lastProject,
      home: os.homedir(),
      auth,
    };
  });

  ipcMain.handle("auth:status", async () => getAuthStatus());

  ipcMain.handle("auth:login", async (_e, opts = {}) => {
    try {
      const result = await startLogin({
        deviceAuth: Boolean(opts?.deviceAuth),
      });
      return result;
    } catch (err) {
      return {
        ok: false,
        status: getAuthStatus(),
        error: err?.message || String(err),
      };
    }
  });

  ipcMain.handle("auth:cancel-login", async () => {
    cancelLogin();
    return getAuthStatus();
  });

  ipcMain.handle("auth:logout", async () => {
    try {
      return await startLogout();
    } catch (err) {
      return {
        ok: false,
        status: getAuthStatus(),
        message: err?.message || String(err),
      };
    }
  });

  ipcMain.handle("auth:set-api-key", async (_e, key) => {
    const ok = setSessionApiKey(key);
    return { ok, status: getAuthStatus() };
  });

  ipcMain.handle("auth:open-install-docs", async () => {
    await shell.openExternal("https://docs.x.ai/build/overview");
    return true;
  });

  ipcMain.handle("backbone:inspect", async (_e, cwd) => {
    return inspectBackbone(cwd || process.cwd());
  });

  ipcMain.handle("project:pick", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Open project folder",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const cwd = result.filePaths[0];
    const state = loadState();
    state.lastProject = cwd;
    state.recentProjects = [
      cwd,
      ...(state.recentProjects || []).filter((p) => p !== cwd),
    ].slice(0, 12);
    saveState(state);
    return cwd;
  });

  /**
   * Open a project and attach an ACP session.
   * @param {string} cwd
   * @param {{ mode?: 'continue' | 'new' | 'resume', sessionId?: string }} [opts]
   *   - continue (default): resume most recent session for cwd (CLI `-c`)
   *   - new: brand-new session (CLI `/new`)
   *   - resume: load opts.sessionId (CLI `--resume id`)
   */
  ipcMain.handle("project:open", async (_e, cwd, opts = {}) => {
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Project path not found: ${cwd}`);
    }

    const mode = opts?.mode || "continue";
    let resumeSessionId = null;
    let forceNew = false;

    if (mode === "new") {
      forceNew = true;
    } else if (mode === "resume" && opts?.sessionId) {
      resumeSessionId = opts.sessionId;
    } else {
      // continue — CLI `-c`: most recent on disk by lastActiveAt
      resumeSessionId = mostRecentSession(cwd)?.id || null;
    }

    let client;
    try {
      client = await ensureAgent(cwd, {
        resumeSessionId,
        forceNew,
      });
    } catch (err) {
      // Corrupt / missing session — fall back to a new chat
      if (resumeSessionId && !forceNew) {
        console.warn(
          "[project:open] resume failed, starting new session:",
          err?.message || err,
        );
        client = await ensureAgent(cwd, { forceNew: true });
        resumeSessionId = null;
        forceNew = true;
      } else {
        throw err;
      }
    }

    rememberProjectSession(cwd, client.sessionId);

    let history = [];
    if (client.sessionId && !forceNew) {
      const loaded = loadTimelineFromDisk(cwd, client.sessionId);
      history = loaded.items || [];
    }

    const sessions = listSessionsForCwd(cwd);

    return {
      cwd: client.cwd,
      sessionId: client.sessionId,
      grokBinary: client.grokPath,
      resumed: Boolean(resumeSessionId) && !forceNew,
      history,
      sessions,
    };
  });

  ipcMain.handle("sessions:list", async (_e, cwd) => {
    if (!cwd) return [];
    return listSessionsForCwd(cwd);
  });

  ipcMain.handle("sessions:open", async (_e, { cwd, sessionId, mode }) => {
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Project path not found: ${cwd}`);
    }
    let forceNew = mode === "new";
    let resumeSessionId = forceNew ? null : sessionId;
    let client;
    let resumeWarning = null;
    try {
      client = await ensureAgent(cwd, {
        resumeSessionId,
        forceNew,
      });
    } catch (err) {
      if (resumeSessionId && !forceNew) {
        console.warn(
          "[sessions:open] resume failed, starting new session:",
          err?.message || err,
        );
        resumeWarning =
          err?.message ||
          "Could not resume that chat; started a new session.";
        client = await ensureAgent(cwd, { forceNew: true });
        forceNew = true;
        resumeSessionId = null;
      } else {
        throw err;
      }
    }
    rememberProjectSession(cwd, client.sessionId);

    let history = [];
    if (!forceNew && client.sessionId) {
      history = loadTimelineFromDisk(cwd, client.sessionId).items || [];
    }

    return {
      cwd: client.cwd,
      sessionId: client.sessionId,
      grokBinary: client.grokPath,
      resumed: Boolean(resumeSessionId) && !forceNew,
      history,
      sessions: listSessionsForCwd(cwd),
      warning: resumeWarning,
    };
  });

  ipcMain.handle("agent:prompt", async (_e, { text, images = [] }) => {
    if (!agent?.ready) throw new Error("Agent not connected. Open a project first.");
    return agent.prompt(text, { images });
  });

  ipcMain.handle("agent:cancel", async () => {
    agent?.cancel();
    return true;
  });

  ipcMain.handle("agent:permission-respond", async (_e, { reqId, outcome }) => {
    const respond = pendingPermissions.get(reqId);
    if (!respond) return false;
    pendingPermissions.delete(reqId);
    respond(outcome);
    return true;
  });

  ipcMain.handle("agent:set-always-approve", async (_e, value) => {
    const state = loadState();
    state.alwaysApprove = Boolean(value);
    saveState(state);
    agent?.setAlwaysApprove(state.alwaysApprove);
    return state.alwaysApprove;
  });

  ipcMain.handle("agent:set-allow-outside-project", async (_e, value) => {
    const state = loadState();
    state.allowOutsideProject = Boolean(value);
    saveState(state);
    agent?.setAllowOutsideProject(state.allowOutsideProject);
    return state.allowOutsideProject;
  });

  ipcMain.handle("fs:read-file", async (_e, filePath) => {
    const root = agent?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, filePath);
    return fs.promises.readFile(safe, "utf8");
  });

  ipcMain.handle("fs:list-dir", async (_e, dirPath) => {
    const root = agent?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, dirPath);
    const entries = await fs.promises.readdir(safe, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith("."))
      .slice(0, 200)
      .map((e) => {
        // Treat symlinks-to-dirs as directories so the browser can enter them
        // (still gated by assertPathInProject on the next listDir).
        let isDirectory = e.isDirectory();
        if (!isDirectory && e.isSymbolicLink()) {
          try {
            isDirectory = fs.statSync(path.join(safe, e.name)).isDirectory();
          } catch {
            isDirectory = false;
          }
        }
        return {
          name: e.name,
          isDirectory,
          path: path.join(safe, e.name),
        };
      });
  });

  // Renderer shell helpers are always project-scoped (ignore allowOutsideProject).
  ipcMain.handle("shell:open-path", async (_e, target) => {
    const root = agent?.cwd;
    if (!root) throw new Error("No project open");
    return shell.openPath(assertPathInProject(root, target));
  });

  ipcMain.handle("shell:show-item", async (_e, target) => {
    const root = agent?.cwd;
    if (!root) throw new Error("No project open");
    shell.showItemInFolder(assertPathInProject(root, target));
  });

  ipcMain.handle("shell:open-external", async (_e, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      throw new Error("Only http(s) URLs are allowed");
    }
    await shell.openExternal(url);
    return true;
  });
}

app.whenReady().then(() => {
  installApplicationMenu();
  registerIpc();
  createWindow();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  if (agent) {
    await agent.dispose();
    agent = null;
  }
});
