#!/usr/bin/env node
const path = require("node:path");
const { spawn } = require("node:child_process");

const entitlement = String(process.argv[2] || "").trim().toLowerCase();
const allowedEntitlements = new Set(["monthly", "permanent"]);

if (!allowedEntitlements.has(entitlement)) {
  console.error("Usage: start-with-entitlement.js <monthly|permanent>");
  process.exitCode = 1;
} else {
  const root = path.resolve(__dirname, "..", "..");
  const electronPath = require("electron");
  const child = spawn(electronPath, ["."], {
    cwd: root,
    env: {
      ...process.env,
      SOAPY_DEV_ENTITLEMENT: entitlement,
    },
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`Unable to launch Electron: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code == null ? 1 : code;
  });
}
