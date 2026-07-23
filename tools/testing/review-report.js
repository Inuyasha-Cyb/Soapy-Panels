const fs = require("node:fs");
const path = require("node:path");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");
const {
  approvedBaselinesRoot,
  ensurePathInside,
  escapeHtml,
  localBaselinesRoot,
  readJson,
  relativeRepoPath,
  repoRoot,
  reviewRoot,
  reviewRunsRoot,
  stableTestId,
  writeJson,
} = require("./review-common");

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function readReporterEvents(runDir) {
  return fs
    .readdirSync(runDir)
    .filter((name) => /^events-.+\.jsonl$/.test(name))
    .sort()
    .flatMap((name) => {
      const suite = name.slice("events-".length, -".jsonl".length);
      return readJsonLines(path.join(runDir, name)).map((event) => ({ ...event, suite }));
    });
}

function failureFrame(failure) {
  const stack = String(failure.error?.stack || "");
  const expression = /\(?((?:[A-Za-z]:)?[^()\r\n]+?\.js):(\d+):(\d+)\)?/g;
  let match;
  while ((match = expression.exec(stack))) {
    const file = match[1];
    const absolute = path.isAbsolute(file) ? path.resolve(file) : path.resolve(repoRoot, file);
    const relative = path.relative(repoRoot, absolute);
    if (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      !relative.includes("node_modules")
    ) {
      return { file: relativeRepoPath(absolute), line: Number(match[2]), column: Number(match[3]) };
    }
  }
  return {
    file: relativeRepoPath(failure.file),
    line: Number(failure.line) || null,
    column: Number(failure.column) || null,
  };
}

function sourceExcerpt(frame) {
  if (!frame.file || !frame.line) return null;
  const absolute = path.resolve(repoRoot, frame.file);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(absolute)) {
    return null;
  }
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/);
  const start = Math.max(1, frame.line - 4);
  const end = Math.min(lines.length, frame.line + 4);
  return {
    file: frame.file,
    line: frame.line,
    column: frame.column,
    lines: Array.from({ length: end - start + 1 }, (_, index) => {
      const number = start + index;
      return { number, text: lines[number - 1], failing: number === frame.line };
    }),
  };
}

function loadE2eManifests(runDir) {
  const root = path.join(runDir, "e2e");
  if (!fs.existsSync(root)) return new Map();
  const manifests = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readJson(path.join(root, entry.name, "test.json"));
    if (manifest?.id) manifests.set(manifest.id, manifest);
  }
  return manifests;
}

