const { BrowserWindow } = require("electron");
const { PRELOAD_PATH, APP_ENTRY_URL } = require("../shared/app-paths");
const { IPC_CHANNELS } = require("../shared/ipc-channels");
const { CUSTOM_WINDOW_CHROME_ENABLED } = require("./config");
const { configureApplicationMenu } = require("./menus");
const { trustedRendererRegistry } = require("./trusted-ipc");

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(IPC_CHANNELS.WINDOW_STATE, {
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
    });
  } catch {
    /* ignore */
  }
}

function createWindow(options = {}) {
  const startupMetrics = options.startupMetrics || null;
  if (startupMetrics) startupMetrics.mark("windowCreateStarted");
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#111827",
    frame: !CUSTOM_WINDOW_CHROME_ENABLED,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD_PATH,
      backgroundThrottling: false,
    },
  });
  trustedRendererRegistry.registerWindow(win);
  if (startupMetrics) startupMetrics.mark("windowCreated");

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.webContents.on("will-navigate", (event, url) => {
    try {
      if (typeof url === "string" && url.startsWith("app://")) return;
    } catch {
      /* ignore */
    }
    event.preventDefault();
  });

  win.maximize();

  win.on("maximize", () => sendWindowState(win));
  win.on("unmaximize", () => sendWindowState(win));
  win.on("enter-full-screen", () => sendWindowState(win));
  win.on("leave-full-screen", () => sendWindowState(win));
  win.webContents.on("dom-ready", () => {
    if (startupMetrics) startupMetrics.mark("rendererDomReady");
  });
  win.webContents.on("did-finish-load", () => {
    if (startupMetrics) startupMetrics.mark("rendererLoadFinished");
    sendWindowState(win);
  });
  win.once("ready-to-show", () => {
    if (startupMetrics) startupMetrics.mark("windowReadyToShow");
  });

  configureApplicationMenu(win);
  if (startupMetrics) startupMetrics.mark("navigationStarted");
  win.loadURL(APP_ENTRY_URL);

  return win;
}

module.exports = {
  createWindow,
  sendWindowState,
};
