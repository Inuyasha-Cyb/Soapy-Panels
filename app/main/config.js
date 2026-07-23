// Set to true to use Electron's native menu bar. False relies on in-app HTML menus.
const USE_NATIVE_MENU_BAR = false;

// Enabled for Windows/Linux by default; macOS keeps native traffic lights.
const USE_CUSTOM_WINDOW_CHROME = true;
const CUSTOM_WINDOW_CHROME_ENABLED =
  USE_CUSTOM_WINDOW_CHROME && process.platform !== "darwin";
const DISABLE_GPU_ENV_VAR = "SOAPY_DISABLE_GPU";
const DEVELOPMENT_ENTITLEMENT_ENV_VAR = "SOAPY_DEV_ENTITLEMENT";
const DEVELOPMENT_ENTITLEMENTS = Object.freeze(["monthly", "permanent"]);

function detectStoreRuntime(env = process.env, processLike = process) {
  return !!(
    (processLike && processLike.windowsStore) ||
    (env &&
      (env.APPX_PACKAGE_FAMILY_NAME ||
        env.APPX_PACKAGE_SID ||
        env.WIN32_APPX_PACKAGE_ID ||
        env.WINDOWSAPP_USER_MODEL_ID))
  );
}

function resolveGpuLaunchPolicy(env = process.env) {
  var disabledByEnv = !!(env && env[DISABLE_GPU_ENV_VAR] === "1");
  return {
    mode: disabledByEnv ? "disabled" : "accelerated",
    source: disabledByEnv ? "env:SOAPY_DISABLE_GPU" : "default",
    disabled: disabledByEnv,
  };
}

function resolveDevelopmentEntitlement(env = process.env, isPackaged = false) {
  if (isPackaged) return "";
  const value = String(
    env && env[DEVELOPMENT_ENTITLEMENT_ENV_VAR]
      ? env[DEVELOPMENT_ENTITLEMENT_ENV_VAR]
      : "",
  )
    .trim()
    .toLowerCase();
  return DEVELOPMENT_ENTITLEMENTS.includes(value) ? value : "";
}

function appendSwitch(app, name, value) {
  if (!app || !app.commandLine || typeof app.commandLine.appendSwitch !== "function") {
    return;
  }
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}

function configureProcessFlags(app, options = {}) {
  var env = options.env || process.env;
  var processLike = options.processLike || process;
  var gpuPolicy = resolveGpuLaunchPolicy(env);

  try {
    if (gpuPolicy.disabled) {
      if (app && typeof app.disableHardwareAcceleration === "function") {
        app.disableHardwareAcceleration();
      }
      appendSwitch(app, "disable-gpu");
      appendSwitch(app, "disable-gpu-compositing");
    }
    appendSwitch(
      app,
      "disable-features",
      [
        "CalculateNativeWinOcclusion",
        "UseEcoQoSForBackgroundProcess",
        "IntensiveWakeUpThrottling",
      ].join(",")
    );
    appendSwitch(app, "disable-renderer-backgrounding");
    appendSwitch(app, "disable-background-timer-throttling");
    appendSwitch(app, "disable-backgrounding-occluded-windows");
  } catch {
    /* ignore */
  }

  return {
    gpu: gpuPolicy,
    storeRuntime: detectStoreRuntime(env, processLike),
  };
}

module.exports = {
  USE_NATIVE_MENU_BAR,
  USE_CUSTOM_WINDOW_CHROME,
  CUSTOM_WINDOW_CHROME_ENABLED,
  DISABLE_GPU_ENV_VAR,
  DEVELOPMENT_ENTITLEMENT_ENV_VAR,
  DEVELOPMENT_ENTITLEMENTS,
  configureProcessFlags,
  detectStoreRuntime,
  resolveDevelopmentEntitlement,
  resolveGpuLaunchPolicy,
};
