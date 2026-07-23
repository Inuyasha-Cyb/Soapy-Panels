const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { logMain } = require("./logging");

const STORE_QUERY_TIMEOUT_MS = 8000;
const STORE_PURCHASE_TIMEOUT_MS = 0;
const HELPER_EXE = "SoapyStoreBridge.exe";

const FRIENDLY_ERRORS = Object.freeze({
  helperMissing: "Microsoft Store purchases are not available in this build.",
  inProgress: "A Microsoft Store purchase is already in progress.",
  invalidResponse: "Microsoft Store returned an invalid response. Please try again.",
  queryTimeout: "Microsoft Store did not respond in time. Please try again.",
  requestFailed: "Microsoft Store could not complete the request. Please try again.",
});

function getCandidateHelperPaths(options = {}) {
  const candidates = [];
  const resourcesPath = options.resourcesPath === undefined
    ? process.resourcesPath
    : options.resourcesPath;
  const currentDirectory = options.currentDirectory || process.cwd();
  const mainDirectory = options.mainDirectory || __dirname;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, "store-bridge", HELPER_EXE));
  }
  candidates.push(path.join(mainDirectory, "..", "..", "out", "store-bridge", HELPER_EXE));
  candidates.push(path.join(currentDirectory, "out", "store-bridge", HELPER_EXE));
  return candidates;
}

function resolveHelperPath(options = {}) {
  const fsImpl = options.fsImpl || fs;
  return getCandidateHelperPaths(options).find((candidate) => {
    try {
      return fsImpl.existsSync(candidate);
    } catch {
      return false;
    }
  }) || "";
}

function nativeWindowHandleToNumber(windowHandle) {
  try {
    if (!Buffer.isBuffer(windowHandle) || windowHandle.length < 4) return 0;
    if (windowHandle.length >= 8 && typeof windowHandle.readBigUInt64LE === "function") {
      return Number(windowHandle.readBigUInt64LE(0));
    }
    return windowHandle.readUInt32LE(0);
  } catch {
    return 0;
  }
}

function safeDiagnosticToken(value, fallback = "none") {
  const token = String(value === undefined || value === null ? "" : value).trim();
  return /^[A-Za-z0-9_.-]{1,80}$/.test(token) ? token : fallback;
}

