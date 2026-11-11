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
  const reportDir = path.join(root, 'out/linux-validation', mode);
  await fs.mkdir(profile, { mode: 0o700 });
  await fs.mkdir(reportDir, { recursive: true });
  const report = { version, mode, platform: `${os.platform()} ${os.release()} ${os.arch()}`, passed: [], errors: [] };
  let app;
  let page;
  let child;
  let log = '';
  let executablePath = path.join(root, 'dist/linux/linux-unpacked/soapy-panels');
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
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 45000 });
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
        execFileSync(process.execPath, [path.join(root, 'tools/checks/check-package.js'), 'linux', extracted], { timeout: 30000 });
        executablePath = path.join(extracted, 'AppRun');
      }
      await launch();
      report.passed.push('packaged startup, isolated profile, version and sandbox');
      const state = await page.evaluate(() => window.electronApi.getStartupState());
      assert.equal(state.edition, 'linux-community');
      assert.deepEqual(state.capabilities, { adsEnabled: false, storePurchasesEnabled: false, premiumThemes: true, premiumMp4Export: true });
      assert.equal(await page.evaluate(() => !!window.soapyAds), false);
      const assets = await page.evaluate(async () => {
        await document.fonts.ready;
        const sticker = window.soapyStickerManifest[0];
        const responses = await Promise.all([
          fetch(sticker.src), fetch('assets/fonts/Figtree/static/Figtree-Regular.ttf'),
          fetch('docs/legal/Soapy_Panels_Privacy_Policy.pdf'),
        ]);
        return Promise.all(responses.map(async response => response.ok && (await response.arrayBuffer()).byteLength > 0));
      });
      assert.deepEqual(assets, [true, true, true]);
      report.passed.push('Community capabilities, no ads, bundled sticker/font/legal assets');
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
      await page.evaluate(() => document.querySelector('#mi-new').click());
      await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bubbles.length === 0);
      await page.evaluate(() => { window.showOpenFilePicker = undefined; });
      const chooser = page.waitForEvent('filechooser');
      await page.evaluate(() => document.querySelector('#mi-open').click());
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
      report.ok = true;
    })(), 180000, 'Linux smoke test');
  } catch (error) {
    report.ok = false;
    report.failure = error.stack || String(error);
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
