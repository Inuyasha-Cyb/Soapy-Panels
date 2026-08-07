const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { getFontCoverageRanges } = require("../shared/font-coverage");

let fontkitLoadAttempted = false;
let fontkitModule = null;

function getFontkit() {
  if (fontkitLoadAttempted) return fontkitModule;
  fontkitLoadAttempted = true;
  try {
    fontkitModule = require("fontkit");
  } catch {
    fontkitModule = null;
  }
  return fontkitModule;
}

function normalizeFontDisplayName(value) {
  const normalized = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "User Font";
}

function guessFontWeight(displayName) {
  const lower = String(displayName || "").toLowerCase();
  const numeric = lower.match(/\b([1-9]00)\b/);
  if (numeric) return numeric[1];
  if (/\b(extra|ultra)[\s-]*bold\b/.test(lower)) return "800";
  if (/\bblack\b/.test(lower)) return "900";
  if (/\bbold\b/.test(lower)) return "700";
  if (/\b(semi|demi)[\s-]*bold\b/.test(lower)) return "600";
  if (/\bmedium\b/.test(lower)) return "500";
  if (/\blight\b/.test(lower)) return "300";
  if (/\bthin\b/.test(lower)) return "100";
  return "400";
}

function guessFontStyle(displayName) {
  return /\b(italic|oblique)\b/i.test(String(displayName || ""))
    ? "italic"
    : "normal";
}

function buildUserFontEntry(filePath, font, ext, href) {
  const baseName = path.basename(filePath, path.extname(filePath)).trim();
  const fallbackName = normalizeFontDisplayName(baseName);
  const family =
    (font && font.familyName && String(font.familyName).trim()) ||
    fallbackName;
  const subfamily =
    (font && font.subfamilyName && String(font.subfamilyName).trim()) || "";
  const fullName =
    (font && font.fullName && String(font.fullName).trim()) ||
    (font && subfamily ? `${family} ${subfamily}` : fallbackName);

  const weightNum =
    font && typeof font.weight === "number" && isFinite(font.weight)
      ? font.weight
      : null;
  const weight = weightNum === null ? guessFontWeight(fullName) : String(Math.round(weightNum));
  const italicAngle =
    font && typeof font.italicAngle === "number" && isFinite(font.italicAngle)
      ? font.italicAngle
      : 0;
  const styleGuess =
    /italic|oblique/i.test(subfamily || fullName) || italicAngle !== 0;
  const style = styleGuess ? "italic" : guessFontStyle(fullName);

  const id = `user:${family}:${weight}:${style}`
    .replace(/\s+/g, "-")
    .toLowerCase();

  const entry = {
    id,
    family,
    label: fullName,
    fallback: "sans-serif",
    weight,
    style,
    href,
    format: ext,
    sources: [{ href, format: ext }],
  };
  const coverageRanges = getFontCoverageRanges(font);
  if (coverageRanges) entry.coverageRanges = coverageRanges;
  return entry;
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    /* ignore */
  }
}

function walkFiles(root, exts) {
  const results = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(root, ent.name);
      if (ent.isDirectory()) {
        results.push(...walkFiles(full, exts));
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (exts.has(ext)) results.push(full);
      }
    }
  } catch {
    /* ignore */
  }
  return results;
}

function watchFolder(folder, onChange) {
  try {
    return fs.watch(folder, { recursive: true }, () => onChange());
  } catch {
    return null;
  }
}

