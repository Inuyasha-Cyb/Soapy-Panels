#!/usr/bin/env node
const { launchElectron } = require("./start-electron");

const edition = String(process.argv[2] || "").trim().toLowerCase();
const allowedEditions = new Set(["windows-store", "linux-community"]);

if (!allowedEditions.has(edition)) {
  console.error("Usage: start-with-edition.js <windows-store|linux-community>");
  process.exitCode = 1;
} else {
  launchElectron({ environment: { SOAPY_DEV_EDITION: edition } });
}
