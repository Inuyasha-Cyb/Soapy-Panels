const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  sanitizeElectronEnvironment,
} = require('../../tools/development/start-electron');
async function launchTestApp(options = {}) {
  const profile =
    options.profile ||
    (await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-test-')));
  const app = await electron.launch({
    args: [path.join(__dirname, 'recovery-launch.js'), '--no-sandbox'],
    env: sanitizeElectronEnvironment({
      SOAPY_TEST_PROFILE: profile,
      SOAPY_TEST_RECOVERY_LIMITS: JSON.stringify(options.recoveryLimits || {}),
    }),
    timeout: 45000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(
    () => !!window.SoapyPanels?.debug?.recovery,
    null,
    { timeout: 45000 },
  );
  return { app, page, profile, errors, ownedProfile: !options.profile };
}
async function dismissStartupOverlays(page) {
  const language = page.locator(
    '#helpOverlay[data-startup-language-required="true"] [data-locale-option="en"]',
  );
  if (await language.count()) await language.click();
  const help = page.locator('#helpOverlay');
  if (await help.isVisible()) {
    // Locale selection completes the required language step.
    const close = help.locator('[data-help-close], #helpClose');
    if (await close.count()) await close.first().click({ force: true });
    else await page.keyboard.press('Escape');
  }
}
async function closeTestApp(session) {
  if (!session) return;
  try {
    await session.app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy();
    });
  } catch {
    /* Already closed by a test. */
  }
  try {
    await session.app.close();
  } catch {
    /* Already closed by a test. */
  }
  if (session.ownedProfile)
    await fs.rm(session.profile, { recursive: true, force: true });
}
module.exports = { launchTestApp, dismissStartupOverlays, closeTestApp };
