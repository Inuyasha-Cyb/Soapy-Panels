const fs = require("node:fs");
const path = require("node:path");
const { _electron: playwrightElectron } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const profileRoot = path.join(repoRoot, "out", "startup-measurements");

function readArgument(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function summarize(values) {
  return {
    medianMs: Number(percentile(values, 0.5).toFixed(1)),
    p95Ms: Number(percentile(values, 0.95).toFixed(1)),
  };
}

async function closeElectron(electronApp, child) {
  let timedOut = false;
  try {
    await Promise.race([
      electronApp.close(),
      new Promise((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, 1500),
      ),
    ]);
  } catch {
    timedOut = true;
  }
  if (timedOut && child && child.exitCode == null) child.kill();
}

async function measureLaunch(options) {
  fs.rmSync(options.profileDir, { recursive: true, force: true });
  fs.mkdirSync(options.profileDir, { recursive: true });

  const launchOptions = {
    args: options.executablePath
      ? [`--user-data-dir=${options.profileDir}`]
      : [".", `--user-data-dir=${options.profileDir}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      SOAPY_LOG_MAIN: "0",
      SOAPY_STARTUP_METRICS: "1",
    },
  };
  if (options.entitlement) {
    launchOptions.env.SOAPY_DEV_ENTITLEMENT = options.entitlement;
  } else {
    delete launchOptions.env.SOAPY_DEV_ENTITLEMENT;
  }
  if (options.executablePath) launchOptions.executablePath = options.executablePath;

  const electronApp = await playwrightElectron.launch(launchOptions);
  const child = electronApp.process();
  try {
    const page = await electronApp.firstWindow({ timeout: 20000 });
    await page.waitForFunction(
      () =>
        window.SoapyPanels &&
        window.SoapyPanels.debug &&
        window.SoapyPanels.debug.startup &&
        window.SoapyPanels.debug.startup.getSnapshot().phase === "interactive",
      null,
      { timeout: 20000 },
    );
    return page.evaluate(() => window.SoapyPanels.debug.startup.getSnapshot());
  } finally {
    await closeElectron(electronApp, child);
    fs.rmSync(options.profileDir, { recursive: true, force: true });
  }
}

async function main() {
  const iterations = Math.max(1, Number.parseInt(readArgument("iterations", "10"), 10));
  const selectedMode = readArgument("mode", "all").toLowerCase();
  const executableValue = readArgument("executable");
  const executablePath = executableValue
    ? path.resolve(repoRoot, executableValue)
    : "";
  if (executablePath && !fs.existsSync(executablePath)) {
    throw new Error(`Packaged executable not found: ${executablePath}`);
  }

  const availableModes = [
    { name: "standard", entitlement: "" },
    { name: "monthly", entitlement: "monthly" },
    { name: "permanent", entitlement: "permanent" },
  ];
  const modes = selectedMode === "all"
    ? availableModes
    : availableModes.filter((mode) => mode.name === selectedMode);
  if (!modes.length) {
    throw new Error("--mode must be standard, monthly, permanent, or all.");
  }

  fs.mkdirSync(profileRoot, { recursive: true });
  const report = {
    measuredAt: new Date().toISOString(),
    build: executablePath || "development",
    iterations,
    modes: {},
  };

  for (const mode of modes) {
    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
      const snapshot = await measureLaunch({
        entitlement: mode.entitlement,
        executablePath,
        profileDir: path.join(profileRoot, `${mode.name}-${index + 1}`),
      });
      const sample = {
        interactiveMs: snapshot.marks.interactive,
        firstPaintMs:
          snapshot.paints.find((entry) => entry.name === "first-contentful-paint")
            ?.startTime ||
          snapshot.paints.find((entry) => entry.name === "first-paint")?.startTime ||
          null,
        themeReadyMs: snapshot.marks.themeReady,
        canvasReadyMs: snapshot.marks.canvasReady,
      };
      samples.push(sample);
      process.stdout.write(
        `${mode.name} ${index + 1}/${iterations}: ${sample.interactiveMs.toFixed(1)} ms\n`,
      );
    }

    report.modes[mode.name] = {
      firstPaint: summarize(
        samples.map((sample) => sample.firstPaintMs).filter(Number.isFinite),
      ),
      interactive: summarize(samples.map((sample) => sample.interactiveMs)),
      samples,
    };
  }

  const outputValue = readArgument("output");
  if (outputValue) {
    const outputPath = path.resolve(repoRoot, outputValue);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
