const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const builderConfigPath = path.join(root, "packaging", "electron-builder.json");
const packageJsonPath = path.join(root, "package.json");
const applicationExecutable = "app\\SoapyPanels.exe";
const uap10Namespace = "http://schemas.microsoft.com/appx/manifest/uap/windows10/10";
const packagedClassicRuntimeBehavior = "packagedClassicApp";
const mediumTrustLevel = "mediumIL";
const minimumUap10MinVersion = "10.0.19041.0";
const storePackagingConfig = loadStorePackagingConfig();
const storeIdentity = storePackagingConfig.identity;

async function appxManifestCreated(manifestPath) {
  const original = fs.readFileSync(manifestPath, "utf8");
  const updated = rewriteAppxManifest(original);

  fs.writeFileSync(manifestPath, updated);
  console.log(
    `AppX executable set to ${applicationExecutable} with uap10 packaged desktop activation metadata`,
  );
}

function rewriteAppxManifest(manifestText, options = {}) {
  if (typeof manifestText !== "string" || manifestText.trim() === "") {
    throw new Error("AppX manifest text must be a non-empty string.");
  }

  const executable = options.executable || applicationExecutable;
  const identity = options.storeIdentity || storeIdentity;
  let updated = ensureUap10Namespace(manifestText);
  updated = ensureUap10IgnorableNamespace(updated);
  updated = rewriteApplicationElement(updated, executable, identity.applicationId);
  validateAppxManifest(updated, executable, { storeIdentity: identity });
  return updated;
}

function loadStorePackagingConfig(configPath = builderConfigPath) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const appx = config.appx || {};
  const identity = {
    identityName: appx.identityName,
    applicationId: appx.applicationId,
    displayName: appx.displayName,
  };

  for (const [key, value] of Object.entries(identity)) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Electron Builder appx.${key} must be a non-empty string.`);
    }
  }

  const minVersion = validateMinimumAppxVersion(appx.minVersion);
  const packageVersion = loadPackageVersion();
  const appxVersion = appVersionToAppxVersion(packageVersion);
  return { identity, minVersion, packageVersion, appxVersion };
}

function loadStoreIdentityConfig(configPath = builderConfigPath) {
  return loadStorePackagingConfig(configPath).identity;
}

function getStoreIdentityConfig() {
  return { ...storeIdentity };
}

function validateMinimumAppxVersion(minVersion) {
  if (typeof minVersion !== "string" || minVersion.trim() === "") {
    throw new Error("Electron Builder appx.minVersion must be a non-empty version string.");
  }

  if (!/^\d+\.\d+\.\d+\.\d+$/.test(minVersion)) {
    throw new Error(`Electron Builder appx.minVersion must use four-part version format: ${minVersion}.`);
  }

  if (compareWindowsVersions(minVersion, minimumUap10MinVersion) < 0) {
    throw new Error(
      `Electron Builder appx.minVersion must be at least ${minimumUap10MinVersion} when using uap10 activation metadata: ${minVersion}.`,
    );
  }

  return minVersion;
}

function loadPackageVersion(packagePath = packageJsonPath) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
    throw new Error("package.json version must be a non-empty string.");
  }
  return packageJson.version;
}

function appVersionToAppxVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Store package version must use three numeric parts: ${version}.`);
  }

  return `${version}.0`;
}

function compareWindowsVersions(left, right) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 4; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function ensureUap10Namespace(manifestText) {
  if (/\sxmlns:uap10="/.test(manifestText)) {
    return manifestText;
  }

  return manifestText.replace(/<Package\b[^>]*>/, (tag) =>
    setAttribute(tag, "xmlns:uap10", uap10Namespace),
  );
}

function ensureUap10IgnorableNamespace(manifestText) {
  return manifestText.replace(/<Package\b[^>]*>/, (tag) => {
    const current = getAttribute(tag, "IgnorableNamespaces");
    const namespaces = current ? current.split(/\s+/).filter(Boolean) : [];
    if (!namespaces.includes("uap10")) {
      namespaces.push("uap10");
    }
    return setAttribute(tag, "IgnorableNamespaces", namespaces.join(" "));
  });
}

