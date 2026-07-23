const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const {
  createRunRecord,
  removeRunRecord,
  repoRoot,
  terminateProcessTree,
  updateRunRecord,
} = require("./test-control");
const { reviewRoot } = require("./review-common");

const suiteDefinitions = {
  unit: { directory: "test/unit", concurrency: null },
  integration: { directory: "test/integration", concurrency: null },
  e2e: { directory: "test/e2e", concurrency: 1 },
};
const reviewReporterPath = pathToFileURL(
  path.join(__dirname, "review-reporter.js"),
).href;

function validatedReviewRunDir() {
  const value = process.env.SOAPY_TEST_REVIEW_RUN_DIR;
  if (!value) return null;
  const target = path.resolve(value);
  const relative = path.relative(reviewRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid review run directory: ${value}`);
  }
  return target;
}

function markReviewInterrupted(signal) {
  try {
    const runDir = validatedReviewRunDir();
    if (!runDir) return;
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "stopped.json"),
      `${JSON.stringify({ signal, stoppedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Interruption must continue even if the optional review marker cannot be written.
  }
}

function testFiles(directory) {
  const absoluteDirectory = path.join(repoRoot, directory);
  return fs
    .readdirSync(absoluteDirectory)
    .filter((filename) => filename.endsWith(".test.js"))
    .sort()
    .map((filename) => path.join(directory, filename));
}

function suitesFor(selection) {
  if (selection === "all") return ["unit", "integration"];
  if (suiteDefinitions[selection]) return [selection];
  return null;
}

function parseRunnerArgs(args) {
  const nodeArgs = [];
  const requestedFiles = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--file") {
      if (!args[index + 1]) throw new Error("--file requires a test file path");
      requestedFiles.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--file=")) {
      requestedFiles.push(arg.slice("--file=".length));
      continue;
    }
    nodeArgs.push(arg);
  }
  return { nodeArgs, requestedFiles };
}

function resolveRequestedFiles(requestedFiles) {
  return requestedFiles.map((requestedFile) => {
    const absolutePath = path.resolve(repoRoot, requestedFile);
    const relativePath = path.relative(repoRoot, absolutePath);
    const normalized = relativePath.replaceAll("\\", "/");
    const reviewFixture =
      !!process.env.SOAPY_TEST_REVIEW_RUN_DIR &&
      /^test\/fixtures\/review\/[^/]+\.fixture\.js$/.test(normalized);
    if (
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath) ||
      (!relativePath.endsWith(".test.js") && !reviewFixture) ||
      !fs.existsSync(absolutePath)
    ) {
      throw new Error(`Invalid test file: ${requestedFile}`);
    }
    return relativePath.replaceAll("\\", "/");
  });
}

function reviewFixtureSuite(filePath) {
  if (/failing-unit\.fixture\.js$/.test(filePath)) return "unit";
  if (/failing-integration\.fixture\.js$/.test(filePath)) return "integration";
  if (/failing-e2e(?:-.+)?\.fixture\.js$/.test(filePath)) return "e2e";
  return null;
}

function filesForSuite(suiteName, definition, requestedFiles) {
  if (requestedFiles.length === 0) return testFiles(definition.directory);
  const prefix = `${definition.directory}/`;
  return requestedFiles.filter(
    (filePath) =>
      filePath.startsWith(prefix) || reviewFixtureSuite(filePath) === suiteName,
  );
}

function addReviewReporters(args, suiteName) {
  const reviewRunDir = validatedReviewRunDir();
  if (!reviewRunDir) return;
  fs.mkdirSync(reviewRunDir, { recursive: true });
  args.push(
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    `--test-reporter=${reviewReporterPath}`,
    `--test-reporter-destination=${path.join(reviewRunDir, `events-${suiteName}.jsonl`)}`,
  );
}

function printStopInstructions(selection) {
  console.log(`\nSoapy Panels test run: ${selection}`);
  console.log("Stop from this terminal: press Ctrl+C");
  console.log("Stop from another CMD or PowerShell window; paste:");
  console.log(`npm --prefix "${repoRoot}" run test:stop\n`);
}

async function main() {
  const selection = process.argv[2] || "all";
  const { nodeArgs: extraNodeArgs, requestedFiles: rawRequestedFiles } =
    parseRunnerArgs(process.argv.slice(3));
  const requestedFiles = resolveRequestedFiles(rawRequestedFiles);
  const suites = suitesFor(selection);
  if (!suites) {
    console.error(`Unknown test suite: ${selection}`);
    console.error("Expected one of: all, unit, integration, e2e");
    process.exitCode = 2;
    return;
  }

  const run = createRunRecord(selection);
  updateRunRecord(run, {
    reviewRunDir: process.env.SOAPY_TEST_REVIEW_RUN_DIR || null,
  });
  let child = null;
  let stopping = false;
  let exitCode = 0;

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`\nStopping Soapy Panels tests (${signal})...`);
    markReviewInterrupted(signal);
    if (child && child.pid) terminateProcessTree(child.pid);
    removeRunRecord(run);
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("exit", () => {
    if (child && child.pid) terminateProcessTree(child.pid);
    removeRunRecord(run);
  });

  printStopInstructions(selection);

  try {
    for (const suiteName of suites) {
      if (stopping) break;
      const definition = suiteDefinitions[suiteName];
      const files = filesForSuite(suiteName, definition, requestedFiles);
      if (files.length === 0) continue;
      const args = ["--test"];
      if (definition.concurrency) {
        args.push(`--test-concurrency=${definition.concurrency}`);
      }
      addReviewReporters(args, suiteName);
      args.push(...extraNodeArgs, ...files);

      console.log(`Starting ${suiteName} tests...`);
      child = spawn(process.execPath, args, {
        cwd: repoRoot,
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          SOAPY_TEST_RUN_DIR: run.runDir,
        },
        stdio: "inherit",
        windowsHide: false,
      });
      updateRunRecord(run, {
        childPid: child.pid,
        currentSuite: suiteName,
      });

      exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          if (signal) {
            resolve(signal === "SIGINT" ? 130 : 1);
            return;
          }
          resolve(code == null ? 1 : code);
        });
      });
      child = null;
      updateRunRecord(run, { childPid: null, currentSuite: null });
      if (exitCode !== 0) break;
    }
  } finally {
    if (child && child.pid) terminateProcessTree(child.pid);
    removeRunRecord(run);
  }

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
