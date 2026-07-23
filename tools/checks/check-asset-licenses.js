#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const FONT_ROOT = path.join(ROOT, "app", "renderer", "assets", "fonts");
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const LICENSE_NAME_PATTERN = /(license|licence|copying|public[ ._-]?domain|readme|info|^ofl\.)/i;
const APPROVED_LICENSE_PATTERNS = [
  /SIL OPEN FONT LICENSE/i,
  /Open Font License/i,
  /Apache License/i,
  /public domain/i,
  /CC0/i,
];
const REJECTED_LICENSE_PATTERNS = [
  /personal use only/i,
  /non[- ]commercial/i,
  /may not be (?:sold|modified|altered)/i,
  /must not be (?:sold|modified|altered)/i,
  /no fee is charged/i,
  /freeware/i,
];
const KNOWN_REMOVED_DIRECTORIES = new Set([
  "1942-report",
  "Bearpaw",
  "Bloody",
  "ProFontWindows",
  "Silkscreen",
  "VTC-Letterer-Pro",
  "Wagnasty",
]);

function getFontDirectories() {
  return fs.readdirSync(FONT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(FONT_ROOT, entry.name));
}

function validateFontLicenses() {
  const failures = [];
  let directoryCount = 0;
  let fontFileCount = 0;

  for (const directory of getFontDirectories()) {
    const name = path.basename(directory);
    if (KNOWN_REMOVED_DIRECTORIES.has(name)) {
      failures.push(`${name}: known restrictive or unverifiable font is present`);
      continue;
    }

    const files = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    const fontFiles = files.filter((file) => FONT_EXTENSIONS.has(path.extname(file).toLowerCase()));
    if (!fontFiles.length) continue;

    directoryCount += 1;
    fontFileCount += fontFiles.length;
    const licenseFiles = files.filter((file) => LICENSE_NAME_PATTERN.test(file));
    if (!licenseFiles.length) {
      failures.push(`${name}: no adjacent license evidence`);
      continue;
    }

    const licenseText = licenseFiles
      .map((file) => fs.readFileSync(path.join(directory, file), "utf8"))
      .join("\n");
    if (APPROVED_LICENSE_PATTERNS.some((pattern) => pattern.test(licenseText))) continue;
    if (REJECTED_LICENSE_PATTERNS.some((pattern) => pattern.test(licenseText))) {
      failures.push(`${name}: license contains a restrictive redistribution term`);
    } else {
      failures.push(`${name}: license was not recognized as OFL, Apache-2.0, CC0, or public domain`);
    }
  }

  return { directoryCount, failures, fontFileCount };
}

function main() {
  const result = validateFontLicenses();
  if (result.failures.length) {
    result.failures.forEach((failure) => console.error(`asset license check failed: ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(
    `asset license check passed (${result.fontFileCount} font files in ${result.directoryCount} licensed directories)`,
  );
}

if (require.main === module) main();

module.exports = {
  validateFontLicenses,
};
