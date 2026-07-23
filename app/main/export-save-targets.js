const path = require("path");
const crypto = require("crypto");

const EXPORT_MIME_EXTENSIONS = Object.freeze({
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "video/mp4": ["mp4"],
});

function normalizeExtension(value) {
  if (typeof value !== "string") return "";
  const clean = value.trim().replace(/^\.+/, "").toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(clean) ? clean : "";
}

function normalizeExportSaveOptions(options) {
  const source = options && typeof options === "object" ? options : {};
  const mime = typeof source.mime === "string" ? source.mime.trim().toLowerCase() : "";
  const allowedExtensions = EXPORT_MIME_EXTENSIONS[mime];
  if (!allowedExtensions) {
    throw new Error("Unsupported export file type.");
  }

  const requestedExtensions = Array.isArray(source.extensions)
    ? source.extensions.map(normalizeExtension).filter(Boolean)
    : [];
  const extensions = requestedExtensions.filter((ext) => allowedExtensions.includes(ext));
  const finalExtensions = extensions.length ? Array.from(new Set(extensions)) : allowedExtensions;
  const primaryExtension = finalExtensions[0];

  let suggestedName = typeof source.suggestedName === "string" ? source.suggestedName.trim() : "";
  suggestedName = suggestedName ? path.basename(suggestedName) : `bubbles.${primaryExtension}`;
  if (!suggestedName || suggestedName === "." || suggestedName === "..") {
    suggestedName = `bubbles.${primaryExtension}`;
  }
  const currentExt = normalizeExtension(path.extname(suggestedName));
  if (!finalExtensions.includes(currentExt)) {
    suggestedName = `${suggestedName.replace(/\.+$/, "")}.${primaryExtension}`;
  }

  const description =
    typeof source.description === "string" && source.description.trim()
      ? source.description.trim()
      : "Export";

  return {
    suggestedName,
    mime,
    extensions: finalExtensions,
    description,
    filters: [{ name: description, extensions: finalExtensions }],
  };
}

function ensureExportPathExtension(filePath, extensions) {
  if (typeof filePath !== "string" || !filePath) {
    throw new Error("Export target path is required.");
  }
  const allowed = Array.isArray(extensions)
    ? extensions.map(normalizeExtension).filter(Boolean)
    : [];
  if (!allowed.length) return filePath;
  const current = normalizeExtension(path.extname(filePath));
  if (allowed.includes(current)) return filePath;
  return `${filePath.replace(/\.+$/, "")}.${allowed[0]}`;
}

function createExportSaveTargetRegistry() {
  const targets = new Map();

  function createId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
  }

  return {
    add(filePath, webContentsId) {
      if (typeof filePath !== "string" || !filePath) {
        throw new Error("Export target path is required.");
      }
      const targetId = createId();
      targets.set(targetId, {
        filePath,
        webContentsId: Number.isInteger(webContentsId) ? webContentsId : null,
      });
      return {
        targetId,
        fileName: path.basename(filePath),
      };
    },
    consume(targetId, webContentsId) {
      const key = typeof targetId === "string" ? targetId : "";
      const target = targets.get(key);
      if (!target) throw new Error("Export save target is no longer available.");
      const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
      if (target.webContentsId !== null && senderId !== target.webContentsId) {
        throw new Error("Export save target does not belong to this window.");
      }
      targets.delete(key);
      return target;
    },
    discard(targetId, webContentsId) {
      const key = typeof targetId === "string" ? targetId : "";
      const target = targets.get(key);
      if (!target) return false;
      const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
      if (target.webContentsId !== null && senderId !== target.webContentsId) return false;
      targets.delete(key);
      return true;
    },
    clearForWebContents(webContentsId) {
      const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
      for (const [targetId, target] of targets) {
        if (target.webContentsId === senderId) targets.delete(targetId);
      }
    },
    size() {
      return targets.size;
    },
  };
}

module.exports = {
  EXPORT_MIME_EXTENSIONS,
  ensureExportPathExtension,
  normalizeExportSaveOptions,
  createExportSaveTargetRegistry,
};
