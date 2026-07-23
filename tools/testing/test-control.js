const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const controlRoot = path.join(repoRoot, "out", "test-control");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function createRunRecord(suite) {
  const runId = `${Date.now()}-${process.pid}`;
  const runDir = path.join(controlRoot, runId);
  const recordPath = path.join(runDir, "runner.json");
  const record = {
    version: 1,
    kind: "runner",
    pid: process.pid,
    suite,
    startedAt: new Date().toISOString(),
  };
  writeJson(recordPath, record);
  return { runDir, recordPath, record };
}

function updateRunRecord(run, updates) {
  run.record = { ...run.record, ...updates };
  writeJson(run.recordPath, run.record);
}

function removeRunRecord(run) {
  if (!run || !run.runDir) return;
  fs.rmSync(run.runDir, { recursive: true, force: true });
}

function registerElectronProcess(child, profileDir) {
  const runDir = process.env.SOAPY_TEST_RUN_DIR;
  if (!runDir || !child || !Number.isInteger(child.pid)) return null;

  const resolvedRunDir = path.resolve(runDir);
  const relative = path.relative(controlRoot, resolvedRunDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;

  const recordPath = path.join(resolvedRunDir, `electron-${child.pid}.json`);
  writeJson(recordPath, {
    version: 1,
    kind: "electron",
    pid: child.pid,
    profileDir: path.resolve(profileDir),
    startedAt: new Date().toISOString(),
  });
  return recordPath;
}

function unregisterProcess(recordPath) {
  if (!recordPath) return;
  fs.rmSync(recordPath, { force: true });
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !isRunning(pid)) return false;

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 || !isRunning(pid);
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return !isRunning(pid);
    }
  }
  return true;
}

function listRunRecords() {
  if (!fs.existsSync(controlRoot)) return [];
  const records = [];
  for (const entry of fs.readdirSync(controlRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDir = path.join(controlRoot, entry.name);
    for (const filename of fs.readdirSync(runDir)) {
      if (!filename.endsWith(".json")) continue;
      const recordPath = path.join(runDir, filename);
      try {
        const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
        records.push({ ...record, recordPath, runDir });
      } catch {
        // A partially written or obsolete record is safe to ignore.
      }
    }
  }
  return records;
}

function getWindowsProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const script = [
    `$process = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'`,
    "if ($null -ne $process) {",
    "  [pscustomobject]@{ Name = $process.Name; CommandLine = $process.CommandLine } | ConvertTo-Json -Compress",
    "}",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

function processMatchesRecord(record, processInfo) {
  if (!record || !processInfo) return false;
  const name = String(processInfo.Name || "").toLowerCase();
  const commandLine = String(processInfo.CommandLine || "")
    .toLowerCase()
    .replaceAll("\\", "/");

  if (record.kind === "runner") {
    return name === "node.exe" && commandLine.includes("tools/testing/run-tests.js");
  }
  if (record.kind === "electron") {
    const profileDir = String(record.profileDir || "")
      .toLowerCase()
      .replaceAll("\\", "/");
    return name === "electron.exe" && profileDir && commandLine.includes(profileDir);
  }
  return false;
}

module.exports = {
  controlRoot,
  createRunRecord,
  getWindowsProcess,
  isRunning,
  listRunRecords,
  processMatchesRecord,
  registerElectronProcess,
  removeRunRecord,
  repoRoot,
  terminateProcessTree,
  unregisterProcess,
  updateRunRecord,
};
