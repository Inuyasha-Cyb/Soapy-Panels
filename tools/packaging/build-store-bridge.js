#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const projectPath = path.join(root, "tools", "windows-store-helper", "SoapyStoreBridge.csproj");
const outputDir = path.join(root, "out", "store-bridge");

if (process.platform !== "win32") {
  console.log("Skipping Microsoft Store bridge build on non-Windows host.");
  process.exit(0);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  "dotnet",
  [
    "publish",
    projectPath,
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "true",
    "-p:PublishSingleFile=true",
    "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-o",
    outputDir,
  ],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

for (const fileName of fs.readdirSync(outputDir)) {
  if (fileName.toLowerCase().endsWith(".pdb")) {
    fs.rmSync(path.join(outputDir, fileName), { force: true });
  }
}

process.exit(result.status || 0);
