const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { spawn } = require("node:child_process");
const {
  ensurePathInside,
  parseCliOptions,
  readJson,
  repoRoot,
  reviewRoot,
  reviewRunsRoot,
} = require("./review-common");

function exactNamePattern(name) {
  return `^${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  options.run ||= options._[0];
  options.test ||= options._[1];
  if (!options.run || !options.test) {
    throw new Error("Usage: npm run test:debug -- --run=<run-id> --test=<test-id>");
  }
  const sourceRunDir = ensurePathInside(reviewRunsRoot, path.join(reviewRunsRoot, options.run));
  const manifest = readJson(path.join(sourceRunDir, "manifest.json"));
  const failure = manifest?.failures?.find((entry) => entry.id === options.test);
  if (!failure) throw new Error(`Failure not found in run ${options.run}: ${options.test}`);

  const suite = failure.suite === "e2e" ? "e2e" : failure.suite;
  if (!["unit", "integration", "e2e"].includes(suite)) {
    throw new Error(`Unsupported failure suite: ${failure.suite}`);
  }
  const debugDir = path.join(reviewRoot, "debug", `${Date.now()}-${failure.id}`);
  fs.mkdirSync(debugDir, { recursive: true });
  const targetSession = failure.visuals?.at(-1)?.session || 1;
  const args = [
    path.join("tools", "testing", "run-tests.js"),
    suite,
    `--file=${failure.file}`,
    `--test-name-pattern=${exactNamePattern(failure.name)}`,
  ];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      SOAPY_TEST_REVIEW_RUN_DIR: debugDir,
      SOAPY_TEST_DEBUG_MODE: "1",
      SOAPY_TEST_DEBUG_TEST_ID: failure.id,
      SOAPY_TEST_DEBUG_SESSION: String(targetSession),
    },
    stdio: "inherit",
    windowsHide: false,
  });

  const pausePath = path.join(debugDir, "debug-pause.json");
  const continuePath = path.join(debugDir, "debug-continue");
  let promptStarted = false;
  let promptInput = null;
  let promptPromise = null;
  const poll = setInterval(() => {
    if (promptStarted || !fs.existsSync(pausePath)) return;
    promptStarted = true;
    const pause = readJson(pausePath, {});
    promptInput = readline.createInterface({ input: process.stdin, output: process.stdout });
    promptPromise = (async () => {
      try {
        console.log(`\nPaused ${pause.name || failure.name}. Inspect the live app now.`);
        await promptInput.question("Press Enter to close Electron and finish the rerun...");
        fs.writeFileSync(continuePath, "continue\n", "utf8");
      } catch (error) {
        if (error?.code !== "ERR_USE_AFTER_CLOSE") throw error;
      } finally {
        promptInput?.close();
        promptInput = null;
      }
    })();
  }, 100);

  let exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(error && error.stack ? error.stack : error);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code == null ? 1 : code));
  });
  clearInterval(poll);
  promptInput?.close();
  if (promptPromise) await promptPromise;
  if (fs.existsSync(path.join(debugDir, "stopped.json"))) {
    exitCode = 130;
    console.log("\nDebug rerun interrupted by Ctrl+C or test:stop.");
  }
  return exitCode;
}

if (require.main === module) {
  main()
    .then((exitCode) => process.exit(exitCode))
    .catch((error) => {
      console.error(error && error.stack ? error.stack : error);
      process.exit(1);
    });
}

module.exports = { exactNamePattern };
