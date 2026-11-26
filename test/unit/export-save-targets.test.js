const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bootSource = fs.readFileSync(
  path.join(__dirname, "../../app/renderer/src/boot.js"),
  "utf8",
);

const {
  createTimestampedExportName,
  createExportSaveTargetRegistry,
  isDefaultExportPath,
  nextAvailableExportPath,
  normalizeExportSaveOptions,
} = require("../../app/main/export-save-targets");

test("timestamped export names use UTC-safe names and a same-millisecond sequence", () => {
  const timestamp = Date.UTC(2026, 7, 4, 15, 30, 45, 123);
  const names = [
    createTimestampedExportName("png", timestamp),
    createTimestampedExportName("jpg", timestamp),
    createTimestampedExportName("gif", timestamp),
    createTimestampedExportName("mp4", timestamp),
  ];

  assert.equal(names[0], "bubbles-20260804-153045-123.png");
  assert.equal(names[1], "bubbles-20260804-153045-123-1.jpg");
  assert.equal(names[2], "bubbles-20260804-153045-123-2.gif");
  assert.equal(names[3], "bubbles-20260804-153045-123-3.mp4");
  assert.equal(new Set(names).size, names.length);
});

test("automatic export names use the first available number per extension", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "soapy-export-names-"));
  try {
    const png = path.join(tempDir, "bubbles.png");
    fs.writeFileSync(png, "existing");
    fs.writeFileSync(path.join(tempDir, "bubbles2.png"), "existing");
    const timestamped = path.join(tempDir, "bubbles-20260804-153045-123.png");
    fs.writeFileSync(timestamped, "existing");
    assert.equal(nextAvailableExportPath(png), path.join(tempDir, "bubbles1.png"));
    fs.writeFileSync(path.join(tempDir, "bubbles1.png"), "existing");
    assert.equal(
      nextAvailableExportPath(path.join(tempDir, "bubbles1.png")),
      path.join(tempDir, "bubbles3.png"),
    );
    assert.equal(nextAvailableExportPath(path.join(tempDir, "bubbles.gif")), path.join(tempDir, "bubbles.gif"));
    assert.equal(
      nextAvailableExportPath(timestamped),
      path.join(tempDir, "bubbles-20260804-153045-124.png"),
    );
    assert.equal(isDefaultExportPath(png, "bubbles.png"), true);
    assert.equal(isDefaultExportPath(path.join(tempDir, "custom.png"), "bubbles.png"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("automatic save targets retain their collision-safe flag", () => {
  const registry = createExportSaveTargetRegistry();
  const target = registry.add("C:\\Exports\\bubbles.gif", 7, { automatic: true });
  assert.equal(registry.consume(target.targetId, 7).automatic, true);
});

test("custom export names remain unchanged while fallbacks are timestamped", () => {
  const custom = normalizeExportSaveOptions({
    suggestedName: "my-variation.png",
    mime: "image/png",
    extensions: ["png"],
  });
  const fallback = normalizeExportSaveOptions({
    mime: "video/mp4",
    extensions: ["mp4"],
  });

  assert.equal(custom.suggestedName, "my-variation.png");
  assert.match(fallback.suggestedName, /^bubbles-\d{8}-\d{6}-\d{3}(?:-\d+)?\.mp4$/);
});

test("renderer export defaults use the timestamp generator", () => {
  assert.match(bootSource, /function createTimestampedExportName\(extension\)/);
  assert.match(bootSource, /suggestedName:\s*createTimestampedExportName\(extension\)/);
  assert.match(bootSource, /getUTCFullYear\(\)[\s\S]*getUTCMilliseconds\(\)/);
  assert.match(bootSource, /generatedExportSequence\s*\+=\s*1/);
  assert.doesNotMatch(bootSource, /suggestedName:\s*"bubbles\."\s*\+/);
});
