const fs = require("fs");
const path = require("path");

const IS_PACKAGED_STORE =
  !!process.windowsStore ||
  !!process.env.APPX_PACKAGE_FAMILY_NAME ||
  !!process.env.APPX_PACKAGE_SID ||
  !!process.env.WIN32_APPX_PACKAGE_ID ||
  !!process.env.WINDOWSAPP_USER_MODEL_ID;
const LOG_MAIN =
  IS_PACKAGED_STORE ||
  process.env.SOAPY_LOG_MAIN === "1" ||
  process.env.SOAPY_STARTUP_METRICS === "1";
const MAIN_LOG_PATH = path.join(
  process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(),
  "Soapy Panels",
  "logs",
  "main.log"
);

function logMain(message) {
  if (!LOG_MAIN) return;
  try {
    fs.mkdirSync(path.dirname(MAIN_LOG_PATH), { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(MAIN_LOG_PATH, line);
  } catch {
    /* ignore */
  }
}

function registerProcessErrorLogging() {
  process.on("uncaughtException", (err) => {
    logMain(`uncaughtException ${err && err.stack ? err.stack : String(err)}`);
  });

  process.on("unhandledRejection", (err) => {
    logMain(`unhandledRejection ${err && err.stack ? err.stack : String(err)}`);
  });
}

function registerAppProcessLogging(app) {
  app.on("render-process-gone", (_event, _contents, details) => {
    if (!details) return;
    logMain(
      `render-process-gone reason=${details.reason || "unknown"} exitCode=${details.exitCode || 0}`
    );
  });

  app.on("child-process-gone", (_event, details) => {
    if (!details) return;
    logMain(
      `child-process-gone type=${details.type || "unknown"} reason=${details.reason || "unknown"} exitCode=${details.exitCode || 0}`
    );
  });
}

module.exports = {
  LOG_MAIN,
  MAIN_LOG_PATH,
  logMain,
  registerProcessErrorLogging,
  registerAppProcessLogging,
};
