const APP_EDITIONS = Object.freeze({
  WINDOWS_STORE: "windows-store",
  LINUX_COMMUNITY: "linux-community",
});

const EDITION_DEFINITIONS = Object.freeze({
  [APP_EDITIONS.WINDOWS_STORE]: Object.freeze({
    id: APP_EDITIONS.WINDOWS_STORE,
    platform: "win32",
    storePurchasesEnabled: true,
  }),
  [APP_EDITIONS.LINUX_COMMUNITY]: Object.freeze({
    id: APP_EDITIONS.LINUX_COMMUNITY,
    platform: "linux",
    storePurchasesEnabled: false,
  }),
});

function getEditionDefinition(editionId) {
  return EDITION_DEFINITIONS[editionId] || null;
}

function defaultEditionForPlatform(platform) {
  if (platform === "win32") return APP_EDITIONS.WINDOWS_STORE;
  if (platform === "linux") return APP_EDITIONS.LINUX_COMMUNITY;
  return "";
}

function assertEditionForPlatform(editionId, platform) {
  const definition = getEditionDefinition(editionId);
  if (!definition) {
    throw new Error(`Unknown Soapy Panels edition: ${editionId || "(missing)"}.`);
  }
  if (definition.platform !== platform) {
    throw new Error(
      `Soapy Panels edition ${editionId} cannot run on platform ${platform}.`,
    );
  }
  return definition;
}

function deriveAppCapabilities(editionId, monetizationStatus) {
  const definition = getEditionDefinition(editionId);
  if (!definition) {
    throw new Error(`Unknown Soapy Panels edition: ${editionId || "(missing)"}.`);
  }

  if (editionId === APP_EDITIONS.LINUX_COMMUNITY) {
    return Object.freeze({
      adsEnabled: false,
      storePurchasesEnabled: false,
      premiumThemes: true,
      premiumMp4Export: true,
    });
  }

  const status = monetizationStatus && typeof monetizationStatus === "object"
    ? monetizationStatus
    : {};
  return Object.freeze({
    adsEnabled: status.adsDisabled !== true,
    storePurchasesEnabled: true,
    premiumThemes: status.hasPremiumThemes === true,
    premiumMp4Export: status.hasActivePlus === true,
  });
}

function createAppState(editionId, monetizationStatus) {
  return {
    edition: editionId,
    capabilities: deriveAppCapabilities(editionId, monetizationStatus),
    monetizationStatus:
      monetizationStatus && typeof monetizationStatus === "object"
        ? monetizationStatus
        : null,
  };
}

function createUnavailablePurchaseResult(editionId) {
  return {
    ok: false,
    status: null,
    ...createAppState(editionId, null),
    error: "Microsoft Store purchases are not available in this edition.",
  };
}

module.exports = {
  APP_EDITIONS,
  EDITION_DEFINITIONS,
  assertEditionForPlatform,
  createAppState,
  createUnavailablePurchaseResult,
  defaultEditionForPlatform,
  deriveAppCapabilities,
  getEditionDefinition,
};
