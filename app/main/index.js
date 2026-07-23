const { app, BrowserWindow, protocol } = require("electron");
const { IPC_CHANNELS } = require("../shared/ipc-channels");
const {
  configureProcessFlags,
  resolveDevelopmentEntitlement,
} = require("./config");
const {
  logMain,
  registerAppProcessLogging,
  registerProcessErrorLogging,
} = require("./logging");
const {
  registerAppFileProtocol,
  registerAppProtocolPrivileges,
} = require("./protocol");
const { createWindow } = require("./window");
const { createUserAssetStore } = require("./user-assets");
const { registerIpcHandlers } = require("./ipc");
const { resolveAppEdition } = require("./app-edition");
const { APP_EDITIONS } = require("../shared/app-editions");
const {
  STARTUP_METRICS_ENV_VAR,
  createStartupMetrics,
} = require("./startup-metrics");

const startupMetrics = createStartupMetrics({
  enabled: process.env[STARTUP_METRICS_ENV_VAR] === "1",
  log: logMain,
});
startupMetrics.mark("mainEntry");

registerProcessErrorLogging();
registerAppProtocolPrivileges(protocol);
const launchPolicy = configureProcessFlags(app);

const assetStore = createUserAssetStore();

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send(channel, payload);
    } catch {
      /* ignore */
    }
  });
}

function logGpuFeatureStatus(reason) {
  try {
    if (!app || typeof app.getGPUFeatureStatus !== "function") return;
    logMain(`GPU feature status ${reason} ${JSON.stringify(app.getGPUFeatureStatus())}`);
  } catch (err) {
    logMain(`GPU feature status unavailable ${reason} ${err && err.message ? err.message : String(err)}`);
  }
}

logMain(
  `boot gpuMode=${launchPolicy.gpu.mode} gpuSource=${launchPolicy.gpu.source} storeRuntime=${launchPolicy.storeRuntime}`
);

app.whenReady().then(() => {
  startupMetrics.mark("appReady");
  registerAppProcessLogging(app);
  registerAppFileProtocol(protocol);
  startupMetrics.mark("protocolReady");

  logMain(`app.whenReady appPath=${app.getAppPath()}`);
  logGpuFeatureStatus("when-ready");
  app.on("gpu-info-update", () => {
    logGpuFeatureStatus("gpu-info-update");
  });

  assetStore.initialize(app.getPath("userData"), {
    onStickersChanged: (stickers) => {
      broadcast(IPC_CHANNELS.STICKERS_CHANGED, stickers);
    },
    onFontsChanged: (fonts) => {
      broadcast(IPC_CHANNELS.USER_FONTS_CHANGED, fonts);
    },
  });
  startupMetrics.mark("assetStoreReady");

  const appEdition = resolveAppEdition(app);
  const storePurchasesEnabled = appEdition === APP_EDITIONS.WINDOWS_STORE;
  const developmentEntitlement = storePurchasesEnabled
    ? resolveDevelopmentEntitlement(process.env, app.isPackaged)
    : "";
  let monetizationStore = null;
  if (storePurchasesEnabled) {
    const { createMonetizationStore } = require("./monetization-store");
    monetizationStore = createMonetizationStore({
      userDataPath: app.getPath("userData"),
      developmentEntitlement,
    });
  }
  startupMetrics.mark("monetizationStoreReady");
  logMain(`app edition=${appEdition}`);
  if (developmentEntitlement) {
    logMain(`development entitlement simulation=${developmentEntitlement}`);
  }

  registerIpcHandlers(assetStore, monetizationStore, {
    appEdition,
    startupMetrics,
  });
  startupMetrics.mark("ipcReady");
  createWindow({ startupMetrics });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  assetStore.close();
});
