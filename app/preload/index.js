const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed preloads cannot import local CommonJS modules. Keep this literal map
// synchronized with app/shared/ipc-channels.js; check:structure enforces parity.
const IPC_CHANNELS = Object.freeze({
  GET_STICKERS: "soapy:getStickers",
  STICKERS_CHANGED: "soapy:stickersChanged",
  GET_USER_FONTS: "soapy:getUserFonts",
  GET_USER_FONTS_ASYNC: "soapy:getUserFontsAsync",
  USER_FONTS_CHANGED: "soapy:userFontsChanged",
  IS_CUSTOM_WINDOW_CHROME_ENABLED: "soapy:isCustomWindowChromeEnabled",
  GET_APP_ZOOM_FACTOR: "soapy:getAppZoomFactor",
  SET_APP_ZOOM_FACTOR: "soapy:setAppZoomFactor",
  IS_FULLSCREEN: "soapy:isFullscreen",
  SET_FULLSCREEN: "soapy:setFullscreen",
  TOGGLE_FULLSCREEN: "soapy:toggleFullscreen",
  IS_MAXIMIZED: "soapy:isMaximized",
  WINDOW_MINIMIZE: "soapy:windowMinimize",
  WINDOW_TOGGLE_MAXIMIZE: "soapy:windowToggleMaximize",
  WINDOW_CLOSE: "soapy:windowClose",
  OPEN_HELP_DOC: "soapy:openHelpDoc",
  OPEN_EXTERNAL_URL: "soapy:openExternalUrl",
  SHOW_EXPORT_SAVE_DIALOG: "soapy:showExportSaveDialog",
  WRITE_EXPORT_FILE: "soapy:writeExportFile",
  DISCARD_EXPORT_SAVE_TARGET: "soapy:discardExportSaveTarget",
  BEGIN_EXPORT_STREAM: "soapy:beginExportStream",
  WRITE_EXPORT_STREAM_CHUNK: "soapy:writeExportStreamChunk",
  FINISH_EXPORT_STREAM: "soapy:finishExportStream",
  ABORT_EXPORT_STREAM: "soapy:abortExportStream",
  GET_STARTUP_STATE: "soapy:getStartupState",
  GET_MONETIZATION_STATUS: "soapy:getMonetizationStatus",
  PURCHASE_MONETIZATION_PRODUCT: "soapy:purchaseMonetizationProduct",
  REFRESH_MONETIZATION_STATUS: "soapy:refreshMonetizationStatus",
  WINDOW_STATE: "soapy:windowState",
  PROJECT_HISTORY_COMMAND: "soapy:projectHistoryCommand",
});

contextBridge.exposeInMainWorld("electronApi", {
  getUserFonts: () => {
    try {
      return ipcRenderer.sendSync(IPC_CHANNELS.GET_USER_FONTS) || [];
    } catch {
      return [];
    }
  },
  getUserFontsAsync: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_USER_FONTS_ASYNC).catch(() => []),
  onUserFontsChanged: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(IPC_CHANNELS.USER_FONTS_CHANGED, (_event, fonts) => cb(fonts));
  },
  getStickers: () => ipcRenderer.invoke(IPC_CHANNELS.GET_STICKERS),
  onStickersChanged: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(IPC_CHANNELS.STICKERS_CHANGED, (_event, stickers) => cb(stickers));
  },
  isCustomWindowChromeEnabled: () =>
    ipcRenderer.invoke(IPC_CHANNELS.IS_CUSTOM_WINDOW_CHROME_ENABLED),
  getAppZoomFactor: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_ZOOM_FACTOR),
  setAppZoomFactor: (zoomFactor) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_APP_ZOOM_FACTOR, zoomFactor),
  isFullscreen: () => ipcRenderer.invoke(IPC_CHANNELS.IS_FULLSCREEN),
  setFullscreen: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.SET_FULLSCREEN, enabled),
  toggleFullscreen: () => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_FULLSCREEN),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.IS_MAXIMIZED),
  windowMinimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  windowToggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
  windowClose: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  openHelpDoc: (docId) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_HELP_DOC, docId),
  openExternalUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_URL, url),
  showExportSaveDialog: (options) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHOW_EXPORT_SAVE_DIALOG, options),
  writeExportFile: (targetId, arrayBuffer) =>
    ipcRenderer.invoke(IPC_CHANNELS.WRITE_EXPORT_FILE, targetId, arrayBuffer),
  discardExportSaveTarget: (targetId) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISCARD_EXPORT_SAVE_TARGET, targetId),
  beginExportStream: (targetId) =>
    ipcRenderer.invoke(IPC_CHANNELS.BEGIN_EXPORT_STREAM, targetId),
  writeExportStreamChunk: (sessionId, position, arrayBuffer) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.WRITE_EXPORT_STREAM_CHUNK,
      sessionId,
      position,
      arrayBuffer,
    ),
  finishExportStream: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.FINISH_EXPORT_STREAM, sessionId),
  abortExportStream: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.ABORT_EXPORT_STREAM, sessionId),
  getStartupState: () => ipcRenderer.invoke(IPC_CHANNELS.GET_STARTUP_STATE),
  getMonetizationStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MONETIZATION_STATUS),
  purchaseMonetizationProduct: (productId) =>
    ipcRenderer.invoke(IPC_CHANNELS.PURCHASE_MONETIZATION_PRODUCT, productId),
  refreshMonetizationStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.REFRESH_MONETIZATION_STATUS),
  onWindowStateChanged: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(IPC_CHANNELS.WINDOW_STATE, (_event, state) => cb(state));
  },
  onProjectHistoryCommand: (cb) => {
    if (typeof cb !== "function") return;
    ipcRenderer.on(IPC_CHANNELS.PROJECT_HISTORY_COMMAND, (_event, command) => cb(command));
  },
});
