"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
  status: () => ipcRenderer.invoke("bridge:status"),
});
