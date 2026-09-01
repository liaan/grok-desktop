const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grokDesktop", {
  /** First React paint — main may now show the shell and drop the native splash. */
  windowReady: () => ipcRenderer.send("window:ready"),
  getInfo: () => ipcRenderer.invoke("app:get-info"),
  pickProject: () => ipcRenderer.invoke("project:pick"),
  openProject: (cwd, opts) => ipcRenderer.invoke("project:open", cwd, opts || {}),
  listOpenCheckouts: () => ipcRenderer.invoke("project:list-open"),
  focusProjectWindow: (windowId) =>
    ipcRenderer.invoke("project:focus-window", windowId),
  takePendingOpen: () => ipcRenderer.invoke("project:take-pending-open"),
  openProjectInNewWindow: (cwd) =>
    ipcRenderer.invoke("window:open-project-in-new", cwd),
  inspectCheckout: (cwd) => ipcRenderer.invoke("git:inspect-checkout", cwd),
  createWorktree: (opts) => ipcRenderer.invoke("worktree:create", opts || {}),
  /** Drop agent on this window; title returns to empty shell. */
  closeProject: () => ipcRenderer.invoke("project:close"),
  /** Respawn grok agent on this window and resume the same chat. */
  restartAgent: () => ipcRenderer.invoke("agent:restart"),
  listSessions: (cwd) => ipcRenderer.invoke("sessions:list", cwd),
  renameSession: (opts) => ipcRenderer.invoke("sessions:rename", opts || {}),
  deleteSession: (opts) => ipcRenderer.invoke("sessions:delete", opts || {}),
  openSession: (opts) => ipcRenderer.invoke("sessions:open", opts || {}),
  prompt: (text, opts) =>
    ipcRenderer.invoke("agent:prompt", {
      text,
      images: opts?.images || [],
      imageQuality: opts?.imageQuality || "compact",
    }),
  cancel: () => ipcRenderer.invoke("agent:cancel"),
  compact: (hint) => ipcRenderer.invoke("agent:compact", hint || ""),
  respondPermission: (reqId, outcome) =>
    ipcRenderer.invoke("agent:permission-respond", { reqId, outcome }),
  setAllowWritesThisSession: (value) =>
    ipcRenderer.invoke("agent:set-allow-writes-session", value),
  listPendingPermissions: () =>
    ipcRenderer.invoke("agent:list-pending-permissions"),
  respondPlanApproval: (reqId, decision) =>
    ipcRenderer.invoke("agent:plan-approval-respond", { reqId, decision }),
  respondUserQuestion: (reqId, decision) =>
    ipcRenderer.invoke("agent:user-question-respond", { reqId, decision }),
  respondFolderTrust: (reqId, decision) =>
    ipcRenderer.invoke("agent:folder-trust-respond", { reqId, decision }),
  respondMcpElicit: (reqId, decision) =>
    ipcRenderer.invoke("agent:mcp-elicit-respond", { reqId, decision }),
  setAlwaysApprove: (value) =>
    ipcRenderer.invoke("agent:set-always-approve", value),
  setPermissionMode: (value) =>
    ipcRenderer.invoke("agent:set-permission-mode", value),
  setReasoningEffort: (value) =>
    ipcRenderer.invoke("agent:set-reasoning-effort", value),
  setModel: (modelId) => ipcRenderer.invoke("agent:set-model", modelId),
  setAllowOutsideProject: (value) =>
    ipcRenderer.invoke("agent:set-allow-outside-project", value),
  setSandboxTerminal: (value) =>
    ipcRenderer.invoke("agent:set-sandbox-terminal", value),
  setTheme: (value) => ipcRenderer.invoke("app:set-theme", value),
  setPrivacyMode: (value) => ipcRenderer.invoke("app:set-privacy-mode", value),
  setAutoCompactAt: (value) =>
    ipcRenderer.invoke("app:set-auto-compact-at", value),
  getCodingDataStatus: () => ipcRenderer.invoke("app:get-coding-data"),
  setCodingDataOptIn: (value) =>
    ipcRenderer.invoke("app:set-coding-data-opt-in", value),
  setAllowPrerelease: (value) =>
    ipcRenderer.invoke("app:set-allow-prerelease", value),
  setDebugLogging: (value) => ipcRenderer.invoke("app:set-debug-logging", value),
  openDebugLog: () => ipcRenderer.invoke("app:open-debug-log"),
  openCrashLog: () => ipcRenderer.invoke("app:open-crash-log"),
  getGitBranch: (cwd) => ipcRenderer.invoke("git:branch", cwd),
  getGitStatus: (cwd) => ipcRenderer.invoke("git:status", cwd),
  getGitDiff: (path, opts) => ipcRenderer.invoke("git:diff", path, opts || {}),
  readFile: (path) => ipcRenderer.invoke("fs:read-file", path),
  writeFile: (path, content) =>
    ipcRenderer.invoke("fs:write-file", path, content),
  listDir: (path) => ipcRenderer.invoke("fs:list-dir", path),
  openPath: (path) => ipcRenderer.invoke("shell:open-editor", path),
  openInEditor: (path) => ipcRenderer.invoke("shell:open-editor", path),
  listEditors: () => ipcRenderer.invoke("editor:list"),
  setExternalEditor: (id) => ipcRenderer.invoke("app:set-external-editor", id),
  showItem: (path) => ipcRenderer.invoke("shell:show-item", path),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  openPreview: (url) =>
    ipcRenderer.invoke("preview:open", url ? { url } : {}),
  closePreview: () => ipcRenderer.invoke("preview:close"),
  previewState: () => ipcRenderer.invoke("preview:state"),
  previewSnapshot: () => ipcRenderer.invoke("preview:snapshot"),

  getAuthStatus: () => ipcRenderer.invoke("auth:status"),
  login: (opts) => ipcRenderer.invoke("auth:login", opts || {}),
  cancelLogin: () => ipcRenderer.invoke("auth:cancel-login"),
  submitLoginInput: (text) =>
    ipcRenderer.invoke("auth:submit-login-input", text),
  logout: () => ipcRenderer.invoke("auth:logout"),
  setApiKey: (key) => ipcRenderer.invoke("auth:set-api-key", key),
  openInstallDocs: () => ipcRenderer.invoke("auth:open-install-docs"),
  inspectBackbone: (cwd) => ipcRenderer.invoke("backbone:inspect", cwd),
  getGrokEngine: () => ipcRenderer.invoke("grok:engine"),
  checkGrokUpdate: () => ipcRenderer.invoke("grok:update-check"),
  installGrokUpdate: () => ipcRenderer.invoke("grok:update-install"),
  listMcpServers: (opts) => ipcRenderer.invoke("mcp:list", opts || {}),
  addMcpServer: (spec) => ipcRenderer.invoke("mcp:add", spec || {}),
  enableMcpServer: (name) => ipcRenderer.invoke("mcp:enable", name),
  disableMcpServer: (name) => ipcRenderer.invoke("mcp:disable", name),
  removeMcpServer: (name, opts) =>
    ipcRenderer.invoke("mcp:remove", { name, scope: opts?.scope }),
  doctorMcp: (name) => ipcRenderer.invoke("mcp:doctor", name),
  authenticateMcpServer: (name) => ipcRenderer.invoke("mcp:auth", name),
  logoutMcpServer: (name) => ipcRenderer.invoke("mcp:logout", name),
  setSettingsOpen: (open) => ipcRenderer.invoke("settings:set-open", Boolean(open)),
  listPlugins: () => ipcRenderer.invoke("plugin:list"),
  enablePlugin: (name) => ipcRenderer.invoke("plugin:enable", name),
  disablePlugin: (name) => ipcRenderer.invoke("plugin:disable", name),
  installPlugin: (source) => ipcRenderer.invoke("plugin:install", source),
  writeClipboard: (payload) => ipcRenderer.invoke("clipboard:write", payload || {}),

  on: (channel, handler) => {
    const valid = [
      "agent:session-update",
      "agent:mcp-status",
      "agent:permission-request",
      "agent:permission-dismiss",
      "agent:plan-approval-request",
      "agent:plan-approval-dismiss",
      "agent:user-question-request",
      "agent:user-question-dismiss",
      "agent:folder-trust-request",
      "agent:folder-trust-dismiss",
      "agent:mcp-elicit-request",
      "agent:mcp-elicit-dismiss",
      "agent:permission-mode",
      "agent:permissions-cleared",
      "agent:writes-session",
      "agent:stderr",
      "agent:error",
      "agent:exit",
      "agent:ready",
      "app:open-settings",
      "app:close-settings",
      "app:open-checkouts",
      "app:new-worktree",
      "auth:login-progress",
      "preview:changed",
      "preview:viewport-capture",
    ];
    if (!valid.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
