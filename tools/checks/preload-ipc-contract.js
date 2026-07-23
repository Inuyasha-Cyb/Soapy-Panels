const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const preloadPath = path.join(root, "app", "preload", "index.js");

function readPreloadIpcChannels(source = fs.readFileSync(preloadPath, "utf8")) {
  const match = source.match(
    /const IPC_CHANNELS = Object\.freeze\((\{[\s\S]*?\})\);/,
  );
  if (!match) throw new Error("Unable to find the sandboxed preload IPC channel map.");

  const parsed = vm.runInNewContext(`(${match[1]})`, Object.create(null), {
    timeout: 1000,
  });
  return JSON.parse(JSON.stringify(parsed));
}

module.exports = {
  preloadPath,
  readPreloadIpcChannels,
};