function matchingE2eManifest(manifests, provisionalId, event) {
  const exact = manifests.get(provisionalId);
  if (exact) return exact;
  const candidates = Array.from(manifests.values()).filter(
    (manifest) => manifest.status === "failed" && manifest.name === event.name,
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function paddedPixels(png, width, height) {
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < png.height; y += 1) {
    const sourceStart = y * png.width * 4;
    const targetStart = y * width * 4;
    png.data.copy(output, targetStart, sourceStart, sourceStart + png.width * 4);
  }
  return output;
}

function comparePng(actualPath, expectedPath, outputPath) {
  try {
    const actual = PNG.sync.read(fs.readFileSync(actualPath));
    const expected = PNG.sync.read(fs.readFileSync(expectedPath));
    const width = Math.max(actual.width, expected.width);
    const height = Math.max(actual.height, expected.height);
    const actualPixels = paddedPixels(actual, width, height);
    const expectedPixels = paddedPixels(expected, width, height);
    const diff = new PNG({ width, height });
    const mismatchPixels = pixelmatch(
      expectedPixels,
      actualPixels,
      diff.data,
      width,
      height,
      { threshold: 0.1, includeAA: true },
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, PNG.sync.write(diff));
    return {
      mismatchPixels,
      totalPixels: width * height,
      mismatchPercent: Number(((mismatchPixels / (width * height)) * 100).toFixed(4)),
      dimensionsMatch: actual.width === expected.width && actual.height === expected.height,
      actualSize: { width: actual.width, height: actual.height },
      expectedSize: { width: expected.width, height: expected.height },
    };
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

function hasVisualBaseline(directory) {
  if (!fs.existsSync(directory)) return false;
  return fs.readdirSync(directory, { withFileTypes: true }).some((entry) => {
    if (!entry.isDirectory() || !/^session-\d+$/.test(entry.name)) return false;
    const sessionDir = path.join(directory, entry.name);
    return ["actual-window.png", "actual-canvas.png"].some((filename) =>
      fs.existsSync(path.join(sessionDir, filename)),
    );
  });
}

function baselineFor(testId, roots = {}) {
  const approvedRoot = roots.approved || approvedBaselinesRoot;
  const localRoot = roots.local || localBaselinesRoot;
  const approved = path.join(approvedRoot, testId);
  if (hasVisualBaseline(approved)) return { source: "approved", directory: approved };
  const local = path.join(localRoot, testId);
  if (hasVisualBaseline(local)) {
    return { source: "last passing local run", directory: local };
  }
  return { source: "missing", directory: null };
}

function sessionDirectory(root, artifact) {
  if (!root || !artifact) return null;
  return path.join(root, path.basename(artifact.directory));
}

function buildVisualComparisons(runDir, failure, e2eManifest) {
  if (!e2eManifest?.artifacts?.length) return [];
  const baseline = baselineFor(failure.id);
  const baselineManifest = baseline.directory
    ? readJson(path.join(baseline.directory, "test.json"), { artifacts: [] })
    : { artifacts: [] };

  return e2eManifest.artifacts.map((artifact, artifactIndex) => {
    const expectedArtifact =
      baselineManifest.artifacts?.find((entry) => entry.session === artifact.session) || null;
    const actualDir = path.resolve(runDir, artifact.directory);
    const expectedDir = sessionDirectory(baseline.directory, expectedArtifact);
    const comparisonDir = path.join(
      runDir,
      "comparisons",
      failure.id,
      `session-${String(artifact.session).padStart(2, "0")}`,
    );
    fs.mkdirSync(comparisonDir, { recursive: true });

    const result = {
      session: artifact.session,
      associatedWithFailure: artifactIndex === e2eManifest.artifacts.length - 1,
      baselineSource: baseline.source,
      captureErrors: artifact.captureErrors || [],
      actualWindow: artifact.window,
      actualCanvas: artifact.canvas,
      actualState: artifact.state,
      expectedWindow: null,
      expectedCanvas: null,
      expectedState: null,
      windowDiff: null,
      canvasDiff: null,
      windowStats: null,
      canvasStats: null,
      actualStateValue: artifact.state
        ? readJson(path.resolve(runDir, artifact.state))
        : null,
      expectedStateValue: null,
    };

    for (const kind of ["window", "canvas"]) {
      const filename = `actual-${kind}.png`;
      const actualPath = path.join(actualDir, filename);
      const expectedPath = expectedDir ? path.join(expectedDir, filename) : null;
      if (!fs.existsSync(actualPath) || !expectedPath || !fs.existsSync(expectedPath)) continue;
      const copiedExpected = path.join(comparisonDir, `expected-${kind}.png`);
      fs.copyFileSync(expectedPath, copiedExpected);
      const diffPath = path.join(comparisonDir, `diff-${kind}.png`);
      result[`expected${kind[0].toUpperCase()}${kind.slice(1)}`] = path
        .relative(runDir, copiedExpected)
        .replaceAll("\\", "/");
      result[`${kind}Diff`] = path.relative(runDir, diffPath).replaceAll("\\", "/");
      result[`${kind}Stats`] = comparePng(actualPath, expectedPath, diffPath);
    }

    const expectedStatePath = expectedDir ? path.join(expectedDir, "actual-state.json") : null;
    if (expectedStatePath && fs.existsSync(expectedStatePath)) {
      const copiedExpectedState = path.join(comparisonDir, "expected-state.json");
      fs.copyFileSync(expectedStatePath, copiedExpectedState);
      result.expectedState = path.relative(runDir, copiedExpectedState).replaceAll("\\", "/");
      result.expectedStateValue = readJson(expectedStatePath);
    }
    return result;
  });
}

function formatJson(value, available = true) {
  if (!available) return "Not provided by this error.";
  return JSON.stringify(value, null, 2);
}

function renderDataDiff(error) {
  if (!error.hasExpected || !error.hasActual) {
    return '<p class="missing">A structured difference is unavailable because this error did not provide both expected and actual data.</p>';
  }
  const expectedLines = formatJson(error.expected).split("\n");
  const actualLines = formatJson(error.actual).split("\n");
  const count = Math.max(expectedLines.length, actualLines.length);
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    const expected = expectedLines[index];
    const actual = actualLines[index];
    if (expected === actual) {
      lines.push(`<span class="diff-same">  ${escapeHtml(expected ?? "")}</span>`);
      continue;
    }
    if (expected !== undefined) {
      lines.push(`<span class="diff-remove">- ${escapeHtml(expected)}</span>`);
    }
    if (actual !== undefined) {
      lines.push(`<span class="diff-add">+ ${escapeHtml(actual)}</span>`);
    }
  }
  return `<pre class="data-diff">${lines.join("\n")}</pre>`;
}

function renderSource(source) {
  if (!source) return '<p class="missing">No workspace source frame was available.</p>';
  const rows = source.lines
    .map(
      (line) =>
        `<span class="source-line${line.failing ? " failing" : ""}"><b>${line.number}</b>${escapeHtml(line.text)}</span>`,
    )
    .join("");
  return `<p><code>${escapeHtml(source.file)}:${source.line}:${source.column || 1}</code></p><pre class="source">${rows}</pre>`;
}

function imagePanel(label, imagePath, missingMessage) {
  if (!imagePath) return `<div class="image-card"><h4>${escapeHtml(label)}</h4><p class="missing">${escapeHtml(missingMessage)}</p></div>`;
  return `<div class="image-card"><h4>${escapeHtml(label)}</h4><a href="${escapeHtml(imagePath)}"><img src="${escapeHtml(imagePath)}" alt="${escapeHtml(label)}"></a></div>`;
}

function renderVisuals(visuals) {
  if (!visuals.length) {
    return '<p class="missing">No Electron session was available for this failure.</p>';
  }
  return visuals
    .map((visual) => {
      const windowStats = visual.windowStats ? escapeHtml(JSON.stringify(visual.windowStats)) : "";
      const canvasStats = visual.canvasStats ? escapeHtml(JSON.stringify(visual.canvasStats)) : "";
      const association = visual.associatedWithFailure
        ? '<span class="badge">associated with failure</span>'
        : "";
      return `<section class="session"><h3>App session ${visual.session} <span class="badge">${escapeHtml(visual.baselineSource)}</span> ${association}</h3>
        <div class="image-grid">
          ${imagePanel("Expected app", visual.expectedWindow, "No expected app image exists yet.")}
          ${imagePanel("Actual app", visual.actualWindow, "App screenshot capture failed.")}
          ${imagePanel("App difference", visual.windowDiff, "A difference image requires an expected baseline.")}
        </div><p class="stats">${windowStats}</p>
        <div class="image-grid">
          ${imagePanel("Expected canvas", visual.expectedCanvas, "No expected canvas image exists yet.")}
          ${imagePanel("Actual canvas", visual.actualCanvas, "Canvas screenshot was unavailable.")}
          ${imagePanel("Canvas difference", visual.canvasDiff, "A difference image requires an expected baseline.")}
        </div><p class="stats">${canvasStats}</p>
        <details><summary>Expected renderer state</summary><pre>${escapeHtml(formatJson(visual.expectedStateValue, !!visual.expectedState))}</pre></details>
        <details><summary>Actual renderer state</summary><pre>${escapeHtml(formatJson(visual.actualStateValue, !!visual.actualState))}</pre></details>
        ${visual.captureErrors.length ? `<pre class="error">${escapeHtml(visual.captureErrors.join("\n"))}</pre>` : ""}
      </section>`;
    })
    .join("");
}

function renderFailure(failure) {
  const error = failure.error || {};
  const debugCommand = `npm run test:debug -- --run=${failure.runId} --test=${failure.id}`;
  const approvalSuffix = failure.baselineApproved ? " --replace=true" : "";
  const approveCommand = `npm run test:approve -- --run=${failure.runId} --test=${failure.id}${approvalSuffix}`;
  const hasApprovableImage = failure.visuals.some(
    (visual) => visual.actualWindow || visual.actualCanvas,
  );
  const approvalControl = hasApprovableImage
    ? `<strong>Approve current visuals</strong><code>${escapeHtml(approveCommand)}</code>`
    : '<strong>Visual approval</strong><span class="missing">Unavailable: this failure has no captured Electron images.</span>';
  return `<article class="failure" id="${escapeHtml(failure.id)}">
    <h2>${escapeHtml(failure.name)}</h2>
    <p><code>${escapeHtml(failure.file)}</code> · ${escapeHtml(failure.suite)} · ${escapeHtml(failure.durationMs ?? "unknown")} ms</p>
    <div class="commands"><strong>Focused rerun</strong><code>${escapeHtml(debugCommand)}</code>${approvalControl}</div>
    <h3>Error</h3><pre class="error">${escapeHtml(error.message || "Test failed without an error message.")}</pre>
    <p><strong>Assertion operator:</strong> <code>${escapeHtml(error.operator || "not provided")}</code></p>
    <div class="data-grid"><section><h3>Expected data</h3><pre>${escapeHtml(formatJson(error.expected, error.hasExpected))}</pre></section><section><h3>Actual data</h3><pre>${escapeHtml(formatJson(error.actual, error.hasActual))}</pre></section></div>
    <h3>Data difference</h3>${renderDataDiff(error)}
    <details open><summary>Failing source</summary>${renderSource(failure.source)}</details>
    <details><summary>Raw error</summary><pre>${escapeHtml(formatJson(error.raw, !!error.raw))}</pre></details>
    <details><summary>Stack</summary><pre>${escapeHtml(error.stack || "No stack was provided.")}</pre></details>
    <h3>Visual and renderer-state comparison</h3>${renderVisuals(failure.visuals)}
  </article>`;
}

function renderHtml(summary) {
  const navigation = summary.failures
    .map((failure) => `<li><a href="#${escapeHtml(failure.id)}">${escapeHtml(failure.name)}</a></li>`)
    .join("");
  const failures = summary.failures.map(renderFailure).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Soapy Panels test failure review</title><style>
  :root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#111827;color:#e5e7eb}header,main{max-width:1500px;margin:auto;padding:24px}header{background:#1f2937;border-bottom:1px solid #374151}a{color:#7dd3fc}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.summary{display:flex;gap:12px;flex-wrap:wrap}.badge{font-size:12px;padding:3px 8px;border-radius:999px;background:#374151}.failure,.session,details,.data-grid>section{background:#1f2937;border:1px solid #374151;border-radius:10px;padding:16px;margin:18px 0}.failure{border-left:5px solid #ef4444}.commands{display:grid;grid-template-columns:max-content 1fr;gap:8px 12px;align-items:center}.commands code{padding:8px;background:#111827;overflow:auto}.data-grid,.image-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.image-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.image-card{background:#111827;border-radius:8px;padding:10px;min-width:0}.image-card img{display:block;width:100%;max-height:600px;object-fit:contain;background:#0b1020}.missing{color:#fbbf24}.error{color:#fecaca;background:#450a0a}pre{white-space:pre-wrap;overflow:auto;background:#111827;padding:12px;border-radius:6px}.data-diff span,.source-line{display:block}.diff-remove{color:#fecaca;background:#450a0a}.diff-add{color:#bbf7d0;background:#052e16}.diff-same{color:#9ca3af}.source-line b{display:inline-block;width:4em;color:#9ca3af}.source-line.failing{background:#7f1d1d}.stats{font-size:12px;color:#9ca3af}@media(max-width:900px){.data-grid,.image-grid{grid-template-columns:1fr}.commands{grid-template-columns:1fr}}
  </style></head><body><header><h1>Soapy Panels test failure review</h1><div class="summary"><span class="badge">Run ${escapeHtml(summary.runId)}</span><span class="badge">Suite ${escapeHtml(summary.selection)}</span><span class="badge">Exit ${summary.exitCode}</span><span class="badge">${summary.failures.length} failure(s)</span></div></header><main>
  ${summary.failures.length ? `<nav><h2>Failures</h2><ol>${navigation}</ol></nav>${failures}` : "<h2>No failures were reported.</h2>"}
  <details><summary>Complete terminal log</summary><pre>${escapeHtml(summary.terminalLog || "No terminal log was captured.")}</pre></details>
  </main></body></html>`;
}

function retainRecentRuns(currentRunDir, keep = 10, runsRoot = reviewRunsRoot) {
  if (!fs.existsSync(runsRoot)) return;
  const directories = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      path: path.join(runsRoot, entry.name),
      mtime: fs.statSync(path.join(runsRoot, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of directories.slice(keep)) {
    if (path.resolve(entry.path) === path.resolve(currentRunDir)) continue;
    ensurePathInside(runsRoot, entry.path);
    fs.rmSync(entry.path, { recursive: true, force: true });
  }
}

function buildReviewReport({
  runDir,
  runId,
  selection,
  exitCode,
  publishLatest = true,
  retainRuns = true,
}) {
  const events = readReporterEvents(runDir);
  const e2eManifests = loadE2eManifests(runDir);
  const seen = new Set();
  const failures = [];
  for (const event of events.filter((entry) => entry.type === "test:fail" && entry.error)) {
    const frame = failureFrame(event);
    let file = relativeRepoPath(event.file) || frame.file;
    let id = stableTestId(file, event.name);
    const e2eManifest = matchingE2eManifest(e2eManifests, id, event);
    if (e2eManifest) {
      file = e2eManifest.file;
      id = e2eManifest.id;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const failure = {
      id,
      runId,
      name: event.name,
      file,
      suite: event.suite,
      durationMs: event.durationMs,
      error: event.error,
      source: sourceExcerpt(frame),
      visuals: [],
      baselineApproved: baselineFor(id).source === "approved",
    };
    failure.visuals = buildVisualComparisons(runDir, failure, e2eManifest);
    failures.push(failure);
  }

  if (exitCode !== 0 && failures.length === 0) {
    const interrupted = exitCode === 130 || exitCode === 143;
    const name = interrupted ? "Test run interrupted" : "Test process failure";
    const id = stableTestId("tools/testing/run-tests.js", name);
    failures.push({
      id,
      runId,
      name,
      file: "tools/testing/run-tests.js",
      suite: selection,
      durationMs: null,
      error: {
        message:
          interrupted
            ? "The test run was interrupted before it produced a structured test failure. No pass or fail result is claimed."
            : "The test process exited unsuccessfully without a structured test failure event. See the terminal log.",
        stack: "",
        hasActual: false,
        hasExpected: false,
        actual: null,
        expected: null,
      },
      source: null,
      visuals: [],
      baselineApproved: false,
    });
  }

  const terminalLogPath = path.join(runDir, "terminal.log");
  const summary = {
    version: 1,
    runId,
    selection,
    exitCode,
    interrupted: exitCode === 130 || exitCode === 143,
    generatedAt: new Date().toISOString(),
    failures,
    terminalLog: fs.existsSync(terminalLogPath)
      ? fs.readFileSync(terminalLogPath, "utf8")
      : "",
  };
  writeJson(path.join(runDir, "manifest.json"), summary);
  fs.writeFileSync(path.join(runDir, "index.html"), renderHtml(summary), "utf8");

  if (publishLatest) {
    fs.mkdirSync(reviewRoot, { recursive: true });
    const latestRelative = path.relative(reviewRoot, path.join(runDir, "index.html")).replaceAll("\\", "/");
    fs.writeFileSync(
      path.join(reviewRoot, "latest.html"),
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapeHtml(latestRelative)}"><a href="${escapeHtml(latestRelative)}">Open latest test review</a>`,
      "utf8",
    );
  }
  if (retainRuns) retainRecentRuns(runDir);
  return summary;
}

module.exports = {
  baselineFor,
  buildReviewReport,
  comparePng,
  renderDataDiff,
  renderHtml,
  retainRecentRuns,
  sourceExcerpt,
};
