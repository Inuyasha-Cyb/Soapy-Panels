#!/usr/bin/env node

const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");

function sanitizeElectronEnvironment(extraEnvironment) {
  const environment = {
    ...process.env,
    ...(extraEnvironment || {}),
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function launchElectron(options = {}) {
  const electronPath = require("electron");
  const args = [repoRoot].concat(Array.isArray(options.args) ? options.args : []);
  const child = spawn(electronPath, args, {
    cwd: repoRoot,
    env: sanitizeElectronEnvironment(options.environment),
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`Unable to launch Electron: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code == null ? (signal ? 1 : 0) : code;
  });
  return child;
}

if (require.main === module) {
  launchElectron({ args: process.argv.slice(2) });
}

module.exports = {
  launchElectron,
  sanitizeElectronEnvironment,
};
