#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const target = String(process.argv[2] || "windows").toLowerCase();
const TARGETS = {
  windows: {
    edition: "windows-store",
    unpacked: path.join(root, "dist", "win-unpacked"),
  },
  linux: {
    edition: "linux-community",
    unpacked: path.join(root, "dist", "linux", "linux-unpacked"),
  },
};

if (!TARGETS[target]) {
  console.error("package check failed: target must be windows or linux");
  process.exit(1);
}

const profile = TARGETS[target];
const resourcesPath = path.join(profile.unpacked, "resources");
const asarPath = path.join(resourcesPath, "app.asar");
const noticesPath = path.join(resourcesPath, "legal", "OPEN_SOURCE_NOTICES.txt");

function fail(message) {
  console.error(`package check failed (${target}): ${message}`);
  process.exitCode = 1;
}

function loadAsar() {
  try {
    return require("@electron/asar");
  } catch {
    try {
      return require("asar");
    } catch (error) {
      throw new Error(`Unable to load an asar library. Run npm install first. ${error.message}`);
    }
  }
}

if (!fs.existsSync(asarPath)) {
  fail(`missing ${path.relative(root, asarPath)}; run npm run pack:${target} first`);
  process.exit(process.exitCode);
}

const asar = loadAsar();
const entries = new Set(asar.listPackage(asarPath).map((entry) => entry.replace(/\\/g, "/")));

function has(entry) {
  return entries.has(entry);
}

function hasPrefix(prefix) {
  for (const entry of entries) {
    if (entry === prefix || entry.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function readTextFromAsar(entry) {
  const archiveEntry = entry.replace(/^\//, "").replace(/\//g, path.sep);
  return asar.extractFile(asarPath, archiveEntry).toString("utf8");
}

for (const required of [
  "/package.json",
  "/app/main/index.js",
  "/app/main/app-edition.js",
  "/app/preload/index.js",
  "/app/shared/app-editions.js",
  "/app/shared/ipc-channels.js",
  "/app/shared/font-coverage.js",
  "/app/renderer/index.html",
  "/app/renderer/src/boot.js",
  "/app/renderer/src/fonts/compatibility.js",
  "/app/renderer/assets/fonts/local-font-coverage.manifest.js",
  "/app/renderer/assets/stickers/stickers.manifest.js",
  "/app/renderer/docs/legal/Soapy_Panels_Privacy_Policy.pdf",
  "/app/renderer/docs/legal/Soapy_Panels_Terms_of_Service.pdf",
  "/packaging/assets/icons/icon.ico",
  "/packaging/assets/icons/icon.icns",
  "/packaging/assets/icons/icon.png",
  "/packaging/THIRD_PARTY_NOTICES.txt",
]) {
  if (!has(required)) fail(`packaged app is missing ${required}`);
}

for (const forbiddenPrefix of [
  "/tools",
  "/test",
  "/docs",
  "/.vscode",
  "/dist",
  "/out",
  "/build",
]) {
  if (hasPrefix(forbiddenPrefix)) fail(`packaged app must not include ${forbiddenPrefix}`);
}

for (const entry of entries) {
  if (entry.endsWith(".odt")) fail(`packaged app must not include ODT source: ${entry}`);
}

let packageMetadata = null;
try {
  packageMetadata = JSON.parse(readTextFromAsar("/package.json"));
} catch (error) {
  fail(`unable to read packaged metadata: ${error.message}`);
}
if (packageMetadata) {
  if (packageMetadata.soapyEdition !== profile.edition) {
    fail(`expected soapyEdition=${profile.edition}, received ${packageMetadata.soapyEdition || "(missing)"}`);
  }
  if (packageMetadata.license !== "Apache-2.0") {
    fail(`packaged license must be Apache-2.0, received ${packageMetadata.license || "(missing)"}`);
  }
}

if (!fs.existsSync(noticesPath)) {
  fail(`missing ${path.relative(root, noticesPath)}`);
} else {
  const notices = fs.readFileSync(noticesPath, "utf8");
  for (const marker of ["Apache License", "ASSET_LICENSES.md", "THIRD_PARTY_NOTICES.txt"]) {
    if (!notices.includes(marker)) fail(`open source notices are missing ${marker}`);
  }
}

const storeBridgePath = path.join(resourcesPath, "store-bridge", "SoapyStoreBridge.exe");
const storeLauncherPath = path.join(resourcesPath, "store-launcher", "SoapyStoreLauncher.exe");
const adModule = "/app/renderer/src/ui/ads.js";
const adStyles = "/app/renderer/styles/ads.css";
const adAssets = "/app/renderer/assets/ads";
const storeRuntimeEntries = [
  "/app/main/monetization-store.js",
  "/app/main/windows-store-bridge.js",
  "/app/shared/monetization-status.js",
];

if (target === "windows") {
  if (!fs.existsSync(storeBridgePath)) fail("Windows package is missing the Store bridge");
  if (!fs.existsSync(storeLauncherPath)) fail("Windows package is missing the Store launcher");
  for (const entry of [adModule, adStyles, ...storeRuntimeEntries]) {
    if (!has(entry)) fail(`Windows package is missing ${entry}`);
  }
  if (!hasPrefix(adAssets)) fail("Windows package is missing advertising assets");
} else {
  for (const externalPath of [storeBridgePath, storeLauncherPath]) {
    if (fs.existsSync(externalPath)) fail(`Linux package contains ${path.relative(resourcesPath, externalPath)}`);
  }
  for (const entry of [adModule, adStyles, ...storeRuntimeEntries]) {
    if (has(entry)) fail(`Linux package must not contain ${entry}`);
  }
  if (hasPrefix(adAssets)) fail("Linux package must not contain advertising assets");
}

const stickerManifestEntry = "/app/renderer/assets/stickers/stickers.manifest.js";
if (has(stickerManifestEntry)) {
  const sandbox = { window: {}, console };
  try {
    vm.runInNewContext(readTextFromAsar(stickerManifestEntry), sandbox, {
      filename: stickerManifestEntry,
    });
    const stickers = sandbox.window.soapyStickerManifest;
    if (!Array.isArray(stickers)) {
      fail("sticker manifest does not define window.soapyStickerManifest");
    } else {
      for (const sticker of stickers) {
        if (!sticker || typeof sticker.src !== "string") continue;
        if (!/^assets\/stickers\/builtin\//.test(sticker.src)) {
          fail(`sticker manifest entry has unsafe src: ${sticker.src}`);
          continue;
        }
        const packagedStickerPath = `/app/renderer/${sticker.src}`;
        if (!has(packagedStickerPath)) fail(`packaged app is missing ${packagedStickerPath}`);
      }
    }
  } catch (error) {
    fail(`unable to evaluate sticker manifest: ${error.message}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`package check passed (${target}, ${profile.edition})`);
