const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grokDesktop", {
  getInfo: () => ipcRenderer.invoke("app:get-info"),
  pickProject: () => ipcRenderer.invoke("project:pick"),
  openProject: (cwd) => ipcRenderer.invoke("project:open", cwd),
  prompt: (text) => ipcRenderer.invoke("agent:prompt", { text }),
  cancel: () => ipcRenderer.invoke("agent:cancel"),
  respondPermission: (reqId, outcome) =>
    ipcRenderer.invoke("agent:permission-respond", { reqId, outcome }),
  setAlwaysApprove: (value) =>
    ipcRenderer.invoke("agent:set-always-approve", value),
  readFile: (path) => ipcRenderer.invoke("fs:read-file", path),
  listDir: (path) => ipcRenderer.invoke("fs:list-dir", path),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
  showItem: (path) => ipcRenderer.invoke("shell:show-item", path),

  on: (channel, handler) => {
    const valid = [
      "agent:session-update",
      "agent:permission-request",
      "agent:stderr",
      "agent:error",
      "agent:exit",
      "agent:ready",
    ];
    if (!valid.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
