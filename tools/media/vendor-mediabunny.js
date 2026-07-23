#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const EXPECTED_VERSION = "1.44.2";
const root = path.resolve(__dirname, "..", "..");
const packageJsonPath = path.join(root, "package.json");
const installedPackagePath = path.join(
  root,
  "node_modules",
  "mediabunny",
  "package.json",
);
const destinationDir = path.join(root, "app", "renderer", "vendor", "mediabunny");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requireVersion(label, actual) {
  if (actual !== EXPECTED_VERSION) {
    throw new Error(
      `${label} must be exactly ${EXPECTED_VERSION}; found ${String(actual || "missing")}.`,
    );
  }
}

function copyRequiredFile(source, destination) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing Mediabunny source file: ${source}`);
  }
  fs.copyFileSync(source, destination);
  console.log(`Copied ${path.relative(root, destination)}`);
}

function main() {
  const projectPackage = readJson(packageJsonPath);
  requireVersion(
    "package.json dependency mediabunny",
    projectPackage.dependencies && projectPackage.dependencies.mediabunny,
  );

  const installedPackage = readJson(installedPackagePath);
  requireVersion("installed Mediabunny", installedPackage.version);

  fs.mkdirSync(destinationDir, { recursive: true });
  copyRequiredFile(
    path.join(root, "node_modules", "mediabunny", "dist", "bundles", "mediabunny.cjs"),
    path.join(destinationDir, "mediabunny.cjs"),
  );
  copyRequiredFile(
    path.join(root, "node_modules", "mediabunny", "LICENSE"),
    path.join(destinationDir, "LICENSE"),
  );
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
