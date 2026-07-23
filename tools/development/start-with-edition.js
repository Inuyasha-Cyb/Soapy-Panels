#!/usr/bin/env node
const path = require("node:path");
const { spawn } = require("node:child_process");

const edition = String(process.argv[2] || "").trim().toLowerCase();
const allowedEditions = new Set(["windows-store", "linux-community"]);

if (!allowedEditions.has(edition)) {
  console.error("Usage: start-with-edition.js <windows-store|linux-community>");
  process.exitCode = 1;
} else {
  const root = path.resolve(__dirname, "..", "..");
  const electronPath = require("electron");
  const child = spawn(electronPath, ["."], {
    cwd: root,
    env: {
      ...process.env,
      SOAPY_DEV_EDITION: edition,
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
