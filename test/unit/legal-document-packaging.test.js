const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const asar = require('@electron/asar');
const copyLegalDocuments = require('../../tools/packaging/copy-legal-documents');
const { getHelpDocuments, RENDERER_DIR } = require('../../app/shared/app-paths');

test('after-pack copies only the metadata-selected edition, preserving PDF bytes', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-legal-packaging-'));
  try {
    for (const edition of ['linux-community', 'windows-store']) {
      const appOutDir = path.join(temporary, edition);
      const resources = path.join(appOutDir, 'resources');
      const source = path.join(temporary, `source-${edition}`);
      await fs.mkdir(path.join(source, 'app/renderer/docs/legal'), { recursive: true });
      await fs.mkdir(resources, { recursive: true });
      await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ soapyEdition: edition }));
      // Deliberately include both editions to prove the hook uses package metadata.
      for (const candidate of ['linux-community', 'windows-store']) {
        for (const relative of Object.values(getHelpDocuments(candidate))) {
          await fs.copyFile(path.join(RENDERER_DIR, relative), path.join(source, 'app/renderer', relative));
        }
      }
      await asar.createPackage(source, path.join(resources, 'app.asar'));
      await copyLegalDocuments({ appOutDir });
      const expected = Object.values(getHelpDocuments(edition));
      assert.deepEqual((await fs.readdir(path.join(resources, 'legal'))).sort(), expected.map(file => path.basename(file)).sort());
      for (const relative of expected) {
        assert.deepEqual(await fs.readFile(path.join(resources, 'legal', path.basename(relative))), await fs.readFile(path.join(RENDERER_DIR, relative)));
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
