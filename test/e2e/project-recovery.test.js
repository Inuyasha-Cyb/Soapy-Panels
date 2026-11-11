const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  launchTestApp,
  dismissStartupOverlays,
  closeTestApp,
} = require('../support/electron-app');
async function ready(session) {
  await dismissStartupOverlays(session.page);
  await session.page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
}
async function bubble(page) {
  await page.evaluate(() =>
    document
      .querySelector('.add-bubble-option[data-bubble-type="speech"]')
      .click(),
  );
}
async function crash(session) {
  const process = session.app.process();
  const ended = new Promise((resolve) => process.once('exit', resolve));
  process.kill('SIGKILL');
  await ended;
}
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
test(
  'forced restart recovers an untitled project with image and GIF sources',
  { timeout: 90000 },
  async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-crash-'));
    let session;
    try {
      session = await launchTestApp({ profile });
      await ready(session);
      await bubble(session.page);
      await session.page.locator('#fileImage').setInputFiles([
        {
          name: 'pixel.png',
          mimeType: 'image/png',
          buffer: Buffer.from(PNG, 'base64'),
        },
        {
          name: 'pixel.gif',
          mimeType: 'image/gif',
          buffer: Buffer.from(GIF, 'base64'),
        },
      ]);
      await session.page.waitForFunction(
        () =>
          window.SoapyPanels.debug.video.takeProjectSnapshot().bg.images
            .length === 2,
      );
      await session.page.evaluate(() =>
        window.SoapyPanels.debug.recovery.flush(),
      );
      const status = await session.page
        .locator('#projectRecoveryStatus')
        .textContent();
      assert.equal(status, 'Recovery copy updated');
      const snapshot = await session.page.evaluate(() =>
        window.SoapyPanels.debug.video.takeProjectSnapshot(),
      );
      await crash(session);
      session = null;
      session = await launchTestApp({ profile });
      await dismissStartupOverlays(session.page);
      await session.page.waitForSelector('#projectRecoveryDialog[open]');
      assert.equal(
        await session.page.locator('#projectRecoveryList li').count(),
        1,
      );
      await session.page.click('[data-recovery-action="recover"]');
      await session.page.evaluate(() =>
        window.SoapyPanels.debug.recovery.ready(),
      );
      const restored = await session.page.evaluate(() => ({
        snapshot: window.SoapyPanels.debug.video.takeProjectSnapshot(),
        safety: window.SoapyPanels.debug.video.getProjectSafetyState(),
      }));
      assert.equal(restored.snapshot.bubbles.length, snapshot.bubbles.length);
      assert.equal(restored.snapshot.bg.images.length, 2);
      assert.equal(
        restored.snapshot.bg.images.filter((i) => i.mediaKind === 'gif').length,
        1,
      );
      assert.equal(restored.safety.hasUnsavedChanges, true);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
      await fs.rm(profile, { recursive: true, force: true });
    }
  },
);

async function flush(page) {
  await page.evaluate(() => window.SoapyPanels.debug.recovery.flush());
}
async function snapshotFiles(profile) {
  const root = path.join(profile, 'project-recovery');
  const result = [];
  for (const id of await fs.readdir(root))
    for (const name of await fs.readdir(path.join(root, id))) {
      if (/^snapshot-/.test(name)) result.push(path.join(root, id, name));
    }
  return result;
}
test(
  'project save clears recovery while an export keeps it through a crash',
  { timeout: 90000 },
  async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-save-'));
    let session;
    try {
      session = await launchTestApp({ profile });
      await ready(session);
      await bubble(session.page);
      await flush(session.page);
      assert.equal((await snapshotFiles(profile)).length, 1);
      await session.page.evaluate(() => {
        window.showSaveFilePicker = async () => ({
          name: 'test.soapy',
          queryPermission: async () => 'granted',
          createWritable: async () => ({
            write: async (blob) => {
              window.__savedProject = await blob.text();
            },
            close: async () => {},
          }),
        });
        document.querySelector('#mi-save').click();
      });
      await session.page.waitForFunction(
        () =>
          !!window.__savedProject &&
          !document.querySelector('#mi-save').disabled,
      );
      assert.equal((await snapshotFiles(profile)).length, 0);
      assert.equal(
        await session.page.evaluate(
          () =>
            window.SoapyPanels.debug.video.getProjectSafetyState()
              .hasUnsavedChanges,
        ),
        false,
      );
      await bubble(session.page);
      await flush(session.page);
      await session.page.evaluate(() => {
        window.SoapyPanels.debug.export.useMockSaveTarget(true);
        document.querySelector('#mi-exp-png').click();
      });
      await session.page.waitForFunction(
        () =>
          window.SoapyPanels.debug.export.getWrites().length === 1 &&
          !window.SoapyPanels.debug.export.getProgressState().visible,
      );
      assert.equal(
        await session.page.evaluate(
          () =>
            window.SoapyPanels.debug.video.getProjectSafetyState()
              .hasUnsavedChanges,
        ),
        false,
      );
      assert.equal((await snapshotFiles(profile)).length, 1);
      await crash(session);
      session = null;
      session = await launchTestApp({ profile });
      await dismissStartupOverlays(session.page);
      await session.page.waitForSelector('#projectRecoveryDialog[open]');
      await session.page.click('[data-recovery-action="recover"]');
      await session.page.evaluate(() =>
        window.SoapyPanels.debug.recovery.ready(),
      );
      assert.equal(
        await session.page.evaluate(
          () =>
            window.SoapyPanels.debug.video.takeProjectSnapshot().bubbles.length,
        ),
        2,
      );
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
      await fs.rm(profile, { recursive: true, force: true });
    }
  },
);

