import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { GrokAcpClient, resolveGrokBinary } from "./acp-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {GrokAcpClient | null} */
let agent = null;
/** @type {Map<string, (outcome: any) => void>} */
const pendingPermissions = new Map();

const storePath = path.join(app.getPath("userData"), "desktop-state.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return {
      recentProjects: [],
      alwaysApprove: false,
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

async function ensureAgent(cwd) {
  if (agent?.ready && agent.cwd === cwd) return agent;
  if (agent) {
    await agent.dispose();
    agent = null;
  }

  const state = loadState();
  agent = new GrokAcpClient({
    cwd,
    alwaysApprove: state.alwaysApprove,
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
  agent.on("exit", (info) => send("agent:exit", info));
  agent.on("ready", (info) => send("agent:ready", info));

  await agent.start();
  return agent;
}

function createWindow() {
  mainWindow = new BrowserWindow({
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
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function registerIpc() {
  ipcMain.handle("app:get-info", async () => {
    const state = loadState();
    return {
      version: app.getVersion(),
      platform: process.platform,
      grokBinary: resolveGrokBinary(),
      userData: app.getPath("userData"),
      alwaysApprove: state.alwaysApprove,
      recentProjects: state.recentProjects || [],
      lastProject: state.lastProject,
      home: os.homedir(),
    };
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

  ipcMain.handle("project:open", async (_e, cwd) => {
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Project path not found: ${cwd}`);
    }
    const state = loadState();
    state.lastProject = cwd;
    state.recentProjects = [
      cwd,
      ...(state.recentProjects || []).filter((p) => p !== cwd),
    ].slice(0, 12);
    saveState(state);

    const client = await ensureAgent(cwd);
    return {
      cwd: client.cwd,
      sessionId: client.sessionId,
      grokBinary: client.grokPath,
    };
  });

  ipcMain.handle("agent:prompt", async (_e, { text }) => {
    if (!agent?.ready) throw new Error("Agent not connected. Open a project first.");
    return agent.prompt(text);
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

  ipcMain.handle("fs:read-file", async (_e, filePath) => {
    return fs.promises.readFile(filePath, "utf8");
  });

  ipcMain.handle("fs:list-dir", async (_e, dirPath) => {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith("."))
      .slice(0, 200)
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name),
      }));
  });

  ipcMain.handle("shell:open-path", async (_e, target) => {
    return shell.openPath(target);
  });

  ipcMain.handle("shell:show-item", async (_e, target) => {
    shell.showItemInFolder(target);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

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
