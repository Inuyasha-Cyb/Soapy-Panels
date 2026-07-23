const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const repoRoot = path.resolve(__dirname, "..", "..");
const reviewRoot = path.join(repoRoot, "out", "test-review");
const reviewRunsRoot = path.join(reviewRoot, "runs");
const localBaselinesRoot = path.join(reviewRoot, "baselines");
const approvedBaselinesRoot = path.join(
  repoRoot,
  "test",
  "fixtures",
  "visual-baselines",
);

function normalizeSlashes(value) {
  return String(value || "").replaceAll("\\", "/");
}

function relativeRepoPath(filePath) {
  if (!filePath) return "";
  if (String(filePath).startsWith("file:")) {
    try {
      filePath = fileURLToPath(filePath);
    } catch {
      // Fall through and display the original reporter value.
    }
  }
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(repoRoot, filePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return normalizeSlashes(relative);
  }
  return normalizeSlashes(filePath);
}

function slugify(value, maxLength = 56) {
  const slug = String(value || "test")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (slug || "test").slice(0, maxLength).replace(/-+$/g, "");
}

function stableTestId(filePath, testName) {
  const relativeFile = relativeRepoPath(filePath);
  const hash = nodeCrypto
    .createHash("sha256")
    .update(`${relativeFile}\0${String(testName || "")}`)
    .digest("hex")
    .slice(0, 12);
  return `${slugify(testName)}-${hash}`;
}

function sha256(value) {
  return nodeCrypto.createHash("sha256").update(value).digest("hex");
}

function replacePath(value, source, replacement) {
  const escaped = String(source).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), replacement);
}

function sanitizeString(value) {
  let sanitized = value.replace(/data:[^\s"'<>]+/gi, (url) => {
    const comma = url.indexOf(",");
    const header = comma >= 0 ? url.slice(5, comma) : url.slice(5, 120);
    return `<data-url type="${header.slice(0, 100)}" length=${url.length} sha256=${sha256(url).slice(0, 16)}>`;
  });
  sanitized = sanitized.replace(/blob:[^\s"'<>]+/gi, (url) =>
    `<blob-url length=${url.length} sha256=${sha256(url).slice(0, 16)}>`,
  );
  const redactions = [
    [repoRoot, "<repo>"],
    [process.env.USERPROFILE, "%USERPROFILE%"],
    [process.env.TEMP, "%TEMP%"],
    [process.env.TMP, "%TEMP%"],
    [os.tmpdir(), "%TEMP%"],
  ]
    .filter(([source]) => source)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [source, replacement] of redactions) {
    sanitized = replacePath(sanitized, source, replacement);
    sanitized = replacePath(sanitized, normalizeSlashes(source), replacement);
  }
  if (sanitized.length <= 8000) return sanitized;
  return `${sanitized.slice(0, 8000)}\n<… ${sanitized.length - 8000} characters omitted; sha256=${sha256(sanitized)}>`;
}

function sanitizeValue(value, options = {}, state = null) {
  const settings = {
    maxArray: options.maxArray || 250,
    maxDepth: options.maxDepth || 10,
    maxKeys: options.maxKeys || 200,
  };
  const traversal = state || { depth: 0, seen: new WeakSet() };

  if (value === undefined) return { $type: "undefined" };
  if (typeof value === "bigint") return { $type: "bigint", value: String(value) };
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { $type: "number", value: String(value) };
  }
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "function") {
    return { $type: "function", name: value.name || "anonymous" };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    return {
      $type: Buffer.isBuffer(value) ? "Buffer" : value.constructor.name,
      length: buffer.length,
      sha256: sha256(buffer),
      previewHex: buffer.subarray(0, 64).toString("hex"),
    };
  }
  if (value instanceof Error) {
    if (traversal.depth >= settings.maxDepth) return { $type: "max-depth" };
    if (traversal.seen.has(value)) return { $type: "circular-reference" };
    traversal.seen.add(value);
    const sanitizedError = {
      $type: value.name || "Error",
      message: sanitizeString(value.message || ""),
      stack: sanitizeString(value.stack || ""),
    };
    for (const key of Object.keys(value).sort()) {
      sanitizedError[key] = sanitizeValue(value[key], settings, {
        depth: traversal.depth + 1,
        seen: traversal.seen,
      });
    }
    return sanitizedError;
  }
  if (typeof value !== "object") return sanitizeString(String(value));
  if (traversal.depth >= settings.maxDepth) return { $type: "max-depth" };
  if (traversal.seen.has(value)) return { $type: "circular-reference" };
  traversal.seen.add(value);

  if (Array.isArray(value)) {
    const result = value.slice(0, settings.maxArray).map((entry) =>
      sanitizeValue(entry, settings, {
        depth: traversal.depth + 1,
        seen: traversal.seen,
      }),
    );
    if (value.length > settings.maxArray) {
      result.push({ $type: "omitted-items", count: value.length - settings.maxArray });
    }
    return result;
  }

  const output = {};
  const keys = Object.keys(value).sort();
  for (const key of keys.slice(0, settings.maxKeys)) {
    try {
      output[key] = sanitizeValue(value[key], settings, {
        depth: traversal.depth + 1,
        seen: traversal.seen,
      });
    } catch (error) {
      output[key] = { $type: "unreadable", message: String(error.message || error) };
    }
  }
  if (keys.length > settings.maxKeys) {
    output.$omittedKeys = keys.length - settings.maxKeys;
  }
  return output;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensurePathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the allowed directory: ${candidate}`);
  }
  return candidate;
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${process.pid}`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCliOptions(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals >= 0) {
      options[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

module.exports = {
  approvedBaselinesRoot,
  createRunId,
  ensurePathInside,
  escapeHtml,
  localBaselinesRoot,
  normalizeSlashes,
  parseCliOptions,
  readJson,
  relativeRepoPath,
  repoRoot,
  reviewRoot,
  reviewRunsRoot,
  sanitizeValue,
  stableTestId,
  writeJson,
};
