const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { openHelpDocument } = require('../../app/main/help-documents');
const { getHelpDocuments, getHelpDocumentDescriptors, RENDERER_DIR, resolveHelpDocumentPath } = require('../../app/shared/app-paths');

test('legal documents resolve to source PDFs in development and physical resources in packages', async () => {
  const resourcesPath = path.join(os.tmpdir(), 'Soapy Panels resources');
  for (const edition of ['linux-community', 'windows-store']) {
    const documents = getHelpDocuments(edition);
    for (const id of ['privacy', 'terms']) {
      assert.equal(resolveHelpDocumentPath(id, { edition }), path.join(RENDERER_DIR, documents[id]));
      const expected = path.join(resourcesPath, 'legal', path.basename(documents[id]));
      assert.equal(resolveHelpDocumentPath(id, { edition, isPackaged: true, resourcesPath }), expected);
      let opened;
      assert.deepEqual(await openHelpDocument(id, {
        edition, isPackaged: true, resourcesPath, existsSync: file => file === expected,
        openPath: async file => { opened = file; return ''; },
      }), { ok: true });
      assert.equal(opened, expected);
      const descriptor = getHelpDocumentDescriptors(edition)[id];
      assert.equal(descriptor.fileName, documents[id].split(path.sep).join("/").replace(/^docs\//, ""));
      assert.equal(descriptor.titleKey, id === "terms" && edition === "linux-community" ? "help.termsAndLicense" : `help.${id}`);
    }
  }
});

test('unknown document IDs and invalid packaged roots never reach the system opener', async () => {
  const edition = 'linux-community';
  for (const id of ['', '../privacy', '/etc/passwd', 'constructor', '__proto__', 'toString', null, {}]) {
    assert.equal(resolveHelpDocumentPath(id, { edition }), null);
    const result = await openHelpDocument(id, { edition, openPath: () => assert.fail('must not open') });
    assert.equal(result.ok, false);
  }
  for (const resourcesPath of [undefined, '', 'relative']) {
    assert.equal(resolveHelpDocumentPath('privacy', { edition, isPackaged: true, resourcesPath }), null);
  }
});

test('missing PDFs and system viewer errors are returned to the existing UI error handler', async () => {
  assert.deepEqual(await openHelpDocument('privacy', {
    edition: 'linux-community',
    existsSync: () => false, openPath: () => assert.fail('must not open missing file'),
  }), { ok: false, error: 'Document not found.' });
  assert.deepEqual(await openHelpDocument('terms', {
    edition: 'linux-community',
    existsSync: () => true, openPath: async () => 'No PDF viewer available',
  }), { ok: false, error: 'No PDF viewer available' });
  const thrown = await openHelpDocument('terms', {
    edition: 'linux-community',
    existsSync: () => true, openPath: async () => { throw new Error('Open failed'); },
  });
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /Open failed/);
});

test('missing or unknown editions cannot silently open Windows documents', async () => {
  for (const edition of [undefined, '', 'unknown', '__proto__']) {
    assert.throws(() => getHelpDocuments(edition), /Unknown legal document edition/);
    const result = await openHelpDocument('privacy', { edition, openPath: () => assert.fail('must not open') });
    assert.equal(result.ok, false);
  }
});
