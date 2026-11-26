const path = require("path");

const APP_DIR = path.resolve(__dirname, "..");
const RENDERER_DIR = path.join(APP_DIR, "renderer");
const PRELOAD_PATH = path.join(APP_DIR, "preload", "index.js");
const RENDERER_ENTRY = "index.html";
const APP_ENTRY_URL = "app://index.html";
const PROJECT_ROOT = path.resolve(APP_DIR, "..");
const OPEN_SOURCE_NOTICES_FILE = "OPEN_SOURCE_NOTICES.txt";

const HELP_DOCS = Object.freeze({
  privacy: path.join("docs", "legal", "Soapy_Panels_Privacy_Policy.pdf"),
  terms: path.join("docs", "legal", "Soapy_Panels_Terms_of_Service.pdf"),
});
const LINUX_HELP_DOCS = Object.freeze({
  privacy: path.join("docs", "legal", "Soapy_Panels_Linux_Privacy_Notice.pdf"),
  terms: path.join("docs", "legal", "Soapy_Panels_Linux_Terms_and_License.pdf"),
});

function getHelpDocuments(edition) {
  if (edition === "linux-community") return LINUX_HELP_DOCS;
  if (edition === "windows-store") return HELP_DOCS;
  throw new Error(`Unknown legal document edition: ${edition}`);
}

function getHelpDocumentDescriptors(edition) {
  return Object.fromEntries(Object.entries(getHelpDocuments(edition)).map(([id, relative]) => [id, {
    id,
    fileName: relative.split(path.sep).join("/").replace(/^docs\//, ""),
    titleKey: id === "terms" && edition === "linux-community" ? "help.termsAndLicense" : `help.${id}`,
  }]));
}

function isInside(basePath, candidatePath) {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  return candidate === base || candidate.startsWith(base + path.sep);
}

function resolveRendererPath(relativePath) {
  const resolvedPath = path.resolve(RENDERER_DIR, relativePath || "");
  if (!isInside(RENDERER_DIR, resolvedPath)) return null;
  return resolvedPath;
}

function resolveOpenSourceNoticesPath(options = {}) {
  if (options.isPackaged) {
    const resourcesPath = path.resolve(options.resourcesPath || "");
    return path.join(resourcesPath, "legal", OPEN_SOURCE_NOTICES_FILE);
  }
  return path.join(PROJECT_ROOT, "packaging", OPEN_SOURCE_NOTICES_FILE);
}

function resolveHelpDocumentPath(docId, options = {}) {
  const documents = getHelpDocuments(options.edition);
  if (typeof docId !== "string" || !Object.hasOwn(documents, docId)) return null;
  const relativePath = documents[docId];
  if (options.isPackaged) {
    if (!options.resourcesPath || !path.isAbsolute(options.resourcesPath)) return null;
    return path.join(options.resourcesPath, "legal", path.basename(relativePath));
  }
  return resolveRendererPath(relativePath);
}

module.exports = {
  APP_DIR,
  RENDERER_DIR,
  PRELOAD_PATH,
  RENDERER_ENTRY,
  APP_ENTRY_URL,
  HELP_DOCS,
  LINUX_HELP_DOCS,
  getHelpDocuments,
  getHelpDocumentDescriptors,
  OPEN_SOURCE_NOTICES_FILE,
  isInside,
  resolveRendererPath,
  resolveOpenSourceNoticesPath,
  resolveHelpDocumentPath,
};
