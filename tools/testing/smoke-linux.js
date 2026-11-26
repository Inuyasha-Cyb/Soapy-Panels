#!/usr/bin/env node
// Exercise production startup. Only OS file pickers are automated; app IPC,
// serialization, recovery and encoders run from the packaged app.asar.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { _electron: electron } = require('playwright');
const { PNG } = require('pngjs');
const { root, version, artifactPath, validateArtifact } = require('../packaging/linux-artifact');
const { sanitizeElectronEnvironment } = require('../development/start-electron');
const { dismissStartupOverlays } = require('../../test/support/electron-app');
const { externalRequestsInNetLog } = require('./network-log');

function bounded(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function main() {
  const mode = process.argv[2] || 'unpacked';
  assert.ok(['unpacked', 'appimage', 'extracted'].includes(mode), 'Usage: smoke-linux.js [unpacked|appimage|extracted]');
  assert.equal(process.platform, 'linux');
  await validateArtifact();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-linux-smoke-'));
  const profile = path.join(temporary, 'profile');
  const reportDir = path.join(path.resolve(root, process.env.SOAPY_LINUX_REPORT_DIR || 'out/linux-validation'), mode);
  await fs.mkdir(profile, { mode: 0o700 });
  await fs.mkdir(reportDir, { recursive: true });
  const report = { version, mode, platform: `${os.platform()} ${os.release()} ${os.arch()}`, passed: [], errors: [] };
  let app;
  let page;
  let child;
  let log = '';
  const networkLogs = [];
  let executablePath = path.join(path.dirname(artifactPath), 'linux-unpacked/soapy-panels');
  if (mode === 'appimage') executablePath = artifactPath;

  async function launch() {
    const env = sanitizeElectronEnvironment({
      XDG_CONFIG_HOME: path.join(temporary, 'config'),
      XDG_CACHE_HOME: path.join(temporary, 'cache'),
      SOAPY_DEV_EDITION: 'windows-store', // Packaged metadata must win.
    });
    delete env.APPIMAGE_EXTRACT_AND_RUN;
    delete env.APPIMAGE;
    delete env.APPDIR;
    const args = [`--user-data-dir=${profile}`];
    const netLog = path.join(reportDir, `network-${networkLogs.length + 1}.json`);
    networkLogs.push(netLog);
    args.push(`--log-net-log=${netLog}`);
    if (process.env.SOAPY_TEST_OZONE_PLATFORM) {
      assert.ok(['wayland', 'x11'].includes(process.env.SOAPY_TEST_OZONE_PLATFORM));
      args.push(`--ozone-platform=${process.env.SOAPY_TEST_OZONE_PLATFORM}`);
    }
    if (process.env.SOAPY_TEST_SCALE_FACTOR) {
      assert.ok(['1', '1.5', '2'].includes(process.env.SOAPY_TEST_SCALE_FACTOR));
      args.push(`--force-device-scale-factor=${process.env.SOAPY_TEST_SCALE_FACTOR}`);
    }
    app = await electron.launch({ executablePath, args, env, timeout: 45000 });
    child = app.process();
    child.stdout?.on('data', data => { log += data; });
    child.stderr?.on('data', data => { log += data; });
    page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForFunction(() => !!window.SoapyPanels?.debug?.recovery);
    await dismissStartupOverlays(page);
    const metadata = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, version: app.getVersion(), profile: app.getPath('userData'),
      sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    }));
    assert.equal(metadata.packaged, true);
    assert.equal(metadata.version, version);
    assert.equal(metadata.profile, profile, 'Smoke test must use an isolated profile');
    assert.equal(metadata.sandbox, true);
    assert.equal(metadata.noSandbox, false, 'Release launcher must preserve the sandbox');
  }

  async function saveProject() {
    // The picker adapter writes real bytes to disk through the test harness.
    await page.exposeFunction('smokeWriteProject', text => fs.writeFile(path.join(temporary, 'smoke.soapy'), text));
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => ({
        name: 'smoke.soapy', queryPermission: async () => 'granted',
        createWritable: async () => ({ write: async blob => window.smokeWriteProject(await blob.text()), close: async () => {} }),
      });
      document.querySelector('#mi-save-as').click();
    });
    await page.waitForFunction(() => !document.querySelector('#mi-save').disabled && !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
    const saved = JSON.parse(await fs.readFile(path.join(temporary, 'smoke.soapy'), 'utf8'));
    assert.equal(saved.bubbles.length, 1);
    assert.equal(saved.bg.images.length, 1);
  }

  try {
    await bounded((async () => {
      if (mode === 'extracted') {
        execFileSync(artifactPath, ['--appimage-extract'], { cwd: temporary, timeout: 60000, stdio: 'pipe' });
        const extracted = path.join(temporary, 'squashfs-root');
        execFileSync(process.execPath, [path.join(root, 'tools/checks/check-package.js'), 'linux', extracted, '--appimage'], { timeout: 30000 });
        executablePath = path.join(extracted, 'AppRun');
      }
      await launch();
      report.passed.push('packaged startup, isolated profile, version and sandbox');
      if (process.env.SOAPY_TEST_OZONE_PLATFORM === 'x11') {
        const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
        const properties = execFileSync('xprop', ['-id', String(windowId), '-len', '5000000', '-f', '_NET_WM_ICON', '32c', 'WM_CLASS', '_NET_WM_ICON'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
        assert.match(properties, /WM_CLASS.*com\.soapy\.panels/);
        assert.match(properties, /_NET_WM_ICON\(CARDINAL\) = [1-9]\d*, [1-9]\d*, \d/);
        const pixels = properties.split('_NET_WM_ICON(CARDINAL) = ')[1].trim().split(',').map(Number);
        const [width, height] = pixels;
        assert.ok(pixels.length >= 2 + width * height, 'Native icon must contain all pixels');
        const expected = PNG.sync.read(await fs.readFile(path.join(root, 'packaging/assets/icons/icon.png')));
        assert.equal(width, 128);
        assert.equal(height, 128);
        const center = Math.floor(height / 2) * width + Math.floor(width / 2);
        const sourceCenter = Math.floor(expected.height / 2) * expected.width + Math.floor(expected.width / 2);
        const [r, g, b, a] = expected.data.subarray(sourceCenter * 4, sourceCenter * 4 + 4);
        assert.equal(pixels[center + 2], ((a << 24) | (r << 16) | (g << 8) | b) >>> 0);
        await fs.writeFile(path.join(reportDir, 'window-properties.json'), JSON.stringify({ wmClass: properties.split('\n')[0], width, height, centerArgb: pixels[center + 2] }, null, 2));
        report.passed.push('X11 window identity and native icon property');
      }
      const state = await page.evaluate(() => window.electronApi.getStartupState());
      assert.equal(state.edition, 'linux-community');
      assert.deepEqual(state.capabilities, { adsEnabled: false, storePurchasesEnabled: false, premiumThemes: true, premiumMp4Export: true });
      assert.equal(await page.evaluate(() => !!window.soapyAds), false);
      const assets = await page.evaluate(async () => {
        await document.fonts.ready;
        const sticker = window.soapyStickerManifest[0];
        const responses = await Promise.all([
          fetch(sticker.src), fetch('assets/fonts/Figtree/static/Figtree-Regular.ttf'),
          fetch('docs/legal/Soapy_Panels_Linux_Privacy_Notice.pdf'),
        ]);
        return Promise.all(responses.map(async response => response.ok && (await response.arrayBuffer()).byteLength > 0));
      });
      assert.deepEqual(assets, [true, true, true]);
      report.passed.push('Community capabilities, no ads, bundled sticker/font/legal assets');
      await page.click('#footerTabColor');
      await page.locator('#bgColor').evaluate(input => input.click());
      const picker = page.locator('#linuxColorPicker');
      await picker.locator('[data-color-hex]').fill('#123456');
      await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.color === '#123456');
      await page.screenshot({ path: path.join(reportDir, 'color-picker.png') });
      await picker.locator('[data-color-close]').click();
      await page.locator('#bgColor').evaluate(input => input.click());
      await picker.locator('[data-color-pick]').click();
      const canvasBox = await page.locator('#stage').boundingBox();
      await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
      const magnifier = page.locator('#canvasColorMagnifier');
      await magnifier.waitFor({ state: 'visible' });
      assert.equal(await magnifier.locator('span').innerText(), '#123456');
      await page.screenshot({ path: path.join(reportDir, 'magnifier.png') });
      await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
      await picker.waitFor({ state: 'visible' });
      assert.equal(await picker.locator('[data-color-hex]').inputValue(), '#123456');
      await picker.locator('[data-color-close]').click();
      assert.equal(await page.locator('#bgColor').inputValue(), '#123456');
      report.passed.push('Live Linux color popup and magnified canvas eyedropper');
      await page.click('#footerTabToolbox');
      await page.click('#footerToolboxPaintBrush');
      // At large desktop scaling the startup hint covers most of the canvas.
      const dropHintClose = page.locator('.drop-message .drop-close-button');
      if (await dropHintClose.isVisible()) await dropHintClose.click();
      const paintBox = await page.locator('#stage').boundingBox();
      await page.mouse.move(paintBox.x + paintBox.width / 4, paintBox.y + paintBox.height / 4);
      await page.mouse.down();
      await page.mouse.move(paintBox.x + paintBox.width / 4 + 40, paintBox.y + paintBox.height / 4 + 20, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length > 0);
      await page.click('#menu-file');
      await page.click('#mi-new');
      await page.click('[data-project-safety-continue]');
      await page.waitForFunction(() => !window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length && !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
      const blankExport = await page.evaluate(() => window.SoapyPanels.debug.video.exportImageDataUrl('png'));
      const blankPng = PNG.sync.read(Buffer.from((typeof blankExport === 'string' ? blankExport : blankExport.dataUrl).split(',')[1], 'base64'));
      for (let i = 3; i < blankPng.data.length; i += 4) assert.equal(blankPng.data[i], 0, 'New Project must not export old paint');
      await page.locator('#toolboxPaintBrush').evaluate(button => { if (button.getAttribute('aria-pressed') === 'true') button.click(); });
      report.passed.push('New Project clears painted artwork and exported pixels');
      const archive = await app.evaluate(({ app }) => app.getAppPath());
      const asar = require('@electron/asar');
      await fs.writeFile(path.join(profile, 'fonts/smoke.ttf'), asar.extractFile(archive, 'app/renderer/assets/fonts/Figtree/static/Figtree-Regular.ttf'));
      await page.waitForFunction(async () => (await window.electronApi.getUserFontsAsync()).length > 0);
      report.passed.push('user font import');
      await page.evaluate(() => document.querySelector('.add-bubble-option[data-bubble-type="speech"]').click());
      const importImage = new PNG({ width: 320, height: 240 });
      importImage.data.fill(255);
      await page.locator('#fileImage').setInputFiles({
        name: 'pixel.png', mimeType: 'image/png',
        buffer: PNG.sync.write(importImage),
      });
      await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.images.length === 1);
      await page.evaluate(() => window.SoapyPanels.debug.recovery.flush());
      const backups = await fs.readdir(path.join(profile, 'project-recovery'));
      assert.ok(backups.length > 0);
      const crashed = once(child, 'exit');
      child.kill('SIGKILL');
      await bounded(crashed, 10000, 'crash');
      app = null;
      await launch();
      await page.waitForSelector('#projectRecoveryDialog[open]');
      await page.click('[data-recovery-action="recover"]');
      await page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
      await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bubbles.length === 1);
      report.passed.push('editing, image import and crash recovery');
      await saveProject();
      await page.click('#menu-file');
      await page.click('#mi-new');
      await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bubbles.length === 0);
      await page.evaluate(() => { window.showOpenFilePicker = undefined; });
      const chooser = page.waitForEvent('filechooser');
      // File inputs require a live user gesture; evaluate(input.click()) can
      // silently fail once Chromium's transient activation has expired.
      await page.click('#menu-file');
      await page.click('#mi-open');
      await (await chooser).setFiles(path.join(temporary, 'smoke.soapy'));
      await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bubbles.length === 1 && window.SoapyPanels.debug.video.takeProjectSnapshot().bg.images.length === 1 && !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
      report.passed.push('project save to disk and reopen');
      for (const format of ['png', 'jpg', 'gif', 'mp4']) {
        const destination = path.join(temporary, `export.${format}`);
        await app.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, destination);
        // Use production encoders and the real native save-target IPC, including
        // stream finalization for MP4. Native dialog selection alone is automated.
        const result = await page.evaluate(async format => {
          const debug = window.SoapyPanels.debug;
          const encoded = format === 'gif' ? await debug.gif.exportDataUrl()
            : format === 'mp4' ? await debug.video.exportMp4DataUrl({ quality: '720p' })
            : await debug.video.exportImageDataUrl(format);
          const dataUrl = typeof encoded === 'string' ? encoded : encoded.dataUrl;
          const encodedData = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
          if (!encodedData) throw new Error('Encoder did not return a base64 data URL');
          const bytes = Uint8Array.from(atob(encodedData[2]), char => char.charCodeAt(0)).buffer;
          const api = window.electronApi;
          const target = await api.showExportSaveDialog({ mime: encodedData[1], extensions: [format], suggestedName: `export.${format}` });
          if (!target.targetId) throw new Error(target.error || 'No export target');
          if (format !== 'mp4') return api.writeExportFile(target.targetId, bytes);
          const stream = await api.beginExportStream(target.targetId);
          if (!stream.ok) throw new Error(stream.error);
          const written = await api.writeExportStreamChunk(stream.sessionId, 0, bytes);
          if (!written.ok) throw new Error(written.error);
          return api.finishExportStream(stream.sessionId);
        }, format);
        assert.equal(result.ok, true, result.error);
        const bytes = await fs.readFile(destination);
        assert.ok(bytes.length > 32, `${format} export is empty`);
        if (format === 'png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        if (format === 'jpg') assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
        if (format === 'gif') assert.match(bytes.subarray(0, 6).toString(), /^GIF8[79]a$/);
        if (format === 'mp4') assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
        report.passed.push(`${format} encoding and native file write`);
      }
      await page.screenshot({ path: path.join(reportDir, 'editor.png') });
      assert.deepEqual(report.errors, []);
      await bounded(app.close(), 15000, 'clean shutdown');
      assert.equal(child.exitCode, 0);
      app = null;
      report.passed.push('clean shutdown');
      report.externalRequests = (await Promise.all(networkLogs.map(externalRequestsInNetLog))).flat();
      assert.deepEqual(report.externalRequests, [], 'Offline editing flows must make no external web requests');
      report.passed.push('no external web requests observed during startup, editing, recovery, save/reopen and export');
      report.ok = true;
    })(), 180000, 'Linux smoke test');
  } catch (error) {
    report.ok = false;
    report.failure = error.stack || String(error);
    if (page && !page.isClosed()) {
      try {
        await page.screenshot({ path: path.join(reportDir, 'failure.png'), timeout: 5000 });
        report.editorState = await page.evaluate(() => ({
          safety: window.SoapyPanels?.debug?.video?.getProjectSafetyState(),
          dialogs: [...document.querySelectorAll('dialog[open], [role="dialog"]')].filter(el => el.getClientRects().length).map(el => ({ id: el.id, text: el.textContent.slice(0, 500) })),
        }));
      } catch { /* Preserve the original failure if the renderer is unavailable. */ }
    }
    throw error;
  } finally {
    if (app) {
      try { await bounded(app.close(), 5000, 'cleanup'); }
      catch { child?.kill('SIGKILL'); }
    }
    await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(reportDir, 'electron.log'), log);
    await fs.rm(temporary, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
