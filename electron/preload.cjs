const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grokDesktop", {
  getInfo: () => ipcRenderer.invoke("app:get-info"),
  pickProject: () => ipcRenderer.invoke("project:pick"),
  openProject: (cwd, opts) => ipcRenderer.invoke("project:open", cwd, opts || {}),
  /** Drop agent on this window; title returns to empty shell. */
  closeProject: () => ipcRenderer.invoke("project:close"),
  listSessions: (cwd) => ipcRenderer.invoke("sessions:list", cwd),
  openSession: (opts) => ipcRenderer.invoke("sessions:open", opts || {}),
  prompt: (text, opts) =>
    ipcRenderer.invoke("agent:prompt", {
      text,
      images: opts?.images || [],
    }),
  cancel: () => ipcRenderer.invoke("agent:cancel"),
  respondPermission: (reqId, outcome) =>
    ipcRenderer.invoke("agent:permission-respond", { reqId, outcome }),
  listPendingPermissions: () =>
    ipcRenderer.invoke("agent:list-pending-permissions"),
  respondPlanApproval: (reqId, decision) =>
    ipcRenderer.invoke("agent:plan-approval-respond", { reqId, decision }),
  respondUserQuestion: (reqId, decision) =>
    ipcRenderer.invoke("agent:user-question-respond", { reqId, decision }),
  setAlwaysApprove: (value) =>
    ipcRenderer.invoke("agent:set-always-approve", value),
  setPermissionMode: (value) =>
    ipcRenderer.invoke("agent:set-permission-mode", value),
  setReasoningEffort: (value) =>
    ipcRenderer.invoke("agent:set-reasoning-effort", value),
  setAllowOutsideProject: (value) =>
    ipcRenderer.invoke("agent:set-allow-outside-project", value),
  setSandboxTerminal: (value) =>
    ipcRenderer.invoke("agent:set-sandbox-terminal", value),
  setTheme: (value) => ipcRenderer.invoke("app:set-theme", value),
  setPrivacyMode: (value) => ipcRenderer.invoke("app:set-privacy-mode", value),
  getCodingDataStatus: () => ipcRenderer.invoke("app:get-coding-data"),
  setCodingDataOptIn: (value) =>
    ipcRenderer.invoke("app:set-coding-data-opt-in", value),
  setDebugLogging: (value) => ipcRenderer.invoke("app:set-debug-logging", value),
  openDebugLog: () => ipcRenderer.invoke("app:open-debug-log"),
  getGitBranch: (cwd) => ipcRenderer.invoke("git:branch", cwd),
  readFile: (path) => ipcRenderer.invoke("fs:read-file", path),
  listDir: (path) => ipcRenderer.invoke("fs:list-dir", path),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
  showItem: (path) => ipcRenderer.invoke("shell:show-item", path),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),

  getAuthStatus: () => ipcRenderer.invoke("auth:status"),
  login: (opts) => ipcRenderer.invoke("auth:login", opts || {}),
  cancelLogin: () => ipcRenderer.invoke("auth:cancel-login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  setApiKey: (key) => ipcRenderer.invoke("auth:set-api-key", key),
  openInstallDocs: () => ipcRenderer.invoke("auth:open-install-docs"),
  inspectBackbone: (cwd) => ipcRenderer.invoke("backbone:inspect", cwd),

  on: (channel, handler) => {
    const valid = [
      "agent:session-update",
      "agent:permission-request",
      "agent:permission-dismiss",
      "agent:plan-approval-request",
      "agent:plan-approval-dismiss",
      "agent:user-question-request",
      "agent:user-question-dismiss",
      "agent:permissions-cleared",
      "agent:stderr",
      "agent:error",
      "agent:exit",
      "agent:ready",
      "app:open-settings",
    ];
    if (!valid.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
