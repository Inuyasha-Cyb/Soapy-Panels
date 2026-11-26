const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDocumentOperations,
} = require('../../app/renderer/src/project/document');

// Save/open behavior characterized before extraction, now exercised via the module factory.
function harness(overrides = {}) {
  const state = { fileHandles: { project: { name: 'original.soapy' } } };
  const calls = { saved: 0, errors: [], restores: [], writes: [] };
  const deps = {
    state,
    $: () => null,
    tr: (key) => key,
    alert: (error) => calls.errors.push(error),
    console: { error() {} },
    window: {},
    document: {},
    Blob,
    projectFileContract: {
      mimeType: 'application/json',
      preferredExtension: '.soapy',
      legacyExtensions: ['.json'],
      suggestedName: 'bubble_project.soapy',
    },
    createProjectBlob: async () => new Blob(['{}']),
    confirmSaveWithoutSessionVideos: async () => true,
    confirmDiscardUnsavedChanges: async () => true,
    saveBlobWithPicker: async (blob, options) => {
      calls.writes.push(options);
      return { saved: true, handle: { name: 'saved.soapy' } };
    },
    isProjectFileCancelError: (error) => error.name === 'AbortError',
    isRecoverableProjectHandleError: (error) =>
      error.name === 'NotAllowedError',
    markProjectSaved: () => calls.saved++,
    projectValidation: {
      readAndValidateProjectFile: async () => ({ bg: {}, bubbles: [] }),
    },
    restoreProject: (data, reset, options) => {
      calls.restores.push(data);
      options.onComplete();
    },
    ...overrides,
  };
  const commands = createDocumentOperations(deps);
  return { commands, calls, deps, state };
}

test('Save reuses the project handle; Save As chooses a new target', async () => {
  const h = harness();
  assert.equal(await h.commands.saveProject(), true);
  assert.equal(h.calls.writes[0].handle.name, 'original.soapy');
  assert.equal(await h.commands.saveProjectAs(), true);
  assert.equal(h.calls.writes[1].handle, null);
  assert.equal(h.calls.saved, 2);
});
test('canceled/failed saves never acknowledge persistence', async () => {
  for (const name of ['AbortError', 'Error']) {
    const h = harness({
      saveBlobWithPicker: async () => {
        throw Object.assign(new Error('test'), { name });
      },
    });
    assert.equal(await h.commands.saveProject(), false);
    assert.equal(h.calls.saved, 0);
    assert.equal(h.calls.errors.length, name === 'AbortError' ? 0 : 1);
  }
});
test('stale writable handles fall back to a picker', async () => {
  let count = 0;
  const h = harness({
    saveBlobWithPicker: async (_, options) => {
      if (++count === 1)
        throw Object.assign(new Error(), { name: 'NotAllowedError' });
      assert.equal(options.handle, undefined);
      return { saved: true, handle: null, downloaded: true };
    },
  });
  assert.equal(await h.commands.saveProject(), true);
  assert.equal(count, 2);
});
test('invalid open and canceled discard leave the document untouched', async () => {
  for (const overrides of [
    {
      projectValidation: {
        readAndValidateProjectFile: async () => {
          throw new Error('invalid');
        },
      },
    },
    { confirmDiscardUnsavedChanges: async () => false },
  ]) {
    const h = harness(overrides);
    assert.equal(await h.commands.restoreSelectedProjectFile({}, {}), false);
    assert.equal(h.calls.restores.length, 0);
    assert.equal(h.state.fileHandles.project.name, 'original.soapy');
  }
});
test('opening installs its handle only on restoration completion', async () => {
  let finish;
  const h = harness({
    restoreProject: (_, __, options) => {
      finish = options.onComplete;
    },
  });
  const pending = h.commands.restoreSelectedProjectFile(
    {},
    { name: 'opened.soapy' },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.fileHandles.project.name, 'original.soapy');
  finish();
  assert.equal(await pending, true);
  assert.equal(h.state.fileHandles.project.name, 'opened.soapy');
});

test('real picker cancellation does not acknowledge a save', async () => {
  const h = harness({
    saveBlobWithPicker: undefined,
    window: {
      showSaveFilePicker: async () => {
        throw Object.assign(new Error(), { name: 'AbortError' });
      },
    },
  });
  assert.equal(await h.commands.saveProjectAs(), false);
  assert.equal(h.calls.saved, 0);
  assert.deepEqual(h.calls.errors, []);
});

test('failed writable close aborts the write and preserves the unsaved baseline', async () => {
  let aborted = false;
  const h = harness({ saveBlobWithPicker: undefined });
  h.state.fileHandles.project = {
    queryPermission: async () => 'granted',
    createWritable: async () => ({
      write: async () => {},
      close: async () => {
        throw new Error('disk full');
      },
      abort: async () => {
        aborted = true;
      },
    }),
  };
  assert.equal(await h.commands.saveProject(), false);
  assert.equal(aborted, true);
  assert.equal(h.calls.saved, 0);
  assert.deepEqual(h.calls.errors, ['projectSave.failed']);
});
