'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { getFontCoverageRanges } = require('../../../../shared/font-coverage');
const {
  ensureLocalFontsDirectorySync,
  getLocalFontsDirectory,
} = require('./config');

const emittedWarnings = new Set();

function warnOnce(key, message) {
  if (emittedWarnings.has(key)) return;
  console.warn(message);
  emittedWarnings.add(key);
}

let fontkit = null;
try {
  // fontkit is optional; when unavailable we fall back to filename heuristics.
  fontkit = require('fontkit');
} catch (error) {
  warnOnce(
    'fontkit-missing',
    `[local-fonts] fontkit unavailable (${error.message}); falling back to filename metadata.`,
  );
}

const SUPPORTED_EXTENSIONS = new Map([
  ['.ttf', 'truetype'],
  ['.otf', 'opentype'],
  ['.woff', 'woff'],
  ['.woff2', 'woff2'],
]);

const SOURCE_FORMAT_PREFERENCE = new Map([
  ['woff2', 0],
  ['woff', 1],
  ['opentype', 2],
  ['truetype', 3],
]);

const WEIGHT_LABELS = new Map([
  [100, 'Thin'],
  [200, 'Extra Light'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semi Bold'],
  [700, 'Bold'],
  [800, 'Extra Bold'],
  [900, 'Black'],
]);

function normalizeDisplayName(basename) {
  return basename
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
}

function normalizeFamilyName(value) {
  return (value || '').replace(/['"]/g, '').trim();
}

function clampWeight(weight) {
  if (typeof weight !== 'number' || !isFinite(weight)) return 400;
  const rounded = Math.round(weight / 100) * 100;
  const clamped = Math.min(900, Math.max(100, rounded));
  return clamped;
}

function weightToCss(weight) {
  return String(clampWeight(weight));
}

function humanizeWeight(weight) {
  const normal = clampWeight(weight);
  return WEIGHT_LABELS.get(normal) || String(normal);
}

function readNameRecord(nameTable, key) {
  if (!nameTable || !nameTable.records) return null;
  const record = nameTable.records[key];
  if (!record) return null;
  if (typeof record === 'string') return record;
  if (typeof record === 'object') {
    if (record.en) return record.en;
    if (record['']) return record[''];
    const values = Object.values(record);
    if (values.length) return values[0];
  }
  return null;
}

function sanitizeDescriptor(value) {
  if (!value) return '';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
}

function detectStyle(font) {
  const os2 = font && font['OS/2'];
  if (os2 && typeof os2.fsSelection === 'number') {
    const ITALIC_MASK = 1 << 0;
    const OBLIQUE_MASK = 1 << 9;
    if (os2.fsSelection & ITALIC_MASK) return 'italic';
    if (os2.fsSelection & OBLIQUE_MASK) return 'oblique';
  }
  const postTable = font && font.post;
  const italicAngle =
    (postTable && typeof postTable.italicAngle === 'number'
      ? postTable.italicAngle
      : font && typeof font.italicAngle === 'number'
        ? font.italicAngle
        : 0) || 0;
  if (italicAngle !== 0) return 'italic';
  return 'normal';
}

function deriveDescriptor(subfamily, weight, style) {
  const cleaned = sanitizeDescriptor(subfamily);
  if (cleaned && !/^Regular$/i.test(cleaned)) {
    return cleaned;
  }
  const parts = [];
  const weightLabel = humanizeWeight(weight);
  if (
    weightLabel &&
    !/^Regular$/i.test(weightLabel) &&
    clampWeight(weight) !== 400
  ) {
    parts.push(weightLabel);
  }
  if (style === 'italic' || style === 'oblique') {
    parts.push(style.charAt(0).toUpperCase() + style.slice(1));
  }
  return parts.join(' ').trim();
}

function normalizeForMatching(value) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

const WEIGHT_KEYWORDS = [
  { regex: /\bextra[\s-]*black\b/, value: 900 },
  { regex: /\bultra[\s-]*black\b/, value: 900 },
  { regex: /\bblack\b/, value: 900 },
  { regex: /\bextra[\s-]*heavy\b/, value: 900 },
  { regex: /\bultra[\s-]*heavy\b/, value: 900 },
  { regex: /\bheavy\b/, value: 800 },
  { regex: /\bextra[\s-]*bold\b/, value: 800 },
  { regex: /\bultra[\s-]*bold\b/, value: 800 },
  { regex: /\b(semi|demi)[\s-]*bold\b/, value: 600 },
  { regex: /\bbold\b/, value: 700 },
  { regex: /\bmedium\b/, value: 500 },
  { regex: /\bextra[\s-]*light\b/, value: 200 },
  { regex: /\bultra[\s-]*light\b/, value: 200 },
  { regex: /\blight\b/, value: 300 },
  { regex: /\bextra[\s-]*thin\b/, value: 100 },
  { regex: /\bultra[\s-]*thin\b/, value: 100 },
  { regex: /\bthin\b/, value: 100 },
  { regex: /\bhairline\b/, value: 100 },
  { regex: /\bregular\b/, value: 400 },
  { regex: /\bnormal\b/, value: 400 },
];

function guessWeightFromName(name) {
  const matchable = normalizeForMatching(name);
  const lower = matchable.toLowerCase();
  const numericCandidate = lower.match(/\b([1-9]00)\b/);
  if (numericCandidate) {
    return clampWeight(Number(numericCandidate[1]));
  }
  for (let i = 0; i < WEIGHT_KEYWORDS.length; i += 1) {
    const entry = WEIGHT_KEYWORDS[i];
    if (entry.regex.test(lower)) {
      return clampWeight(entry.value);
    }
  }
  return 400;
}

function guessStyleFromName(name) {
  const normalized = normalizeForMatching(name).toLowerCase();
  if (/\boblique\b/.test(normalized)) return 'oblique';
  if (/\b(italic|slanted)\b/.test(normalized)) return 'italic';
  return 'normal';
}

const SEGMENT_SUFFIX_PATTERNS = [
  /(extra|ultra)(black|bold|heavy|light|thin)$/,
  /(semi|demi)bold$/,
  /(black|bold|heavy|light|thin|hairline|medium|regular|normal|italic|oblique|slanted)$/,
  /[1-9]00$/,
];

const SEGMENT_PREFIX_PATTERNS = [
  /^(extra|ultra)(black|bold|heavy|light|thin)/,
  /^(semi|demi)bold/,
  /^(black|bold|heavy|light|thin|hairline|medium|regular|normal|italic|oblique|slanted)/,
  /^[1-9]00/,
];

function cleanseSegment(segment) {
  let result = segment;
  let lower = result.toLowerCase();
  let modified = true;
  while (modified && result) {
    modified = false;
    for (let i = 0; i < SEGMENT_SUFFIX_PATTERNS.length; i += 1) {
      const regex = SEGMENT_SUFFIX_PATTERNS[i];
      const match = lower.match(regex);
      if (match && typeof match.index === 'number') {
        result = result.slice(0, match.index);
        result = result.replace(/[_-]+$/, '');
        lower = result.toLowerCase();
        modified = true;
        break;
      }
    }
    if (modified) {
      continue;
    }
    for (let i = 0; i < SEGMENT_PREFIX_PATTERNS.length; i += 1) {
      const regex = SEGMENT_PREFIX_PATTERNS[i];
      const match = lower.match(regex);
      if (match && match[0]) {
        result = result.slice(match[0].length);
        result = result.replace(/^[_-]+/, '');
        lower = result.toLowerCase();
        modified = true;
        break;
      }
    }
  }
  return result;
}

function stripWeightAndStyleDescriptors(displayName) {
  const segments = (displayName || '').split(/\s+/).filter(Boolean);
  const cleaned = [];
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i];
    const next = segments[i + 1] || '';
    const pairKey = `${current} ${next}`.toLowerCase();
    if (
      /^(extra|ultra)\s+(black|bold|heavy|light|thin)$/.test(pairKey) ||
      /^(semi|demi)\s+bold$/.test(pairKey)
    ) {
      i += 1;
      continue;
    }
    const cleanedSegment = cleanseSegment(current);
    if (cleanedSegment && cleanedSegment.trim().length > 0) {
      cleaned.push(cleanedSegment);
    }
  }
  if (!cleaned.length) {
    return displayName;
  }
  return cleaned.join(' ');
}

function fallbackMetadata(displayName) {
  const style = guessStyleFromName(displayName);
  const weightValue = guessWeightFromName(displayName);
  const descriptor = deriveDescriptor('', weightValue, style);
  let family = normalizeFamilyName(stripWeightAndStyleDescriptors(displayName));
  if (!family) {
    family = normalizeFamilyName(displayName);
  }
  const variantFamily = normalizeFamilyName(
    descriptor ? `${family} ${descriptor}` : family,
  );
  const label = descriptor ? `${family} (${descriptor})` : family;
  return {
    family,
    variantFamily: variantFamily || family,
    label,
    weight: weightToCss(weightValue),
    style,
    descriptor,
  };
}

function extractFontMetadata(filePath, basename) {
  const displayName = normalizeDisplayName(basename) || basename;
  if (!fontkit) {
    return fallbackMetadata(displayName);
  }
  try {
    const font = fontkit.openSync(filePath);
    const nameTable = font.name || (font.tables && font.tables.name) || null;
    const familyName =
      normalizeFamilyName(
        readNameRecord(nameTable, 'fontFamily') ||
          font.familyName ||
          displayName,
      ) || normalizeFamilyName(displayName);
    const subfamilyRaw =
      readNameRecord(nameTable, 'fontSubfamily') || font.subfamilyName || '';
    const os2 = font['OS/2'];
    const weightRaw =
      os2 && typeof os2.usWeightClass === 'number' ? os2.usWeightClass : null;
    const weightValue = clampWeight(weightRaw);
    const weightCss = weightToCss(weightRaw);
    const style = detectStyle(font);
    const descriptor = deriveDescriptor(subfamilyRaw, weightValue, style);
    const variantFamily = normalizeFamilyName(
      descriptor ? `${familyName} ${descriptor}` : familyName,
    );
    const label = descriptor ? `${familyName} (${descriptor})` : familyName;
    return {
      family: familyName,
      variantFamily: variantFamily || familyName,
      label: label || familyName,
      weight: weightCss,
      style,
      descriptor,
      coverageRanges: getFontCoverageRanges(font),
    };
  } catch (error) {
    warnOnce(
      `metadata:${filePath}`,
      `[local-fonts] Unable to parse metadata for ${basename}: ${error.message}`,
    );
    return fallbackMetadata(displayName);
  }
}

function toFileHref(filePath) {
  try {
    return pathToFileURL(filePath).href;
  } catch {
    return null;
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function collectFontFiles(rootDir) {
  const stack = [rootDir];
  const files = [];
  while (stack.length) {
    const currentDir = stack.pop();
    let dirents;
    try {
      dirents = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      warnOnce(
        `readdir:${currentDir}`,
        `[local-fonts] Unable to read directory ${currentDir}: ${error.message}`,
      );
      continue;
    }
    dirents.forEach((dirent) => {
      if (dirent.isDirectory()) {
        stack.push(path.join(currentDir, dirent.name));
      } else if (dirent.isFile()) {
        files.push(path.join(currentDir, dirent.name));
      }
    });
  }
  return files;
}

function formatPreferenceValue(format) {
  if (!format) return SOURCE_FORMAT_PREFERENCE.size;
  const normalized = String(format).toLowerCase();
  return SOURCE_FORMAT_PREFERENCE.has(normalized)
    ? SOURCE_FORMAT_PREFERENCE.get(normalized)
    : SOURCE_FORMAT_PREFERENCE.size;
}

function normalizeFontKey(metadata) {
  const family = (
    metadata.variantFamily ||
    metadata.family ||
    ''
  ).toLowerCase();
  const weight = String(metadata.weight || '').toLowerCase();
  const style = String(metadata.style || '').toLowerCase();
  return [family, weight, style].join('|');
}

function readLocalFontEntries() {
  const dir = ensureLocalFontsDirectorySync(getLocalFontsDirectory());
  const files = collectFontFiles(dir);
  const fontsByKey = new Map();

  files.forEach((filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const format = SUPPORTED_EXTENSIONS.get(ext);
    if (!format) return;

    const basename = path.basename(filePath, ext);
    const metadata = extractFontMetadata(filePath, basename);
    const href = toFileHref(filePath);
    if (!href) return;

    const key = normalizeFontKey(metadata);
    const source = { href, format };

    if (fontsByKey.has(key)) {
      const existing = fontsByKey.get(key);
      const hasSource = existing.sources.some((item) => item.href === href);
      if (!hasSource) {
        existing.sources.push(source);
      }
      return;
    }

    const cssFamily = metadata.variantFamily || metadata.family;
    const slug = slugify(cssFamily) || slugify(basename) || 'font';
    const id = `${slug}-${format}`;

    fontsByKey.set(key, {
      id,
      filePath,
      href,
      format,
      sources: [source],
      family: cssFamily,
      fallback: 'sans-serif',
      label: metadata.label,
      weight: metadata.weight,
      style: metadata.style,
      baseFamily: metadata.family,
      descriptor: metadata.descriptor,
      coverageRanges: metadata.coverageRanges || undefined,
    });
  });

  const fonts = Array.from(fontsByKey.values());
  fonts.forEach((font) => {
    font.sources.sort(
      (a, b) =>
        formatPreferenceValue(a.format) - formatPreferenceValue(b.format),
    );
    const primary = font.sources[0];
    font.href = primary.href;
    font.format = primary.format;
  });

  fonts.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
  return fonts;
}

function createFontFaceCss(font) {
  const escapedFamily = font.family.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let sources = [];
  if (Array.isArray(font.sources) && font.sources.length) {
    sources = font.sources;
  } else if (
    font.sources &&
    typeof font.sources === 'object' &&
    (font.sources.href ||
      font.sources.path ||
      font.sources.url ||
      font.sources.file)
  ) {
    const srcPath =
      font.sources.path ||
      font.sources.href ||
      font.sources.url ||
      font.sources.file;
    if (typeof srcPath === 'string' && srcPath.trim()) {
      sources = [
        {
          href: srcPath,
          format: font.sources.format || font.format,
        },
      ];
    }
  } else if (font.href) {
    sources = [{ href: font.href, format: font.format }];
  }
  const src =
    sources
      .filter((source) => source && source.href)
      .map((source) => {
        const fmt = source.format ? ` format("${source.format}")` : '';
        return `url("${source.href}")${fmt}`;
      })
      .join(', ') || 'local("")';
  return (
    `@font-face {` +
    ` font-family: "${escapedFamily}";` +
    ` src: ${src};` +
    ` font-display: swap;` +
    ` font-style: ${font.style || 'normal'};` +
    ` font-weight: ${font.weight || '400'};` +
    ` }`
  );
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  createFontFaceCss,
  normalizeDisplayName,
  normalizeFamilyName,
  readLocalFontEntries,
};
