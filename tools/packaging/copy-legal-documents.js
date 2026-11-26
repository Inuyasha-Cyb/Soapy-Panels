const fs = require('node:fs/promises');
const path = require('node:path');
const asar = require('@electron/asar');
const { getHelpDocuments } = require('../../app/shared/app-paths');

// extraResources would remove these source files from app.asar. Retain the
// embedded viewer's copies and duplicate their exact bytes for the OS reader.
module.exports = async function copyLegalDocuments(context) {
  const resources = path.join(context.appOutDir, 'resources');
  const archive = path.join(resources, 'app.asar');
  const destination = path.join(resources, 'legal');
  await fs.mkdir(destination, { recursive: true });
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  for (const relative of Object.values(getHelpDocuments(metadata.soapyEdition))) {
    const bytes = asar.extractFile(archive, path.join('app', 'renderer', relative));
    await fs.writeFile(path.join(destination, path.basename(relative)), bytes);
  }
};