test(
  'canceled native close retains recovery; confirmed native quit removes it',
  { timeout: 60000 },
  async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-close-'));
    let session;
    try {
      session = await launchTestApp({ profile });
      await ready(session);
      await bubble(session.page);
      await flush(session.page);
      await session.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].close(),
      );
      await session.page.waitForSelector('#projectSafetyOverlay:not([hidden])');
      await session.page.click('[data-project-safety-cancel]');
      assert.equal((await snapshotFiles(profile)).length, 1);
      await session.app.evaluate(({ app }) => app.quit());
      await session.page.waitForSelector('#projectSafetyOverlay:not([hidden])');
      const exited = new Promise((resolve) =>
        session.app.process().once('exit', resolve),
      );
      await session.page.click('[data-project-safety-continue]');
      await exited;
      assert.equal((await snapshotFiles(profile)).length, 0);
      session = null;
    } finally {
      await closeTestApp(session);
      await fs.rm(profile, { recursive: true, force: true });
    }
  },
);

test(
  'New discard clears the outgoing recovery; MP4 exclusions appear in the recovery chooser',
  { timeout: 60000 },
  async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-discard-'));
    let session;
    try {
      session = await launchTestApp({ profile });
      await ready(session);
      await bubble(session.page);
      await flush(session.page);
      await session.page.evaluate(() =>
        document.querySelector('#mi-new').click(),
      );
      await session.page.waitForSelector('#projectSafetyOverlay:not([hidden])');
      await session.page.click('[data-project-safety-continue]');
      await session.page.waitForFunction(
        () =>
          window.SoapyPanels.debug.video.takeProjectSnapshot().bubbles
            .length === 0,
      );
      // Wait for asynchronous session cleanup, not just the canvas reset.
      await session.page.waitForFunction(
        () => !document.querySelector('#projectRecoveryStatus').textContent,
      );
      assert.equal((await snapshotFiles(profile)).length, 0);
      await crash(session);
      session = null;
      const {
        createRecoveryStore,
      } = require('../../app/main/project-recovery-store');
      const store = createRecoveryStore(path.join(profile, 'project-recovery'));
      const id = await store.start(123);
      await store.write(123, id, {
        version: 1,
        generation: 0,
        revision: 1,
        name: 'Video project',
        excludedVideoCount: 2,
        project: {
          bg: { w: 1280, h: 720, images: [] },
          bubbles: [],
          savedStyles: [],
        },
      });
      await store.releaseRenderer(123);
      session = await launchTestApp({ profile });
      await dismissStartupOverlays(session.page);
      await session.page.waitForSelector('#projectRecoveryDialog[open]');
      assert.match(
        await session.page.locator('#projectRecoveryList').textContent(),
        /MP4.*\(2\)/,
      );
      await session.page.click('[data-recovery-action="discard"]');
      await session.page.evaluate(() =>
        window.SoapyPanels.debug.recovery.ready(),
      );
      assert.equal((await snapshotFiles(profile)).length, 0);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
      await fs.rm(profile, { recursive: true, force: true });
    }
  },
);
