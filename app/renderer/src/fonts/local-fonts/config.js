'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const rendererRoot = path.resolve(__dirname, '..', '..', '..');
const appRoot = path.resolve(rendererRoot, '..');
const defaultFontsDir = path.join(rendererRoot, 'assets', 'fonts');
const configPath = path.join(appRoot, 'config', 'local-fonts.json');

function resolveDirectory(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  let expanded = trimmed;
  if (expanded === '~') {
    expanded = os.homedir();
  } else if (expanded.startsWith('~/')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(appRoot, expanded);
}

function readConfigDirectory() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.directory === 'string') {
      return parsed.directory;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(
        `[local-fonts] Unable to read ${configPath}: ${error.message}`,
      );
    }
  }
  return null;
}

function getLocalFontsDirectory() {
  const envOverride =
    process.env.LOCAL_FONT_DIR || process.env.APP_LOCAL_FONT_DIR;
  const configOverride = readConfigDirectory();
  return (
    resolveDirectory(envOverride) ||
    resolveDirectory(configOverride) ||
    defaultFontsDir
  );
}

function ensureLocalFontsDirectorySync(dir = getLocalFontsDirectory()) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  CONFIG_PATH: configPath,
  DEFAULT_FONTS_DIR: defaultFontsDir,
  ensureLocalFontsDirectorySync,
  getLocalFontsDirectory,
  resolveDirectory,
};
