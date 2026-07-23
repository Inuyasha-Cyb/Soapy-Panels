const { APP_ENTRY_URL } = require("../shared/app-paths");

const UNAUTHORIZED_IPC_ERROR = "Unauthorized IPC request.";

function isCanonicalAppEntryUrl(value) {
  try {
    const url = new URL(value);
    const expected = new URL(APP_ENTRY_URL);
    return (
      url.protocol === expected.protocol &&
      url.hostname === expected.hostname &&
      url.pathname === "/" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function createTrustedRendererRegistry() {
  const windowsByWebContents = new WeakMap();

  function unregister(webContents) {
    if (webContents && typeof webContents === "object") {
      windowsByWebContents.delete(webContents);
    }
  }

  function registerWindow(win) {
    const webContents = win && win.webContents;
    if (!webContents) throw new TypeError("A BrowserWindow with webContents is required.");

    windowsByWebContents.set(webContents, win);
    if (typeof webContents.once === "function") {
      webContents.once("destroyed", () => unregister(webContents));
    }
    if (typeof win.once === "function") {
      win.once("closed", () => unregister(webContents));
    }
    return win;
  }

  function isTrustedEvent(event) {
    const sender = event && event.sender;
    const senderFrame = event && event.senderFrame;
    if (!sender || !senderFrame) return false;

    const win = windowsByWebContents.get(sender);
    if (!win || win.webContents !== sender) return false;
    if (typeof win.isDestroyed === "function" && win.isDestroyed()) return false;
    if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) return false;
    if (!sender.mainFrame || senderFrame !== sender.mainFrame) return false;

    return isCanonicalAppEntryUrl(senderFrame.url);
  }

  return {
    isTrustedEvent,
    registerWindow,
    unregister,
  };
}

function createTrustedIpcRegistrar(ipcMain, registry, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function" || typeof ipcMain.on !== "function") {
    throw new TypeError("ipcMain handle and on methods are required.");
  }
  if (!registry || typeof registry.isTrustedEvent !== "function") {
    throw new TypeError("A trusted renderer registry is required.");
  }

  const onRejected =
    typeof options.onRejected === "function" ? options.onRejected : () => {};

  function reject(event, channel) {
    onRejected({
      channel,
      senderId:
        event && event.sender && Number.isInteger(event.sender.id)
          ? event.sender.id
          : null,
    });
  }

  function handle(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!registry.isTrustedEvent(event)) {
        reject(event, channel);
        throw new Error(UNAUTHORIZED_IPC_ERROR);
      }
      return listener(event, ...args);
    });
  }

  function onSync(channel, fallbackValue, listener) {
    ipcMain.on(channel, (event, ...args) => {
      if (!registry.isTrustedEvent(event)) {
        reject(event, channel);
        event.returnValue = fallbackValue;
        return;
      }
      listener(event, ...args);
    });
  }

  return {
    handle,
    onSync,
  };
}

const trustedRendererRegistry = createTrustedRendererRegistry();

module.exports = {
  UNAUTHORIZED_IPC_ERROR,
  createTrustedIpcRegistrar,
  createTrustedRendererRegistry,
  isCanonicalAppEntryUrl,
  trustedRendererRegistry,
};
