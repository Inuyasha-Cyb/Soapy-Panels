const fs = require("fs");
const path = require("path");
const {
  assertEditionForPlatform,
  defaultEditionForPlatform,
  getEditionDefinition,
} = require("../shared/app-editions");

const DEVELOPMENT_EDITION_ENV_VAR = "SOAPY_DEV_EDITION";

function readPackagedEditionId(app, fsImpl = fs) {
  const packagePath = path.join(app.getAppPath(), "package.json");
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(fsImpl.readFileSync(packagePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read packaged Soapy Panels edition metadata: ${error.message}`,
    );
  }
  return typeof packageMetadata.soapyEdition === "string"
    ? packageMetadata.soapyEdition.trim()
    : "";
}

function resolveAppEdition(app, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  let editionId = "";

  if (app && app.isPackaged) {
    editionId = readPackagedEditionId(app, options.fsImpl || fs);
    const definition = assertEditionForPlatform(editionId, platform);
    return definition.id;
  } else {
    editionId = String(env[DEVELOPMENT_EDITION_ENV_VAR] || "").trim();
    if (editionId) {
      const developmentDefinition = getEditionDefinition(editionId);
      if (!developmentDefinition) {
        throw new Error(`Unknown Soapy Panels edition: ${editionId}.`);
      }
      return developmentDefinition.id;
    }
    editionId = defaultEditionForPlatform(platform);
  }

  const definition = assertEditionForPlatform(editionId, platform);
  return definition.id;
}

module.exports = {
  DEVELOPMENT_EDITION_ENV_VAR,
  readPackagedEditionId,
  resolveAppEdition,
};
