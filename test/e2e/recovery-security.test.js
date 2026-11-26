const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createRecoveryStore,
} = require('../../app/main/project-recovery-store');
const {
  launchTestApp,
  dismissStartupOverlays,
  closeTestApp,
} = require('../support/electron-app');
const envelope = {
  name: 'Preserved copy',
  generation: 0,
  revision: 1,
  excludedVideoCount: 0,
  project: { bg: { w: 100, h: 100, images: [] }, bubbles: [], savedStyles: [] },
};
async function seeded(t, damaged = false) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-quota-ui-'));
  t.after(() => fs.rm(profile, { recursive: true, force: true }));
  const root = path.join(profile, 'project-recovery'),
    store = createRecoveryStore(root);
  const id = await store.start(1);
  await store.write(1, id, envelope);
  await store.dispose();
  if (damaged)
    await fs.writeFile(path.join(root, id, 'snapshot-0-1.json'), '{bad');
  return { profile, id };
}
async function addBubble(page) {
  await page.evaluate(() =>
    document
      .querySelector('.add-bubble-option[data-bubble-type="speech"]')
      .click(),
  );
}
test(
  'full session quota still offers discovery, damaged-copy discard, editing and explicit retry',
  { timeout: 60000 },
  async (t) => {
    const { profile } = await seeded(t, true);
    const session = await launchTestApp({
      profile,
      recoveryLimits: { maxSessions: 1 },
    });
    try {
      const { page } = session;
      await dismissStartupOverlays(page);
      await page.waitForSelector('#projectRecoveryDialog[open]');
      assert.equal(
        await page.locator('[data-recovery-action="recover"]').count(),
        0,
      );
      assert.equal(
        await page.locator('[data-recovery-action="discard"]').count(),
        1,
      );
      await page.click('[data-recovery-leave]');
      await page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
      assert.equal(
        await page.evaluate(
          () => window.SoapyPanels.debug.recovery.state().pausedCode,
        ),
        'RECOVERY_SESSION_LIMIT',
      );
      await addBubble(page);
      await page.evaluate(() => window.SoapyPanels.debug.recovery.flush());
      assert.equal(
        await session.app.evaluate(() => global.recoveryTest.starts),
        1,
      );
      assert.equal(
        await session.app.evaluate(() => global.recoveryTest.writes),
        0,
      );
      await page.click('[data-recovery-manage]');
      await page.waitForSelector('#projectRecoveryDialog[open]');
      await page.click('[data-recovery-action="discard"]');
      await page.waitForFunction(
        () => !document.querySelector('#projectRecoveryList').children.length,
      );
      await page.click('[data-recovery-leave]');
      assert.equal(
        await session.app.evaluate(() => global.recoveryTest.starts),
        1,
      );
      await page.click('[data-recovery-retry]');
      await page.waitForFunction(
        () =>
          document.querySelector('#projectRecoveryStatus').textContent ===
          'Recovery copy updated',
      );
      assert.equal(
        await session.app.evaluate(() => global.recoveryTest.starts),
        2,
      );
      assert.equal(
        await session.app.evaluate(() => global.recoveryTest.writes),
        1,
      );
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);
test(
  'recovering at capacity keeps the backup until a manual project save succeeds',
  { timeout: 60000 },
  async (t) => {
    const { profile, id } = await seeded(t);
    const session = await launchTestApp({
      profile,
      recoveryLimits: { maxSessions: 1 },
    });
    try {
      const { page } = session;
      await dismissStartupOverlays(page);
      await page.waitForSelector('#projectRecoveryDialog[open]');
      await session.app.evaluate(() => {
        global.recoveryTest.failRead = true;
      });
      await page.click('[data-recovery-action="recover"]');
      await page.waitForFunction(
        () => !!document.querySelector('#projectRecoveryError').textContent,
      );
      assert.equal(
        (await page.evaluate(() => window.electronApi.recoveryList())).sessions
          .length,
        1,
      );
      await session.app.evaluate(() => {
        global.recoveryTest.failRead = false;
      });
      await page.click('[data-recovery-action="recover"]');
      await page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
      assert.equal(
        await page.evaluate(
          () => window.SoapyPanels.debug.recovery.state().pausedCode,
        ),
        'RECOVERY_SESSION_LIMIT',
      );
      assert.ok(
        (
          await fs.stat(path.join(profile, 'project-recovery', id))
        ).isDirectory(),
      );
      await page.evaluate(() => {
        window.showSaveFilePicker = async () => ({
          name: 'recovered.soapy',
          queryPermission: async () => 'granted',
          createWritable: async () => ({
            write: async (blob) => {
              window.__savedRecovery = await blob.text();
            },
            close: async () => {},
          }),
        });
        document.querySelector('#mi-save').click();
      });
      await page.waitForFunction(
        () =>
          !!window.__savedRecovery &&
          !document.querySelector('#mi-save').disabled,
      );
      await assert.rejects(
        fs.stat(path.join(profile, 'project-recovery', id)),
        { code: 'ENOENT' },
      );
      assert.equal(
        await session.app.evaluate(() => global.recoveryTest.starts),
        1,
      );
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);
test(
  'preload preserves structured quota failures and ignores oversized unknown envelope fields',
  { timeout: 60000 },
  async () => {
    const session = await launchTestApp({
      recoveryLimits: { maxBytes: 10000, maxSnapshotBytes: 12000 },
    });
    try {
      const { page } = session;
      await dismissStartupOverlays(page);
      await page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
      const result = await page.evaluate(async (value) => {
        const api = window.electronApi,
          id = await api.recoveryStart();
        await api.recoveryWrite(id, { ...value, unwanted: 'x'.repeat(30000) });
        const read = await api.recoveryRead(id);
        let error;
        try {
          await api.recoveryWrite(id, {
            ...value,
            revision: 2,
            project: { ...value.project, padding: 'x'.repeat(10001) },
          });
        } catch (failure) {
          error = failure.message;
        }
        return { read, error };
      }, envelope);
      assert.equal(result.read.unwanted, undefined);
      assert.match(result.error, /RECOVERY_SIZE_LIMIT/);
      await addBubble(page);
      await page.evaluate(() => window.SoapyPanels.debug.recovery.flush());
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);
