const test = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycle } = require('../../app/renderer/src/project/lifecycle');
const {
  createSafetyDialogs,
} = require('../../app/renderer/src/project/safety');
function fixture() {
  let text = 'initial';
  const snapshots = {
    takeProjectSnapshot: () => text,
    capture: () => ({ snapshot: text }),
  };
  const lifecycle = createLifecycle({ snapshots });
  lifecycle.initialize();
  return {
    lifecycle,
    edit: (value) => {
      text = value;
      lifecycle.observe();
    },
  };
}
test('exports acknowledge warnings but never acknowledge editable persistence', () => {
  const { lifecycle: l, edit } = fixture();
  edit('edited');
  l.markWarningSaved();
  assert.equal(l.hasUnsavedChanges(), false);
  assert.equal(l.needsRecovery(), true);
});
test('a save acknowledges only its captured revision; switching documents fences it', async () => {
  const { lifecycle: l, edit } = fixture();
  edit('saved revision');
  const capture = l.capture();
  edit('newer revision');
  await l.saved(capture);
  assert.equal(l.hasUnsavedChanges(), true);
  assert.equal(l.needsRecovery(), true);
  await l.replace('second');
  edit('second changed');
  await l.saved(capture);
  assert.equal(l.needsRecovery(), true);
});
test('selection-free identical snapshots suppress revisions; undo and redo are edits', () => {
  const { lifecycle: l, edit } = fixture();
  l.observe();
  assert.equal(l.identity().revision, 0);
  edit('change');
  edit('initial');
  edit('change');
  assert.equal(l.identity().revision, 3);
});
test('New cancellation leaves identity and recovery intact; success resets them', async () => {
  const { lifecycle: l, edit } = fixture();
  let replacements = 0;
  l.setRecovery({
    changed() {},
    replace: async () => {
      replacements++;
    },
  });
  edit('edited');
  assert.equal(
    await l.newProject(
      async () => false,
      () => {
        throw new Error();
      },
    ),
    false,
  );
  assert.equal(l.identity().generation, 0);
  assert.equal(
    await l.newProject(
      async () => true,
      () => edit('empty'),
    ),
    true,
  );
  assert.equal(l.identity().generation, 1);
  assert.equal(replacements, 1);
  assert.equal(l.needsRecovery(), false);
});
test('recovery awaits media restoration, then remains unsaved', async () => {
  const { lifecycle: l } = fixture();
  let finish;
  const pending = l.recover(
    { name: 'recovered', project: {} },
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(l.isTransitioning(), true);
  finish();
  await pending;
  assert.equal(l.isTransitioning(), false);
  assert.equal(l.hasUnsavedChanges(), true);
  assert.equal(l.needsRecovery(), true);
});
test('New/Open/Close safety warnings cover dirty projects and session-only videos', async () => {
  for (const action of ['new', 'open', 'close']) {
    for (const dirty of [false, true])
      for (const count of [0, 1]) {
        let prompts = 0;
        const safety = createSafetyDialogs({
          $: () => null,
          tr: (key) => key,
          document: {},
          requestAnimationFrame() {},
          window: {
            confirm: () => {
              prompts++;
              return false;
            },
          },
          getSessionOnlyVideoCount: () => count,
          hasUnsavedProjectChanges: () => dirty,
        });
        assert.equal(
          await safety.confirmDiscardUnsavedChanges(action),
          !dirty && !count,
        );
        assert.equal(prompts, dirty || count ? 1 : 0);
      }
  }
});
test('close coordination retains on cancellation and only approves after cleanup', async () => {
  const {
    createCloseCoordinator,
  } = require('../../app/renderer/src/project/lifecycle');
  let approved = null,
    cleanups = 0,
    allow = false,
    confirm = false;
  const close = createCloseCoordinator({
    confirm: async () => confirm,
    cleanup: async () => {
      cleanups++;
    },
    allowUnload: () => {
      allow = true;
    },
    acknowledge: async (result) => {
      approved = result;
    },
    onFailure: (error) => {
      throw error;
    },
  });
  await close(true);
  assert.equal(approved, false);
  assert.equal(cleanups, 0);
  confirm = true;
  await close(true);
  assert.equal(approved, true);
  assert.equal(cleanups, 1);
  assert.equal(allow, true);
});