function rewriteApplicationElement(manifestText, executable, applicationId) {
  const match = findApplicationTag(manifestText, applicationId);
  if (!match) {
    throw new Error(`Unable to find AppX Application entry with Id="${applicationId}".`);
  }

  let applicationTag = match[0];
  applicationTag = setAttribute(applicationTag, "Executable", executable);
  applicationTag = removeAttribute(applicationTag, "EntryPoint");
  applicationTag = setAttribute(
    applicationTag,
    "uap10:RuntimeBehavior",
    packagedClassicRuntimeBehavior,
  );
  applicationTag = setAttribute(applicationTag, "uap10:TrustLevel", mediumTrustLevel);

  return `${manifestText.slice(0, match.index)}${applicationTag}${manifestText.slice(
    match.index + match[0].length,
  )}`;
}

function findApplicationTag(manifestText, applicationId = storeIdentity.applicationId) {
  const pattern = new RegExp(
    `<Application\\b(?=[^>]*\\bId="${escapeRegExp(applicationId)}")[^>]*>`,
  );
  return pattern.exec(manifestText);
}

function getAttribute(tag, attributeName) {
  const pattern = new RegExp(`\\s${escapeRegExp(attributeName)}="([^"]*)"`);
  const match = pattern.exec(tag);
  return match ? match[1] : null;
}

function setAttribute(tag, attributeName, value) {
  const closing = tag.endsWith("/>") ? "/>" : ">";
  const body = removeAttribute(tag.slice(0, -closing.length), attributeName).trimEnd();
  return `${body} ${attributeName}="${value}"${closing}`;
}

function removeAttribute(tag, attributeName) {
  const pattern = new RegExp(`\\s+${escapeRegExp(attributeName)}="[^"]*"`, "g");
  return tag.replace(pattern, "");
}

function validateAppxManifest(manifestText, expectedExecutable = applicationExecutable, options = {}) {
  const identity = options.storeIdentity || storeIdentity;
  const packageTag = /<Package\b[^>]*>/.exec(manifestText);
  if (!packageTag) {
    throw new Error("AppX Package element was not found.");
  }

  if (getAttribute(packageTag[0], "xmlns:uap10") !== uap10Namespace) {
    throw new Error("AppX manifest is missing the required uap10 namespace.");
  }
  if (
    !(getAttribute(packageTag[0], "IgnorableNamespaces") || "")
      .split(/\s+/)
      .includes("uap10")
  ) {
    throw new Error("AppX manifest IgnorableNamespaces must include uap10.");
  }

  const applicationTag = findApplicationTag(manifestText, identity.applicationId);
  if (!applicationTag) {
    throw new Error(`AppX Application entry with Id="${identity.applicationId}" was not found.`);
  }

  const tag = applicationTag[0];
  if (getAttribute(tag, "Executable") !== expectedExecutable) {
    throw new Error(`AppX Application Executable must be "${expectedExecutable}".`);
  }
  if (getAttribute(tag, "EntryPoint") !== null) {
    throw new Error("AppX Application must not keep EntryPoint when using uap10 metadata.");
  }
  if (getAttribute(tag, "uap10:RuntimeBehavior") !== packagedClassicRuntimeBehavior) {
    throw new Error(
      `AppX Application must set uap10:RuntimeBehavior="${packagedClassicRuntimeBehavior}".`,
    );
  }
  if (getAttribute(tag, "uap10:TrustLevel") !== mediumTrustLevel) {
    throw new Error(`AppX Application must set uap10:TrustLevel="${mediumTrustLevel}".`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = appxManifestCreated;
module.exports.default = appxManifestCreated;
module.exports.rewriteAppxManifest = rewriteAppxManifest;
module.exports.validateAppxManifest = validateAppxManifest;
module.exports.loadStoreIdentityConfig = loadStoreIdentityConfig;
module.exports.loadStorePackagingConfig = loadStorePackagingConfig;
module.exports.getStoreIdentityConfig = getStoreIdentityConfig;
module.exports.validateMinimumAppxVersion = validateMinimumAppxVersion;
module.exports.loadPackageVersion = loadPackageVersion;
module.exports.appVersionToAppxVersion = appVersionToAppxVersion;
module.exports.applicationExecutable = applicationExecutable;
module.exports.minimumUap10MinVersion = minimumUap10MinVersion;
