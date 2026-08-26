const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("previewChrome", {
  ready: (payload) => ipcRenderer.invoke("preview:chrome-ready", payload),
  navigate: (url) => ipcRenderer.invoke("preview:chrome-navigate", url),
  back: () => ipcRenderer.invoke("preview:chrome-back"),
  forward: () => ipcRenderer.invoke("preview:chrome-forward"),
  reload: () => ipcRenderer.invoke("preview:chrome-reload"),
  setViewport: (id) => ipcRenderer.invoke("preview:chrome-viewport", id),
  snapshot: () => ipcRenderer.invoke("preview:chrome-snapshot"),
  screenshot: () => ipcRenderer.invoke("preview:chrome-screenshot"),
  openExternal: () => ipcRenderer.invoke("preview:chrome-open-external"),
  network: () => ipcRenderer.invoke("preview:chrome-network"),
  networkEntry: (id) => ipcRenderer.invoke("preview:chrome-network-entry", id),
  networkClear: () => ipcRenderer.invoke("preview:chrome-network-clear"),
  networkPreserve: (on) =>
    ipcRenderer.invoke("preview:chrome-network-preserve", on),
  onState: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on("preview:state", listener);
    return () => ipcRenderer.removeListener("preview:state", listener);
  },
  onTheme: (handler) => {
    const listener = (_e, theme) => handler(theme);
    ipcRenderer.on("preview:theme", listener);
    return () => ipcRenderer.removeListener("preview:theme", listener);
  },
  onNetwork: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on("preview:network", listener);
    return () => ipcRenderer.removeListener("preview:network", listener);
  },
});
