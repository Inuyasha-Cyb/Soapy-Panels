const fs = require("fs");
const path = require("path");
const { MONETIZATION_PRODUCTS, isKnownMonetizationProduct } = require("../shared/monetization-products");
const { deriveMonetizationStatus } = require("../shared/monetization-status");

const CACHE_FILE = "monetization-cache.json";

function emptyProducts() {
  const products = {};
  for (const productId of Object.values(MONETIZATION_PRODUCTS)) {
    products[productId] = {
      owned: false,
      active: false,
      kind: "",
      expiresAt: null,
      price: null,
    };
  }
  return products;
}

function readCache(cachePath) {
  try {
    if (!cachePath || !fs.existsSync(cachePath)) return null;
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return null;
  }
}

function isFutureIsoDate(value, now = new Date()) {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp > now.getTime();
}

function cacheProductsFromStatus(status, now = new Date()) {
  const cachedProducts = emptyProducts();
  if (!status || typeof status !== "object") return cachedProducts;

  if (status.ownsRemoveAds) {
    cachedProducts[MONETIZATION_PRODUCTS.REMOVE_ADS_LIFETIME] = {
      owned: true,
      active: true,
      kind: "durable",
      expiresAt: null,
      price: null,
    };
  }

  const products = status.products && typeof status.products === "object"
    ? status.products
    : {};
  const monthly = products[MONETIZATION_PRODUCTS.SOAPY_PLUS_MONTHLY];
  if (
    status.hasActivePlus &&
    monthly &&
    isFutureIsoDate(monthly.expiresAt, now)
  ) {
    cachedProducts[MONETIZATION_PRODUCTS.SOAPY_PLUS_MONTHLY] = {
      owned: true,
      active: true,
      kind: "subscription",
      expiresAt: monthly.expiresAt,
      price: null,
    };
  }

  return cachedProducts;
}

function activeProductsFromCache(cached, now = new Date()) {
  const cachedProducts = emptyProducts();
  const products = cached && cached.products && typeof cached.products === "object"
    ? cached.products
    : {};
  let hasCachedEntitlement = false;

  const durable = products[MONETIZATION_PRODUCTS.REMOVE_ADS_LIFETIME];
  if (durable && durable.owned) {
    cachedProducts[MONETIZATION_PRODUCTS.REMOVE_ADS_LIFETIME] = {
      owned: true,
      active: true,
      kind: "durable",
      expiresAt: null,
      price: null,
    };
    hasCachedEntitlement = true;
  }

  const monthly = products[MONETIZATION_PRODUCTS.SOAPY_PLUS_MONTHLY];
  if (
    monthly &&
    monthly.active !== false &&
    (monthly.owned || monthly.active) &&
    isFutureIsoDate(monthly.expiresAt, now)
  ) {
    cachedProducts[MONETIZATION_PRODUCTS.SOAPY_PLUS_MONTHLY] = {
      owned: true,
      active: true,
      kind: "subscription",
      expiresAt: monthly.expiresAt,
      price: null,
    };
    hasCachedEntitlement = true;
  }

  return hasCachedEntitlement ? cachedProducts : null;
}

