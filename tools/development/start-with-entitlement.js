#!/usr/bin/env node
const { launchElectron } = require("./start-electron");

const entitlement = String(process.argv[2] || "").trim().toLowerCase();
const allowedEntitlements = new Set(["monthly", "permanent"]);

if (!allowedEntitlements.has(entitlement)) {
  console.error("Usage: start-with-entitlement.js <monthly|permanent>");
  process.exitCode = 1;
} else {
  launchElectron({ environment: { SOAPY_DEV_ENTITLEMENT: entitlement } });
}
