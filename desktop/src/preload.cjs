// Exposes the bare minimum to the web UI: where the local video server is,
// opening links in the system browser, and Google login results.
// (Sandboxed preload: no Node access leaks into the page.)
const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("desktop:info");

contextBridge.exposeInMainWorld("desktop", {
  ...info,
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  /** Casting to Chromecast / DLNA TVs on the local network. */
  openLocalNetworkSettings: () => ipcRenderer.invoke("desktop:open-local-network-settings"),
  cast: {
    list: () => ipcRenderer.invoke("cast:list"),
    refresh: () => ipcRenderer.invoke("cast:refresh"),
    play: (deviceId, media) => ipcRenderer.invoke("cast:play", deviceId, media),
    pause: () => ipcRenderer.invoke("cast:pause"),
    resume: () => ipcRenderer.invoke("cast:resume"),
    seek: (t) => ipcRenderer.invoke("cast:seek", t),
    stop: () => ipcRenderer.invoke("cast:stop"),
    onDevices: (callback) => {
      const l = (_e, devices) => callback(devices);
      ipcRenderer.on("cast:devices", l);
      return () => ipcRenderer.removeListener("cast:devices", l);
    },
    onStatus: (callback) => {
      const l = (_e, status) => callback(status);
      ipcRenderer.on("cast:status", l);
      return () => ipcRenderer.removeListener("cast:status", l);
    },
  },
  /** Called with { token, error } when the browser returns from Google. */
  onAuth: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:auth", listener);
    return () => ipcRenderer.removeListener("desktop:auth", listener);
  },
});
