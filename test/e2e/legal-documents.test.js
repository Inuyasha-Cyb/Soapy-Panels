const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { externalRequestsInNetLog } = require('../../tools/testing/network-log');
const { launchTestApp, dismissStartupOverlays, closeTestApp } = require('../support/electron-app');

async function waitForValue(read, predicate, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

test('Help renders both legal PDFs and opens physical documents through trusted IPC', { timeout: 120000 }, async () => {
  const executablePath = process.env.SOAPY_LEGAL_TEST_EXECUTABLE;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-legal-network-'));
  const netLog = path.join(temporary, 'network.json');
  let session;
  try {
    session = await launchTestApp({
      ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}),
      args: [`--log-net-log=${netLog}`],
    });
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const { app, page } = session;
  page.setDefaultTimeout(15000);
  const frameErrors = [];
  let linux = false;
  let documentChecksPassed = false;
  page.on('console', message => {
    if (/refused to frame|violates.*frame-src|framing.*violates/i.test(message.text())) {
      frameErrors.push(message.text());
    }
  });
  try {
    if (executablePath) {
      assert.deepEqual(await app.evaluate(({ app, BrowserWindow }) => ({
        packaged: app.isPackaged,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
        sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
      })), { packaged: true, noSandbox: false, sandbox: true });
    }
    await dismissStartupOverlays(page);
    await app.evaluate(({ shell }) => {
      globalThis.legalOriginalOpenPath = shell.openPath;
      globalThis.legalOpenCalls = [];
      globalThis.legalOpenError = '';
      shell.openPath = async file => {
        globalThis.legalOpenCalls.push(file);
        return globalThis.legalOpenError;
      };
    });
    const reportDir = process.env.SOAPY_LEGAL_TEST_REPORT_DIR;
    if (reportDir) await fs.mkdir(reportDir, { recursive: true });
    const state = await page.evaluate(() => window.electronApi.getStartupState());
    linux = state.edition === 'linux-community';
    assert.equal(await app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled()), !linux);
    assert.equal(await page.locator('#mi-help-terms').textContent(), linux ? 'Terms and License' : 'Terms of Service');
    let openCount = 0;
    for (const id of ['privacy', 'terms', 'privacy']) {
      const name = linux
        ? (id === 'privacy' ? 'Soapy_Panels_Linux_Privacy_Notice.pdf' : 'Soapy_Panels_Linux_Terms_and_License.pdf')
        : (id === 'privacy' ? 'Soapy_Panels_Privacy_Policy.pdf' : 'Soapy_Panels_Terms_of_Service.pdf');
      assert.equal(state.helpDocuments[id].fileName, `legal/${name}`);
      await page.click('#menu-help');
      await page.click(`#mi-help-${id}`);
      const frame = page.locator('.help-doc-frame');
      const expectedUrl = await page.evaluate(name => new URL(`docs/legal/${name}`, document.baseURI).href, name);
      assert.equal(await frame.getAttribute('src'), expectedUrl);
      assert.equal(await frame.getAttribute('title'), id === 'privacy' ? 'Privacy Notice' : linux ? 'Terms and License' : 'Terms of Service');
      const viewer = await waitForValue(
        async () => page.frames().find(f => f.url().startsWith('chrome-extension://')),
        Boolean, 'Chromium PDF viewer must initialize',
      );
      await viewer.waitForFunction(() => document.querySelector('pdf-viewer')?.loadProgress_ === 100);
      assert.equal(await viewer.locator('#plugin').getAttribute('original-url'), expectedUrl);
      const content = await waitForValue(async () => {
        for (const candidate of page.frames().filter(f => f.url() === expectedUrl)) {
          if (await candidate.locator('#sizer').count()) return candidate;
        }
      }, Boolean, 'PDF pages must be laid out');
      await content.waitForFunction(() => document.querySelector('#sizer').getBoundingClientRect().height > 500);
      if (reportDir) await frame.screenshot({ path: path.join(reportDir, `${id}.png`) });
      await content.evaluate(() => window.scrollTo(0, 350));
      await content.waitForFunction(() => window.scrollY > 0);

      await page.click('#helpDialogContent [data-help-doc-open]');
      openCount++;
      const calls = await waitForValue(
        () => app.evaluate(() => globalThis.legalOpenCalls),
        values => values.length === openCount, 'System viewer button must invoke the opener',
      );
      const file = calls.at(-1);
      assert.ok(path.isAbsolute(file));
      assert.equal(path.basename(file), name);
      if (executablePath) assert.ok(!file.split(path.sep).includes('app.asar'));
      const bytes = await fs.readFile(file);
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      const pdfTitle = linux
        ? `Soapy Panels for Linux ${id === 'privacy' ? 'Privacy Notice' : 'Terms and License'}`
        : `Soapy Panels ${id === 'privacy' ? 'Privacy Notice' : 'Terms of Use'}`;
      assert.ok(bytes.includes(Buffer.from(`/Title (${pdfTitle})`)), 'PDF metadata must identify the correct edition and document');
      assert.deepEqual(bytes, await fs.readFile(path.join(__dirname, '../../app/renderer/docs/legal', name)));
      await page.locator('#helpOverlay [data-help-close]').first().click();
      assert.equal(await page.locator('#helpOverlay').isVisible(), false);
    }

    for (const id of ['../../etc/passwd', 'constructor', 'unknown']) {
      const result = await page.evaluate(id => window.electronApi.openHelpDoc(id), id);
      assert.equal(result.ok, false);
    }
    assert.equal(await app.evaluate(() => globalThis.legalOpenCalls.length), openCount);
    await app.evaluate(() => { globalThis.legalOpenError = 'No PDF viewer available'; });
    await page.click('#menu-help');
    await page.click('#mi-help-terms');
    await page.evaluate(() => {
      window.legalAlerts = [];
      window.alert = message => window.legalAlerts.push(message);
    });
    await page.click('#helpDialogContent [data-help-doc-open]');
    await page.waitForFunction(() => window.legalAlerts.length === 1);
    assert.deepEqual(await page.evaluate(() => window.legalAlerts), ['Unable to open the document.']);
    assert.deepEqual(frameErrors, []);
    assert.deepEqual(session.errors, []);
    documentChecksPassed = true;
  } finally {
    await app.evaluate(({ shell }) => {
      if (globalThis.legalOriginalOpenPath) shell.openPath = globalThis.legalOriginalOpenPath;
    }).catch(() => {});
    await closeTestApp(session);
    try {
      const requests = await externalRequestsInNetLog(netLog);
      if (process.env.SOAPY_LEGAL_TEST_REPORT_DIR) {
        await fs.copyFile(netLog, path.join(process.env.SOAPY_LEGAL_TEST_REPORT_DIR, 'network.json'));
      }
      if (linux && documentChecksPassed) assert.deepEqual(requests, [], 'Startup and legal document viewing must make no external web requests');
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
});
