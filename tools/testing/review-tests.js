const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { spawn } = require("node:child_process");
const {
  createRunId,
  parseCliOptions,
  repoRoot,
  reviewRunsRoot,
  writeJson,
} = require("./review-common");
const { buildReviewReport } = require("./review-report");

const choices = {
  "1": { selection: "unit", label: "Unit" },
  "2": { selection: "integration", label: "Integration" },
  "3": { selection: "all", label: "Unit + integration" },
  "4": {
    selection: "e2e",
    label: "E2E smoke",
    files: ["test/e2e/electron-smoke.test.js"],
  },
  "5": { selection: "e2e", label: "Full E2E" },
};
const selectionAliases = {
  unit: choices["1"],
  integration: choices["2"],
  all: choices["3"],
  smoke: choices["4"],
  e2e: choices["5"],
};
const demoFixtures = {
  unit: ["test/fixtures/review/failing-unit.fixture.js"],
  integration: ["test/fixtures/review/failing-integration.fixture.js"],
  all: [
    "test/fixtures/review/failing-unit.fixture.js",
    "test/fixtures/review/failing-integration.fixture.js",
  ],
  e2e: ["test/fixtures/review/failing-e2e.fixture.js"],
};

function requestedFiles(args) {
  const files = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--file" && args[index + 1]) {
      files.push(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--file=")) {
      files.push(arg.slice("--file=".length));
    }
  }
  return files;
}

async function chooseSuite(cliSelection) {
  if (cliSelection) {
    const choice = selectionAliases[String(cliSelection).toLowerCase()];
    if (!choice) throw new Error("Review suite must be unit, integration, all, smoke, or e2e.");
    return choice;
  }

  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\nSoapy Panels test failure review");
    for (const [number, choice] of Object.entries(choices)) {
      console.log(`  ${number}. ${choice.label}`);
    }
    const answer = (await input.question("Choose a test suite [1-5]: ")).trim();
    if (!choices[answer]) throw new Error("Please choose a number from 1 to 5.");
    return choices[answer];
  } finally {
    input.close();
  }
}

function openReport(reportPath) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "explorer.exe";
    args = [reportPath];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [reportPath];
  } else {
    command = "xdg-open";
    args = [reportPath];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", () => {});
  child.unref();
}

async function runReview(choice) {
  const runId = createRunId();
  const runDir = path.join(reviewRunsRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, "run.json"), {
    version: 1,
    runId,
    selection: choice.selection,
    label: choice.label,
    files: choice.files || [],
    startedAt: new Date().toISOString(),
  });

  const args = [path.join("tools", "testing", "run-tests.js"), choice.selection];
  for (const file of choice.files || []) args.push(`--file=${file}`);

  const terminalLog = fs.createWriteStream(path.join(runDir, "terminal.log"), {
    encoding: "utf8",
  });
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, SOAPY_TEST_REVIEW_RUN_DIR: runDir },
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: false,
  });
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    terminalLog.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    terminalLog.write(chunk);
  });
  let exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      const message = `${error && error.stack ? error.stack : error}\n`;
      process.stderr.write(message);
      terminalLog.write(message);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code == null ? 1 : code));
  });
  await new Promise((resolve) => terminalLog.end(resolve));
  if (fs.existsSync(path.join(runDir, "stopped.json"))) exitCode = 130;

  let summary;
  try {
    summary = buildReviewReport({
      runDir,
      runId,
      selection: choice.label,
      exitCode,
    });
  } catch (error) {
    console.error(`The tests exited with code ${exitCode}, but the review report could not be built.`);
    console.error(error && error.stack ? error.stack : error);
    return exitCode || 1;
  }
  const reportPath = path.join(runDir, "index.html");
  console.log(`\nReview report: ${reportPath}`);
  if (exitCode === 130 || exitCode === 143) {
    console.log(`The review run was interrupted (exit ${exitCode}); the report was not opened automatically.`);
  } else if (exitCode !== 0) {
    openReport(reportPath);
    console.log("Requested the failure report in your default browser; use the path above if it did not open.");
  } else {
    console.log(`All selected tests passed. ${summary.failures.length} failures were reported.`);
  }
  return exitCode;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const options = parseCliOptions(rawArgs);
  let choice = await chooseSuite(options._[0]);
  if (options["demo-failure"] === true) {
    choice = {
      ...choice,
      label: `${choice.label} intentional demo failure`,
      files: demoFixtures[choice.selection],
    };
  }
  const files = requestedFiles(rawArgs);
  if (files.length > 0) {
    choice = {
      ...choice,
      label: `${choice.label} focused files`,
      files,
    };
  }
  process.exitCode = await runReview(choice);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
