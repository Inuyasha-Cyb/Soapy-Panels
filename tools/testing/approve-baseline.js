const fs = require("node:fs");
const path = require("node:path");
const {
  approvedBaselinesRoot,
  ensurePathInside,
  parseCliOptions,
  readJson,
  reviewRunsRoot,
  writeJson,
} = require("./review-common");

function approveBaseline(options) {
  options.run ||= options._?.[0];
  options.test ||= options._?.[1];
  const replaceRequested = options.replace === true || options.replace === "true";
  if (!options.run || !options.test) {
    throw new Error("Usage: npm run test:approve -- --run=<run-id> --test=<test-id>");
  }
  const runDir = ensurePathInside(reviewRunsRoot, path.join(reviewRunsRoot, options.run));
  const manifest = readJson(path.join(runDir, "manifest.json"));
  const failure = manifest?.failures?.find((entry) => entry.id === options.test);
  if (!failure) throw new Error(`Failure not found in run ${options.run}: ${options.test}`);

  const sourceDir = ensurePathInside(path.join(runDir, "e2e"), path.join(runDir, "e2e", failure.id));
  if (!fs.existsSync(sourceDir)) {
    throw new Error("This failure has no E2E visual artifacts to approve.");
  }
  const sourceManifest = readJson(path.join(sourceDir, "test.json"));
  const approvableImages = (sourceManifest?.artifacts || []).flatMap((artifact) =>
    [artifact.window, artifact.canvas]
      .filter(Boolean)
      .map((imagePath) => path.resolve(runDir, imagePath))
      .filter((imagePath) => {
        try {
          ensurePathInside(sourceDir, imagePath);
          return fs.existsSync(imagePath);
        } catch {
          return false;
        }
      }),
  );
  if (approvableImages.length === 0) {
    throw new Error("This failure has no captured PNG artifacts to approve.");
  }
  const targetDir = path.join(approvedBaselinesRoot, failure.id);
  ensurePathInside(approvedBaselinesRoot, targetDir);
  if (fs.existsSync(targetDir) && !replaceRequested) {
    throw new Error("An approved baseline already exists. Re-run the printed command with --replace.");
  }
  const stagedDir = `${targetDir}.staged-${process.pid}-${Date.now()}`;
  ensurePathInside(approvedBaselinesRoot, stagedDir);
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  try {
    fs.cpSync(sourceDir, stagedDir, { recursive: true });
    writeJson(path.join(stagedDir, "baseline.json"), {
      version: 1,
      testId: failure.id,
      name: failure.name,
      file: failure.file,
      approvedAt: new Date().toISOString(),
      sourceRun: options.run,
    });
    if (replaceRequested) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.renameSync(stagedDir, targetDir);
  } finally {
    fs.rmSync(stagedDir, { recursive: true, force: true });
  }
  console.log(`Approved visual baseline: ${targetDir}`);
  return targetDir;
}

function main() {
  approveBaseline(parseCliOptions(process.argv.slice(2)));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = { approveBaseline };
