const fs = require('node:fs');
const { resolveHelpDocumentPath } = require('../shared/app-paths');

async function openHelpDocument(docId, options) {
  try {
    const file = resolveHelpDocumentPath(docId, options);
    if (!file) return { ok: false, error: 'Unknown document or invalid document path.' };
    if (!(options.existsSync || fs.existsSync)(file)) {
      return { ok: false, error: 'Document not found.' };
    }
    const error = await options.openPath(file);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

module.exports = { openHelpDocument };
