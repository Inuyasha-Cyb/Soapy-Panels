const fs = require("node:fs");
const path = require("node:path");
const { _electron: playwrightElectron } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const profileDir = path.join(repoRoot, "out", "ipc-latency-profile");

function readArgument(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

async function main() {
  const iterations = Math.max(100, Number.parseInt(readArgument("iterations", "1000"), 10));
  const warmup = Math.max(0, Number.parseInt(readArgument("warmup", "50"), 10));
  const outputValue = readArgument("output");
  const outputPath = outputValue ? path.resolve(repoRoot, outputValue) : "";

  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const electronApp = await playwrightElectron.launch({
    args: [".", `--user-data-dir=${profileDir}`],
    cwd: repoRoot,
    env: { ...process.env, SOAPY_LOG_MAIN: "0" },
  });

  try {
    const page = await electronApp.firstWindow({ timeout: 20000 });
    await page.waitForFunction(
      () => window.electronApi && typeof window.electronApi.getAppZoomFactor === "function",
      null,
      { timeout: 20000 },
    );
    const samples = await page.evaluate(async ({ iterations: count, warmup: warmupCount }) => {
      for (let index = 0; index < warmupCount; index += 1) {
        await window.electronApi.getAppZoomFactor();
      }
      const timings = [];
      for (let index = 0; index < count; index += 1) {
        const started = performance.now();
        await window.electronApi.getAppZoomFactor();
        timings.push(performance.now() - started);
      }
      return timings;
    }, { iterations, warmup });

    const report = {
      measuredAt: new Date().toISOString(),
      iterations,
      warmup,
      medianMs: Number(percentile(samples, 0.5).toFixed(4)),
      p95Ms: Number(percentile(samples, 0.95).toFixed(4)),
      maxMs: Number(Math.max(...samples).toFixed(4)),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await electronApp.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
