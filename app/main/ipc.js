const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const {
  HELP_DOCS,
  RENDERER_DIR,
  isInside,
  resolveOpenSourceNoticesPath,
  resolveRendererPath,
} = require("../shared/app-paths");
const { IPC_CHANNELS } = require("../shared/ipc-channels");
const {
  APP_EDITIONS,
  createAppState,
  createUnavailablePurchaseResult,
} = require("../shared/app-editions");
const { CUSTOM_WINDOW_CHROME_ENABLED } = require("./config");
const {
  createExportSaveTargetRegistry,
  ensureExportPathExtension,
  isDefaultExportPath,
  nextAvailableExportPath,
  normalizeExportSaveOptions,
} = require("./export-save-targets");
const { createExportStreamSessionRegistry } = require("./export-stream-sessions");
const { logMain } = require("./logging");
const {
  createTrustedIpcRegistrar,
  trustedRendererRegistry,
} = require("./trusted-ipc");

const ALLOWED_EXTERNAL_URLS = new Set([
  "https://www.patreon.com/cw/SoapyPanels",
  "https://ko-fi.com/soapypanels",
]);

function clampNumber(value, min, max) {
  const num = typeof value === "number" && isFinite(value) ? value : NaN;
  if (!isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function windowFromEvent(event) {
  try {
    return BrowserWindow.fromWebContents(event && event.sender);
  } catch {
    return null;
  }
}

const exportSaveTargets = createExportSaveTargetRegistry();
const exportStreamSessions = createExportStreamSessionRegistry();

function webContentsIdFromEvent(event) {
  const sender = event && event.sender;
  return sender && Number.isInteger(sender.id) ? sender.id : null;
}

function bufferFromIpcPayload(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(new Uint8Array(payload));
  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  throw new Error("Invalid export data.");
}

function registerIpcHandlers(assetStore, monetizationStore, options = {}) {
  const appEdition = options.appEdition || APP_EDITIONS.WINDOWS_STORE;
  const storePurchasesEnabled = appEdition === APP_EDITIONS.WINDOWS_STORE;
  const trustedIpc = createTrustedIpcRegistrar(ipcMain, trustedRendererRegistry, {
    onRejected({ channel, senderId }) {
      logMain(`rejected ipc channel=${channel} senderId=${senderId ?? "unknown"}`);
    },
  });

  function stateFor(monetizationStatus) {
    return createAppState(appEdition, monetizationStatus);
  }

  function uninitializedMonetizationStatus() {
    return {
      available: false,
      source: "unavailable",
      adsDisabled: false,
      ownsRemoveAds: false,
      hasActivePlus: false,
      hasPremiumThemes: false,
      products: {},
      checkedAt: new Date().toISOString(),
      error: "Monetization service is not initialized.",
    };
  }
  trustedIpc.handle(IPC_CHANNELS.GET_STICKERS, () => assetStore.readUserStickers());
  trustedIpc.onSync(IPC_CHANNELS.GET_USER_FONTS, [], (event) => {
    event.returnValue =
      typeof assetStore.readUserFontsCached === "function"
        ? assetStore.readUserFontsCached()
        : assetStore.readUserFonts();
  });
  trustedIpc.handle(IPC_CHANNELS.GET_USER_FONTS_ASYNC, () => {
    if (typeof assetStore.loadUserFontsAsync === "function") {
      return assetStore.loadUserFontsAsync();
    }
    return assetStore.readUserFonts();
  });
  trustedIpc.handle(IPC_CHANNELS.IS_CUSTOM_WINDOW_CHROME_ENABLED, () => {
    return CUSTOM_WINDOW_CHROME_ENABLED;
  });
  trustedIpc.handle(IPC_CHANNELS.GET_APP_ZOOM_FACTOR, (event) => {
    try {
      const wc = event && event.sender;
      return wc && typeof wc.getZoomFactor === "function" ? wc.getZoomFactor() : 1;
    } catch {
      return 1;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.SET_APP_ZOOM_FACTOR, (event, zoomFactor) => {
    try {
      const wc = event && event.sender;
      if (!wc) return 1;
      const next = clampNumber(zoomFactor, 0.5, 2);
      if (typeof wc.setZoomFactor === "function") wc.setZoomFactor(next);
      return typeof wc.getZoomFactor === "function" ? wc.getZoomFactor() : next;
    } catch {
      return 1;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.IS_FULLSCREEN, (event) => {
    try {
      const win = windowFromEvent(event);
      return !!(win && win.isFullScreen());
    } catch {
      return false;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.SET_FULLSCREEN, (event, enabled) => {
    try {
      const win = windowFromEvent(event);
      if (!win) return false;
      win.setFullScreen(!!enabled);
      return !!win.isFullScreen();
    } catch {
      return false;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.TOGGLE_FULLSCREEN, (event) => {
    try {
      const win = windowFromEvent(event);
      if (!win) return false;
      win.setFullScreen(!win.isFullScreen());
      return !!win.isFullScreen();
    } catch {
      return false;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.IS_MAXIMIZED, (event) => {
    try {
      const win = windowFromEvent(event);
      return !!(win && win.isMaximized());
    } catch {
      return false;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    try {
      const win = windowFromEvent(event);
      if (!win) return false;
      win.minimize();
      return true;
    } catch {
      return false;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, (event) => {
    try {
      const win = windowFromEvent(event);
      if (!win) return false;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return !!win.isMaximized();
    } catch {
      return false;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    try {
      const win = windowFromEvent(event);
      if (!win) return false;
      win.close();
      return true;
    } catch {
      return false;
    }
  });
  trustedIpc.handle(IPC_CHANNELS.OPEN_HELP_DOC, async (_event, docId) => {
    try {
      const key = typeof docId === "string" ? docId : "";
      if (key === "licenses") {
        const noticesPath = resolveOpenSourceNoticesPath({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
        });
        if (!fs.existsSync(noticesPath)) {
          return { ok: false, error: "Open source notices were not found." };
        }
        const noticeResult = await shell.openPath(noticesPath);
        if (noticeResult) return { ok: false, error: noticeResult };
        return { ok: true };
      }
      const relPath = HELP_DOCS[key];
      if (!relPath) return { ok: false, error: "Unknown document." };

      const resolvedPath = resolveRendererPath(relPath);
      if (!resolvedPath || !isInside(RENDERER_DIR, resolvedPath)) {
        return { ok: false, error: "Invalid document path." };
      }
      if (!fs.existsSync(resolvedPath)) {
        return { ok: false, error: "Document not found." };
      }

      const result = await shell.openPath(resolvedPath);
      if (result) return { ok: false, error: result };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  trustedIpc.handle(IPC_CHANNELS.OPEN_EXTERNAL_URL, async (_event, url) => {
    try {
      const target = typeof url === "string" ? url : "";
      if (!ALLOWED_EXTERNAL_URLS.has(target)) {
        return { ok: false, error: "External URL is not allowed." };
      }

      await shell.openExternal(target);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  trustedIpc.handle(IPC_CHANNELS.SHOW_EXPORT_SAVE_DIALOG, async (event, options) => {
    let normalized;
    try {
      normalized = normalizeExportSaveOptions(options);
    } catch (err) {
      return { canceled: true, error: err && err.message ? err.message : String(err) };
    }

    const win = windowFromEvent(event);
    const result = await dialog.showSaveDialog(win || undefined, {
      title: "Export",
      defaultPath: normalized.suggestedName,
      filters: normalized.filters,
      properties: ["showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const selectedPath = ensureExportPathExtension(result.filePath, normalized.extensions);
    const automatic = isDefaultExportPath(selectedPath, normalized.suggestedName);
    const filePath = automatic ? nextAvailableExportPath(selectedPath) : selectedPath;
    const webContentsId = webContentsIdFromEvent(event);
    const target = exportSaveTargets.add(filePath, webContentsId, { automatic });
    if (event && event.sender && typeof event.sender.once === "function") {
      event.sender.once("destroyed", () => {
        exportSaveTargets.clearForWebContents(webContentsId);
        exportStreamSessions.clearForWebContents(webContentsId).catch(function () {});
      });
    }
    return {
      canceled: false,
      targetId: target.targetId,
      fileName: target.fileName || path.basename(filePath),
    };
  });
  trustedIpc.handle(IPC_CHANNELS.WRITE_EXPORT_FILE, async (event, targetId, payload) => {
    try {
      const target = exportSaveTargets.consume(targetId, webContentsIdFromEvent(event));
      const buffer = bufferFromIpcPayload(payload);
      let filePath = target.filePath;
      while (true) {
        try {
          await fs.promises.writeFile(filePath, buffer, {
            flag: target.automatic ? "wx" : "w",
          });
          return { ok: true, fileName: path.basename(filePath) };
        } catch (error) {
          if (!target.automatic || !error || error.code !== "EEXIST") throw error;
          filePath = nextAvailableExportPath(filePath);
        }
      }
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : String(err),
      };
    }
  });
  trustedIpc.handle(IPC_CHANNELS.DISCARD_EXPORT_SAVE_TARGET, (event, targetId) => {
    return {
      ok: exportSaveTargets.discard(targetId, webContentsIdFromEvent(event)),
    };
  });
  trustedIpc.handle(IPC_CHANNELS.BEGIN_EXPORT_STREAM, async (event, targetId) => {
    try {
      const webContentsId = webContentsIdFromEvent(event);
      const target = exportSaveTargets.consume(targetId, webContentsId);
      const result = await exportStreamSessions.begin(target, webContentsId);
      return { ok: true, sessionId: result.sessionId };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
  trustedIpc.handle(
    IPC_CHANNELS.WRITE_EXPORT_STREAM_CHUNK,
    async (event, sessionId, position, payload) => {
      try {
        const buffer = bufferFromIpcPayload(payload);
        return await exportStreamSessions.write(
          sessionId,
          webContentsIdFromEvent(event),
          position,
          buffer,
        );
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    },
  );
  trustedIpc.handle(IPC_CHANNELS.FINISH_EXPORT_STREAM, async (event, sessionId) => {
    try {
      return await exportStreamSessions.finish(
        sessionId,
        webContentsIdFromEvent(event),
      );
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
  trustedIpc.handle(IPC_CHANNELS.ABORT_EXPORT_STREAM, async (event, sessionId) => {
    try {
      return {
        ok: await exportStreamSessions.abort(
          sessionId,
          webContentsIdFromEvent(event),
        ),
      };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
  trustedIpc.handle(IPC_CHANNELS.GET_STARTUP_STATE, () => {
    const startupState = storePurchasesEnabled &&
      monetizationStore &&
      typeof monetizationStore.getStartupState === "function"
      ? monetizationStore.getStartupState()
      : { source: "edition", monetizationStatus: null };
    const metrics =
      options.startupMetrics && typeof options.startupMetrics.snapshot === "function"
        ? options.startupMetrics.snapshot()
        : null;
    return {
      ...stateFor(startupState.monetizationStatus),
      source: startupState && startupState.source ? startupState.source : "none",
      mainMetrics: metrics,
    };
  });
  trustedIpc.handle(IPC_CHANNELS.GET_MONETIZATION_STATUS, async () => {
    if (!storePurchasesEnabled) {
      return stateFor(null);
    }
    const status =
      monetizationStore && typeof monetizationStore.queryStatus === "function"
        ? await monetizationStore.queryStatus()
        : uninitializedMonetizationStatus();
    return stateFor(status);
  });
  trustedIpc.handle(IPC_CHANNELS.REFRESH_MONETIZATION_STATUS, async () => {
    if (!storePurchasesEnabled) {
      return stateFor(null);
    }
    const status =
      monetizationStore && typeof monetizationStore.queryStatus === "function"
        ? await monetizationStore.queryStatus()
        : uninitializedMonetizationStatus();
    return stateFor(status);
  });
  trustedIpc.handle(IPC_CHANNELS.PURCHASE_MONETIZATION_PRODUCT, async (event, productId) => {
    if (!storePurchasesEnabled) {
      return createUnavailablePurchaseResult(appEdition);
    }
    if (!monetizationStore || typeof monetizationStore.purchase !== "function") {
      const status = uninitializedMonetizationStatus();
      return {
        ok: false,
        status,
        ...stateFor(status),
        error: "Monetization service is not initialized.",
      };
    }
    const win = windowFromEvent(event);
    const handleBuffer = win && typeof win.getNativeWindowHandle === "function"
      ? win.getNativeWindowHandle()
      : null;
    const result = await monetizationStore.purchase(productId, handleBuffer);
    return {
      ...result,
      ...stateFor(result && result.status ? result.status : null),
    };
  });
}

module.exports = {
  registerIpcHandlers,
};
