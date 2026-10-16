const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getState: () => ipcRenderer.invoke("get-state"),
  chooseWorkspace: () => ipcRenderer.invoke("choose-workspace"),
  setDevice: (deviceId) => ipcRenderer.invoke("set-device", deviceId),
  createProject: (name) => ipcRenderer.invoke("create-project", name),
  saveRecording: (projectDir, bytes) => ipcRenderer.invoke("save-recording", projectDir, bytes),
  readAudio: (file) => ipcRenderer.invoke("read-audio", file),
  readText: (file) => ipcRenderer.invoke("read-text", file),
  readTimeline: (dir) => ipcRenderer.invoke("read-timeline", dir),
  writeTimeline: (dir, content) => ipcRenderer.invoke("write-timeline", dir, content),
  writeText: (file, content) => ipcRenderer.invoke("write-text", file, content),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  narration: (payload) => ipcRenderer.invoke("narration", payload),
  cleanup: (payload) => ipcRenderer.invoke("cleanup", payload),
  applyCuts: (payload) => ipcRenderer.invoke("apply-cuts", payload),
  exportMp3: (payload) => ipcRenderer.invoke("export-mp3", payload),
  showInFolder: (target) => ipcRenderer.invoke("show-in-folder", target),
  createFile: (dir, name) => ipcRenderer.invoke("create-file", dir, name),
  renamePath: (target, nextName) => ipcRenderer.invoke("rename-path", target, nextName),
  removePath: (target) => ipcRenderer.invoke("remove-path", target),
  onWorkspaceChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("workspace-changed", listener);
    return () => ipcRenderer.removeListener("workspace-changed", listener);
  },
});