function readGifDataUrl(filePath) {
  try {
    const bytes = fs.readFileSync(filePath);
    return `data:image/gif;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function createUserAssetStore() {
  let stickersDir = null;
  let fontsDir = null;
  let stickerWatcher = null;
  let fontWatcher = null;
  let cachedUserFonts = null;
  let userFontsLoadPromise = null;

  function readUserStickers() {
    if (!stickersDir) return [];
    const files = walkFiles(stickersDir, new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]));
    return files.map((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const base = path.basename(filePath, ext);
      const id = `user:${base}`.replace(/\s+/g, "-").toLowerCase();
      const isGif = ext === ".gif";
      const gifDataUrl = isGif ? readGifDataUrl(filePath) : null;
      const entry = {
        id,
        name: base,
        src: gifDataUrl || pathToFileURL(filePath).toString(),
      };
      if (isGif) {
        entry.mediaKind = "gif";
        entry.mimeType = "image/gif";
      }
      return entry;
    });
  }

  function readUserFonts() {
    if (!fontsDir) return [];
    const files = walkFiles(fontsDir, new Set([".ttf", ".otf", ".woff", ".woff2"]));
    const results = [];

    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const href = pathToFileURL(filePath).toString();
      let opened = null;
      const fontkit = getFontkit();

      if (fontkit && typeof fontkit.openSync === "function") {
        try {
          opened = fontkit.openSync(filePath);
        } catch {
          opened = null;
        }
      }

      const fontList = opened && opened.fonts ? opened.fonts : opened ? [opened] : [];

      if (!fontList.length) {
        results.push(buildUserFontEntry(filePath, null, ext, href));
        continue;
      }

      for (const font of fontList) {
        if (!font) continue;
        results.push(buildUserFontEntry(filePath, font, ext, href));
      }
    }

    cachedUserFonts = results;
    return results;
  }

  function readUserFontsCached() {
    if (cachedUserFonts) return cachedUserFonts;
    return readUserFonts();
  }

  function loadUserFontsAsync(options = {}) {
    if (!options.force && cachedUserFonts) return Promise.resolve(cachedUserFonts);
    if (userFontsLoadPromise) return userFontsLoadPromise;

    userFontsLoadPromise = new Promise((resolve) => {
      const schedule =
        typeof setImmediate === "function" ? setImmediate : (callback) => setTimeout(callback, 0);
      schedule(() => {
        try {
          resolve(readUserFonts());
        } catch {
          cachedUserFonts = [];
          resolve([]);
        } finally {
          userFontsLoadPromise = null;
        }
      });
    });

    return userFontsLoadPromise;
  }

  function initialize(userDataDir, handlers = {}) {
    stickersDir = path.join(userDataDir, "stickers");
    fontsDir = path.join(userDataDir, "fonts");
    ensureDir(stickersDir);
    ensureDir(fontsDir);

    stickerWatcher = watchFolder(stickersDir, () => {
      if (typeof handlers.onStickersChanged === "function") {
        handlers.onStickersChanged(readUserStickers());
      }
    });
    fontWatcher = watchFolder(fontsDir, () => {
      if (typeof handlers.onFontsChanged === "function") {
        cachedUserFonts = null;
        loadUserFontsAsync({ force: true }).then((fonts) => {
          handlers.onFontsChanged(fonts);
        });
      }
    });
  }

  function close() {
    try {
      stickerWatcher && stickerWatcher.close();
    } catch {
      /* ignore */
    }
    try {
      fontWatcher && fontWatcher.close();
    } catch {
      /* ignore */
    }
  }

  function importUserFontFolder(sourceFolder) {
    try {
      if (!fontsDir) {
        return { ok: false, imported: 0, skipped: 0, error: "Store not initialized" };
      }
      const fontExts = new Set([".ttf", ".otf", ".woff", ".woff2"]);
      const files = walkFiles(sourceFolder, fontExts);
      let imported = 0;
      let skipped = 0;

      for (const file of files) {
        const dest = path.join(fontsDir, path.basename(file));
        if (fs.existsSync(dest)) {
          skipped++;
        } else {
          fs.copyFileSync(file, dest);
          imported++;
        }
      }
      return { ok: true, imported, skipped };
    } catch (err) {
      return { ok: false, imported: 0, skipped: 0, error: err.message };
    }
  }

  return {
    initialize,
    close,
    readUserStickers,
    readUserFonts,
    readUserFontsCached,
    loadUserFontsAsync,
    importUserFontFolder,
  };
}

module.exports = {
  createUserAssetStore,
  ensureDir,
  walkFiles,
};
