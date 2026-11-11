const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const {
  sanitizeElectronEnvironment,
} = require('../../tools/development/start-electron');
const {
  dismissStartupOverlays,
  closeTestApp,
} = require('../support/electron-app');
test(
  'missing bundled helper leaves Store unavailable and the editor usable despite launch-directory decoys',
  { timeout: 60000 },
  async () => {
    const profile = await fs.mkdtemp(
      path.join(os.tmpdir(), 'soapy-store-editor-'),
    );
    let session;
    try {
      const cwd = path.join(profile, 'untrusted launch');
      for (const root of [cwd, path.join(profile, 'source')]) {
        const dir = path.join(root, 'out', 'store-bridge');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, 'SoapyStoreBridge.exe'),
          'inert decoy; never execute',
        );
      }
      const app = await electron.launch({
        args: [
          path.join(__dirname, '../support/store-helper-launch.js'),
          '--no-sandbox',
        ],
        cwd,
        env: sanitizeElectronEnvironment({ SOAPY_TEST_PROFILE: profile }),
        timeout: 45000,
      });
      session = { app, profile, ownedProfile: false };
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.waitForFunction(() => !!window.SoapyPanels?.debug?.recovery);
      await dismissStartupOverlays(page);
      await page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
      const state = await page.evaluate(() =>
        window.electronApi.refreshMonetizationStatus(),
      );
      assert.equal(state.edition, 'windows-store');
      assert.equal(state.monetizationStatus.available, false);
      assert.match(
        state.monetizationStatus.error,
        /not available in this build/,
      );
      const before = await page.evaluate(
        () =>
          window.SoapyPanels.debug.video.takeProjectSnapshot().bubbles.length,
      );
      await page.evaluate(() =>
        document
          .querySelector('.add-bubble-option[data-bubble-type="speech"]')
          .click(),
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.SoapyPanels.debug.video.takeProjectSnapshot().bubbles.length,
        ),
        before + 1,
      );
      await page.evaluate(() => window.SoapyPanels.debug.recovery.flush());
      const diagnostics = await app.evaluate(() => ({
        ...global.storeHelperTest,
        actualResources: process.resourcesPath,
      }));
      assert.equal(diagnostics.context.isPackaged, false);
      assert.equal(
        diagnostics.context.resourcesPath,
        diagnostics.actualResources,
      );
      assert.equal(diagnostics.spawns, 0);
      assert.deepEqual(errors, []);
    } finally {
      await closeTestApp(session);
      await fs.rm(profile, { recursive: true, force: true });
    }
  },
);
