const { MONETIZATION_PRODUCTS } = require("./monetization-products");

const PRICE_FIELDS = Object.freeze([
  "displayPrice",
  "formattedPrice",
  "formattedBasePrice",
  "formattedRecurrencePrice",
  "currencyCode",
]);

function normalizeProductPrice(price) {
  const source = price && typeof price === "object" ? price : {};
  const normalized = {};
  for (const field of PRICE_FIELDS) {
    if (typeof source[field] === "string" && source[field].trim()) {
      normalized[field] = source[field].trim();
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeProductEntitlements(entitlements) {
  const source = entitlements && typeof entitlements === "object" ? entitlements : {};
  const normalized = {};
  for (const productId of Object.values(MONETIZATION_PRODUCTS)) {
    const entry = source[productId] && typeof source[productId] === "object"
      ? source[productId]
      : {};
    normalized[productId] = {
      owned: !!entry.owned,
      active: entry.active !== false && (!!entry.owned || !!entry.active),
      kind: typeof entry.kind === "string" ? entry.kind : "",
      expiresAt: typeof entry.expiresAt === "string" ? entry.expiresAt : null,
      price: normalizeProductPrice(entry.price),
    };
  }
  return normalized;
}

function deriveMonetizationStatus(input) {
  const payload = input && typeof input === "object" ? input : {};
  const products = normalizeProductEntitlements(payload.products);
  const ownsRemoveAds = !!(
    products[MONETIZATION_PRODUCTS.REMOVE_ADS_LIFETIME] &&
    products[MONETIZATION_PRODUCTS.REMOVE_ADS_LIFETIME].owned
  );
  const hasActivePlus = !!(
    (products[MONETIZATION_PRODUCTS.SOAPY_PLUS_MONTHLY] &&
      products[MONETIZATION_PRODUCTS.SOAPY_PLUS_MONTHLY].active)
  );
  const hasPremiumThemes = ownsRemoveAds || hasActivePlus;
  const source = typeof payload.source === "string" ? payload.source : "unknown";
  const available = payload.available !== false && source !== "unavailable";
  const status = {
    available,
    source,
    adsDisabled: ownsRemoveAds || hasActivePlus,
    ownsRemoveAds,
    hasActivePlus,
    hasPremiumThemes,
    products,
    checkedAt: typeof payload.checkedAt === "string" ? payload.checkedAt : new Date().toISOString(),
    error: typeof payload.error === "string" ? payload.error : "",
  };
  return status;
}

module.exports = {
  deriveMonetizationStatus,
  normalizeProductPrice,
  normalizeProductEntitlements,
};
