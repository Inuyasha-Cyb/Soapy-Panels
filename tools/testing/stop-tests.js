const fs = require("node:fs");
const path = require("node:path");
const {
  getWindowsProcess,
  isRunning,
  listRunRecords,
  processMatchesRecord,
  repoRoot,
  terminateProcessTree,
} = require("./test-control");

function markReviewStopped(record) {
  if (!record.reviewRunDir) return;
  const reviewRoot = path.join(repoRoot, "out", "test-review");
  const target = path.resolve(record.reviewRunDir);
  const relative = path.relative(reviewRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, "stopped.json"),
      `${JSON.stringify({ signal: "test:stop", stoppedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Stopping the verified processes remains the priority.
  }
}

function main() {
  const records = listRunRecords();
  const runnerRecords = records.filter((record) => record.kind === "runner");
  const electronRecords = records.filter((record) => record.kind === "electron");
  let stopped = 0;
  const skippedRunDirs = new Set();

  for (const record of [...runnerRecords, ...electronRecords]) {
    const pid = Number(record.pid);
    if (!Number.isInteger(pid) || !isRunning(pid)) continue;

    if (process.platform === "win32") {
      const processInfo = getWindowsProcess(pid);
      if (!processMatchesRecord(record, processInfo)) {
        console.warn(`Skipped unverified process ${pid}; its PID may have been reused.`);
        skippedRunDirs.add(record.runDir);
        continue;
      }
    }

    if (record.kind === "runner") markReviewStopped(record);
    if (terminateProcessTree(pid)) stopped += 1;
  }

  for (const runDir of new Set(records.map((record) => record.runDir))) {
    if (skippedRunDirs.has(runDir)) continue;
    fs.rmSync(runDir, { recursive: true, force: true });
  }

  if (stopped === 0) {
    console.log("No active Soapy Panels test run was found.");
    return;
  }
  console.log(`Stopped ${stopped} Soapy Panels test process tree${stopped === 1 ? "" : "s"}.`);
}

main();
