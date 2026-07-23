const MONETIZATION_PRODUCTS = Object.freeze({
  REMOVE_ADS_LIFETIME: "remove_ads_lifetime",
  SOAPY_PLUS_MONTHLY: "soapy_plus_monthly",
});

const MONETIZATION_PRODUCT_IDS = Object.freeze(Object.values(MONETIZATION_PRODUCTS));

function isKnownMonetizationProduct(productId) {
  return MONETIZATION_PRODUCT_IDS.includes(productId);
}

module.exports = {
  MONETIZATION_PRODUCTS,
  MONETIZATION_PRODUCT_IDS,
  isKnownMonetizationProduct,
};
