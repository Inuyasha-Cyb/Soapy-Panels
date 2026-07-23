#!/usr/bin/env node
/**
 * Scans app/renderer/assets/stickers/builtin for image files and rewrites stickers.manifest.js
 * so the runtime UI can list every bundled sticker without manual edits.
 *
 * The script preserves custom names/descriptions from the previous manifest
 * whenever the sticker id still exists.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const STICKER_ROOT = path.join(ROOT, 'app', 'renderer', 'assets', 'stickers');
const STICKER_DIR = path.join(STICKER_ROOT, 'builtin');
const OUTPUT_FILE = path.join(STICKER_ROOT, 'stickers.manifest.js');
const RELATIVE_BASE = path.posix.join('assets', 'stickers', 'builtin');
const VALID_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const CATEGORY_DEFINITIONS = [
  ['soapy', 'Soapy'],
  ['hearts', 'Hearts'],
  ['bubbles', 'Bubbles'],
  ['angry-veins', 'Angry Veins'],
  ['confused', 'Confused'],
  ['drops', 'Drops'],
  ['lightbulbs', 'Lightbulbs'],
  ['sighs', 'Sighs'],
  ['speed-lines', 'Speed Lines'],
  ['stars', 'Stars'],
];
const CATEGORY_NAME_BY_ID = Object.fromEntries(CATEGORY_DEFINITIONS);
const CATEGORY_ORDER_BY_ID = Object.fromEntries(
  CATEGORY_DEFINITIONS.map(([id], index) => [id, index]),
);

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleize(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function quote(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function uniqueStrings(values) {
  const seen = new Set();
  const results = [];
  values.forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    results.push(trimmed);
  });
  return results;
}

function loadPreviousManifest() {
  if (!fs.existsSync(OUTPUT_FILE)) return { byId: {}, bySrc: {} };
  const code = fs.readFileSync(OUTPUT_FILE, 'utf8');
  const sandbox = { window: {}, console };
  try {
    vm.runInNewContext(code, sandbox, { filename: OUTPUT_FILE });
  } catch (error) {
    console.warn(
      'Unable to evaluate existing sticker manifest, ignoring it.',
      error,
    );
    return { byId: {}, bySrc: {} };
  }
  const entries = sandbox.window.soapyStickerManifest;
  if (!Array.isArray(entries)) return { byId: {}, bySrc: {} };
  const byId = {};
  const bySrc = {};
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string')
      return;
    const payload = {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      legacyIds: uniqueStrings(entry.legacyIds || []),
      aliases: uniqueStrings(entry.aliases || []),
    };
    byId[entry.id] = payload;
    if (typeof entry.src === 'string') {
      bySrc[entry.src] = payload;
    }
    payload.aliases.forEach((alias) => {
      bySrc[alias] = payload;
    });
  });
  return { byId, bySrc };
}

async function walkStickerFiles(dir, prefix = '') {
  const rows = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const row of rows) {
    const rel = prefix ? path.join(prefix, row.name) : row.name;
    const full = path.join(dir, row.name);
    if (row.isDirectory()) {
      files.push(...(await walkStickerFiles(full, rel)));
    } else if (row.isFile()) {
      const ext = path.extname(row.name).toLowerCase();
      if (VALID_EXTENSIONS.has(ext)) files.push(rel);
    }
  }
  return files;
}

async function readStickerFiles() {
  await fs.promises.mkdir(STICKER_DIR, { recursive: true });
  const files = (await walkStickerFiles(STICKER_DIR)).map((file) =>
    file.replace(/\\/g, '/'),
  );
  return files.sort(compareStickerFiles);
}

function getCategoryId(file) {
  const normalized = file.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length > 1 && parts[0]) return slugify(parts[0]);
  return 'uncategorized';
}

function getCategoryName(categoryId) {
  return CATEGORY_NAME_BY_ID[categoryId] || titleize(categoryId);
}

function compareStickerFiles(a, b) {
  const categoryA = getCategoryId(a);
  const categoryB = getCategoryId(b);
  const orderA =
    CATEGORY_ORDER_BY_ID[categoryA] != null
      ? CATEGORY_ORDER_BY_ID[categoryA]
      : Number.MAX_SAFE_INTEGER;
  const orderB =
    CATEGORY_ORDER_BY_ID[categoryB] != null
      ? CATEGORY_ORDER_BY_ID[categoryB]
      : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  if (categoryA !== categoryB) return categoryA.localeCompare(categoryB);
  return a.localeCompare(b);
}

function buildEntries(files, previousMeta) {
  return files.map((file) => {
    const ext = path.extname(file).toLowerCase();
    const basename = path.basename(file, path.extname(file));
    const category = getCategoryId(file);
    const stickerSlug = slugify(basename) || slugify(file) || file.toLowerCase();
    const id = `${category}-${stickerSlug}`;
    const relSrc = path.posix.join(RELATIVE_BASE, file.replace(/\\/g, '/'));
    const legacySrc = path.posix.join(RELATIVE_BASE, path.basename(file));
    const legacy = previousMeta.bySrc[legacySrc] || {};
    const existing = previousMeta.byId[id] || previousMeta.bySrc[relSrc] || legacy;
    const name =
      typeof existing.name === 'string' && existing.name.trim().length > 0
        ? existing.name.trim()
        : titleize(basename);
    const description =
      typeof existing.description === 'string' &&
      existing.description.trim().length > 0
        ? existing.description.trim()
        : '';
    const entry = {
      id,
      name,
      description,
      src: relSrc,
      category,
      categoryName: getCategoryName(category),
    };
    if (ext === '.gif') {
      entry.mediaKind = 'gif';
      entry.mimeType = 'image/gif';
    }
    const legacyIds = uniqueStrings(
      []
        .concat(existing.legacyIds || [])
        .concat(legacy.legacyIds || [])
        .concat(legacy.id && legacy.id !== id ? [legacy.id] : []),
    );
    const aliases = uniqueStrings(
      []
        .concat(existing.aliases || [])
        .concat(legacy.aliases || [])
        .concat(legacy.id && legacySrc !== relSrc ? [legacySrc] : []),
    );
    if (legacyIds.length) {
      entry.legacyIds = legacyIds;
    }
    if (aliases.length) {
      entry.aliases = aliases;
    }
    return entry;
  });
}

function renderArray(values) {
  return `[${values.map(quote).join(', ')}]`;
}

function renderEntry(entry) {
  const lines = [
    `    id: ${quote(entry.id)},`,
    `    name: ${quote(entry.name)},`,
  ];
  if (entry.description) {
    lines.push(`    description: ${quote(entry.description)},`);
  }
  lines.push(`    src: ${quote(entry.src)},`);
  lines.push(`    category: ${quote(entry.category)},`);
  lines.push(`    categoryName: ${quote(entry.categoryName)},`);
  if (entry.mediaKind === 'gif') {
    lines.push(`    mediaKind: 'gif',`);
  }
  if (entry.mimeType === 'image/gif') {
    lines.push(`    mimeType: 'image/gif',`);
  }
  if (entry.legacyIds && entry.legacyIds.length) {
    lines.push(`    legacyIds: ${renderArray(entry.legacyIds)},`);
  }
  if (entry.aliases && entry.aliases.length) {
    lines.push(`    aliases: ${renderArray(entry.aliases)},`);
  }
  return `  {\n${lines.join('\n')}\n  }`;
}

function renderManifest(entries) {
  const header = `// Sticker manifest is auto-generated. Edit tools/stickers/generate-sticker-manifest.js to change logic.\n`;
  const rows = entries.map(renderEntry).join(',\n');
  return `${header}window.soapyStickerManifest = [\n${rows}\n];\n`;
}

async function main() {
  const previousMeta = loadPreviousManifest();
  const files = await readStickerFiles();
  const entries = buildEntries(files, previousMeta);
  const output = renderManifest(entries);
  await fs.promises.writeFile(OUTPUT_FILE, output, 'utf8');
  console.log(`Updated sticker manifest with ${entries.length} entries.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to generate sticker manifest:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildEntries,
  compareStickerFiles,
  getCategoryId,
  getCategoryName,
  loadPreviousManifest,
  readStickerFiles,
  renderManifest,
  slugify,
  titleize,
};