function writeCache(cachePath, status) {
  try {
    if (!cachePath || !status) return;
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const cachedProducts = cacheProductsFromStatus(status);
    fs.writeFileSync(
      cachePath,
      JSON.stringify(
        {
          products: cachedProducts,
          checkedAt: status.checkedAt || new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch {
    /* Cache failure must not block app startup. */
  }
}

function loadNativeStoreBridge() {
  try {
    return require("./windows-store-bridge");
  } catch {
    return null;
  }
}

function unavailableStatus(error, cached) {
  const base = deriveMonetizationStatus({
    source: "unavailable",
    available: false,
    products: emptyProducts(),
    checkedAt: new Date().toISOString(),
    error,
  });
  const cachedProducts = activeProductsFromCache(cached);
  if (cachedProducts) {
    return deriveMonetizationStatus({
      source: "cache",
      available: false,
      products: cachedProducts,
      checkedAt: cached.checkedAt || base.checkedAt,
      error,
    });
  }
  return base;
}

function developmentStatus(entitlement, now = new Date()) {
  if (entitlement !== "monthly" && entitlement !== "permanent") return null;
  const products = emptyProducts();

  if (entitlement === "permanent") {
    products[MONETIZATION_PRODUCTS.REMOVE_ADS_LIFETIME] = {
      owned: true,
      active: true,
      kind: "durable",
      expiresAt: null,
      price: null,
    };
  } else {
    products[MONETIZATION_PRODUCTS.SOAPY_PLUS_MONTHLY] = {
      owned: true,
      active: true,
      kind: "subscription",
      expiresAt: new Date(
        now.getTime() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      price: null,
    };
  }

  return deriveMonetizationStatus({
    source: "development",
    available: true,
    products,
    checkedAt: now.toISOString(),
  });
}

function createMonetizationStore(options = {}) {
  const cachePath = options.userDataPath
    ? path.join(options.userDataPath, CACHE_FILE)
    : null;
  const simulatedStatus = developmentStatus(options.developmentEntitlement);
  const bridge = simulatedStatus ? null : options.bridge || loadNativeStoreBridge();

  function getStartupState() {
    if (simulatedStatus) {
      return {
        source: "development",
        monetizationStatus: simulatedStatus,
      };
    }

    const cached = readCache(cachePath);
    const cachedProducts = activeProductsFromCache(cached);
    if (!cachedProducts) {
      return {
        source: "none",
        monetizationStatus: null,
      };
    }

    return {
      source: "cache",
      monetizationStatus: deriveMonetizationStatus({
        source: "cache",
        available: false,
        products: cachedProducts,
        checkedAt: cached && cached.checkedAt
          ? cached.checkedAt
          : new Date().toISOString(),
        error: "",
      }),
    };
  }

  async function queryStatus() {
    if (simulatedStatus) return simulatedStatus;
    const cached = readCache(cachePath);
    if (!bridge || typeof bridge.queryEntitlements !== "function") {
      return unavailableStatus("Microsoft Store bridge is not available in this build.", cached);
    }
    try {
      const raw = await bridge.queryEntitlements({
        productIds: Object.values(MONETIZATION_PRODUCTS),
      });
      const status = deriveMonetizationStatus({
        source: "store",
        available: true,
        products: raw && raw.products ? raw.products : emptyProducts(),
        checkedAt: new Date().toISOString(),
      });
      writeCache(cachePath, status);
      return status;
    } catch (err) {
      return unavailableStatus(err && err.message ? err.message : String(err), cached);
    }
  }

  async function purchase(productId, windowHandle) {
    if (!isKnownMonetizationProduct(productId)) {
      return {
        ok: false,
        status: await queryStatus(),
        error: "Unknown monetization product.",
      };
    }
    if (simulatedStatus) {
      return {
        ok: true,
        status: simulatedStatus,
        error: "",
      };
    }
    if (!bridge || typeof bridge.purchaseProduct !== "function") {
      return {
        ok: false,
        status: await queryStatus(),
        error: "Microsoft Store purchases are not available in this build.",
      };
    }
    try {
      const result = await bridge.purchaseProduct({
        productId,
        windowHandle,
      });
      const status = await queryStatus();
      return {
        ok: !!(result && result.ok),
        status,
        error: result && result.error ? String(result.error) : "",
      };
    } catch (err) {
      return {
        ok: false,
        status: await queryStatus(),
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  return {
    getStartupState,
    queryStatus,
    purchase,
    isKnownProduct: isKnownMonetizationProduct,
  };
}

module.exports = {
  createMonetizationStore,
  developmentStatus,
  emptyProducts,
  isFutureIsoDate,
  activeProductsFromCache,
  unavailableStatus,
};