function parseHelperJson(stdout) {
  const source = String(stdout || "").trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function messageForHelperResult(result) {
  if (result && typeof result.error === "string" && result.error.trim()) {
    return result.error.trim();
  }
  switch (result && result.status) {
    case "NotPurchased":
      return "The purchase was canceled or was not completed.";
    case "NetworkError":
      return "Microsoft Store could not complete the purchase because of a network error.";
    case "ServerError":
      return "Microsoft Store could not complete the purchase because of a server error.";
    case "NotFound":
      return "This Microsoft Store product is currently unavailable.";
    default:
      return FRIENDLY_ERRORS.requestFailed;
  }
}

function createStoreBridgeError(message, result) {
  const error = new Error(message || FRIENDLY_ERRORS.requestFailed);
  error.name = "StoreBridgeError";
  if (result && result.errorCode) error.storeErrorCode = String(result.errorCode);
  if (result && result.status) error.storeStatus = String(result.status);
  return error;
}

function createWindowsStoreBridge(options = {}) {
  const execFileImpl = options.execFileImpl || childProcess.execFile;
  const logMainImpl = options.logMainImpl || logMain;
  const processObject = options.processObject || process;
  const resolveHelperPathImpl = options.resolveHelperPathImpl || (() => resolveHelperPath(options));
  const activeChildren = new Set();
  let activePurchasePromise = null;
  let cleanupRegistered = false;

  function writeDiagnostic(command, startedAt, error, result) {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const exitCode = error && error.code !== undefined && error.code !== null
      ? error.code
      : 0;
    const killed = !!(error && error.killed);
    const signal = error && error.signal ? error.signal : "none";
    const status = result && result.status ? result.status : "none";
    const errorCode = result && result.errorCode ? result.errorCode : "none";
    logMainImpl(
      `store-bridge command=${safeDiagnosticToken(command)} elapsedMs=${elapsedMs} ` +
      `exitCode=${safeDiagnosticToken(exitCode, "unknown")} killed=${killed} ` +
      `signal=${safeDiagnosticToken(signal)} status=${safeDiagnosticToken(status)} ` +
      `errorCode=${safeDiagnosticToken(errorCode)}`,
    );
  }

  function terminateActiveHelpers() {
    for (const child of activeChildren) {
      try {
        if (child && typeof child.kill === "function") child.kill();
      } catch {
        /* App shutdown must continue even if a helper already exited. */
      }
    }
    activeChildren.clear();
  }

  function registerShutdownCleanup() {
    if (cleanupRegistered || !processObject || typeof processObject.once !== "function") return;
    cleanupRegistered = true;
    processObject.once("exit", terminateActiveHelpers);
  }

  function runHelper(command, payload, timeoutMs) {
    const helperPath = resolveHelperPathImpl();
    if (!helperPath) {
      return Promise.reject(createStoreBridgeError(FRIENDLY_ERRORS.helperMissing));
    }

    registerShutdownCleanup();
    const encodedPayload = Buffer.from(JSON.stringify(payload || {}), "utf8").toString("base64");
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      let child = null;
      let completed = false;
      const onComplete = (error, stdout) => {
        completed = true;
        if (child) activeChildren.delete(child);
        const parsed = parseHelperJson(stdout);
        writeDiagnostic(command, startedAt, error, parsed);

        if (parsed && parsed.ok === false) {
          reject(createStoreBridgeError(messageForHelperResult(parsed), parsed));
          return;
        }
        if (error) {
          const timedOut = timeoutMs > 0 && error.killed === true;
          reject(createStoreBridgeError(
            timedOut ? FRIENDLY_ERRORS.queryTimeout : FRIENDLY_ERRORS.requestFailed,
            parsed,
          ));
          return;
        }
        if (!parsed) {
          reject(createStoreBridgeError(FRIENDLY_ERRORS.invalidResponse));
          return;
        }
        resolve(parsed);
      };

      try {
        child = execFileImpl(
          helperPath,
          [command, encodedPayload],
          {
            timeout: timeoutMs,
            windowsHide: true,
          },
          onComplete,
        );
        if (child && !completed) activeChildren.add(child);
      } catch {
        writeDiagnostic(command, startedAt, null, null);
        reject(createStoreBridgeError(FRIENDLY_ERRORS.requestFailed));
      }
    });
  }

  async function queryEntitlements(queryOptions = {}) {
    return runHelper("query", {
      productIds: queryOptions.productIds || [],
    }, STORE_QUERY_TIMEOUT_MS);
  }

  async function executePurchase(purchaseOptions = {}) {
    const result = await runHelper("purchase", {
      productId: purchaseOptions.productId,
      windowHandle: nativeWindowHandleToNumber(purchaseOptions.windowHandle),
    }, STORE_PURCHASE_TIMEOUT_MS);
    return {
      ok: !!(result && result.ok),
      error: result && result.error ? result.error : "",
      status: result && result.status ? result.status : "",
      errorCode: result && result.errorCode ? result.errorCode : "",
    };
  }

  function purchaseProduct(purchaseOptions = {}) {
    if (activePurchasePromise) {
      return Promise.resolve({
        ok: false,
        error: FRIENDLY_ERRORS.inProgress,
        status: "InProgress",
        errorCode: "PurchaseInProgress",
      });
    }
    activePurchasePromise = executePurchase(purchaseOptions);
    return activePurchasePromise.finally(() => {
      activePurchasePromise = null;
    });
  }

  function dispose() {
    terminateActiveHelpers();
    if (
      cleanupRegistered &&
      processObject &&
      typeof processObject.removeListener === "function"
    ) {
      processObject.removeListener("exit", terminateActiveHelpers);
    }
    cleanupRegistered = false;
  }

  return {
    queryEntitlements,
    purchaseProduct,
    resolveHelperPath: resolveHelperPathImpl,
    dispose,
  };
}

const defaultBridge = createWindowsStoreBridge();

module.exports = {
  queryEntitlements: defaultBridge.queryEntitlements,
  purchaseProduct: defaultBridge.purchaseProduct,
  resolveHelperPath: defaultBridge.resolveHelperPath,
  createWindowsStoreBridge,
  STORE_QUERY_TIMEOUT_MS,
  STORE_PURCHASE_TIMEOUT_MS,
};
