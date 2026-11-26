#!/usr/bin/env node
// Usage: node tools/development/measure-filter-preview.js [--app-root=/path] [--soak-seconds=300]
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { sanitizeElectronEnvironment } = require('./start-electron');
const { dismissStartupOverlays, closeTestApp } = require('../../test/support/electron-app');
const { makeVideo, makeGif, selectEffect } = require('../../test/support/filter-preview');
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const root = path.resolve(args['app-root'] || path.join(__dirname, '../..'));
const soak = Math.max(0, Number(args['soak-seconds']) || 0);
(async () => {
  let session;
  const report = { platform: process.platform, cpu: os.cpus()[0].model, memoryGiB: os.totalmem() / 2 ** 30, appRoot: root, cases: [] };
  try {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-filter-bench-'));
    const app = await electron.launch({ args: [path.join(root, 'test/support/recovery-launch.js'), '--no-sandbox'], env: sanitizeElectronEnvironment({ SOAPY_TEST_PROFILE: profile }) });
    const page = await app.firstWindow();
    session = { app, page, profile, ownedProfile: true };
    await page.waitForFunction(() => window.SoapyPanels?.debug?.filterPreview, null, { timeout: 45000 });
    await dismissStartupOverlays(page);
    report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }));
    report.display = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    const video = await makeVideo(page);
    await page.evaluate(data => window.SoapyPanels.debug.video.addDataUrlAsBackground(data, { id: 'bench', reset: true, canvasWidth: 1920, canvasHeight: 1080 }), video);
    async function measure(name, seconds = 4, sliders = false) {
      await page.waitForTimeout(250); // Let first-frame priming finish before requesting playback.
      await page.evaluate(() => {
        const debug = window.SoapyPanels.debug.video;
        debug.getEntries().filter(entry => entry.mediaKind === 'video' && entry.paused)
          .forEach(entry => debug.togglePlayback(entry.id));
      });
      await page.waitForTimeout(1500); // Adaptation and palette warm-up are excluded.
      const result = await page.evaluate(async ({ seconds, sliders }) => {
        const debug = window.SoapyPanels.debug.filterPreview;
        debug.metrics.reset();
        debug.metrics.enable();
        let timer;
        if (sliders) {
          let step = 0;
          timer = setInterval(() => {
            const input = document.querySelector('#imageEffectAmount');
            input.value = String(30 + (step++ % 60));
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }, 40);
        }
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        if (timer) {
          clearInterval(timer);
          document.querySelector('#imageEffectAmount').dispatchEvent(new Event('change', { bubbles: true }));
        }
        const result = { metrics: debug.metrics.snapshot(), queue: debug.queue(), entries: debug.entries(), previewStatus: document.querySelector('#imageEffectsStatus').textContent.trim() };
        debug.metrics.enable(false);
        return result;
      }, { seconds, sliders });
      report.cases.push({ name, seconds, ...result });
      console.error(JSON.stringify({ name, intervals: result.metrics.displayIntervalMs, entries: result.entries }));
    }
    for (const type of ['grayscale', 'threshold', 'posterize', 'duotone', 'gradientMap']) {
      await selectEffect(page, 'bench', type, true);
      await measure('1080p/' + type);
    }
    await measure('1080p/slider-drag', 4, true);
    await page.evaluate(data => window.SoapyPanels.debug.gif.addDataUrlAsBackground(data, { id: 'gif', reset: true, canvasWidth: 640, canvasHeight: 360 }), makeGif());
    for (const type of ['grayscale', 'threshold', 'posterize', 'duotone', 'gradientMap']) {
      await selectEffect(page, 'gif', type, true);
      await measure('gif/' + type, 2);
    }
    const largeVideo = await makeVideo(page, 3840, 2160);
    await page.evaluate(data => window.SoapyPanels.debug.video.addDataUrlAsBackground(data, { id: 'large', reset: true, canvasWidth: 1920, canvasHeight: 1080 }), largeVideo);
    await selectEffect(page, 'large', 'posterize', true);
    await measure('4k/posterize');
    await page.evaluate(() => document.querySelector('#btnImageEffectsApply').click());
    await page.waitForFunction(() => !window.SoapyPanels.debug.effects.getEditorState().open);
    await page.evaluate(data => window.SoapyPanels.debug.video.addDataUrlAsBackground(data, { id: 'second', width: 960, height: 540 }), video);
    await selectEffect(page, 'second', 'gradientMap', true);
    await measure('two-videos');
    if (soak) {
      for (let elapsed = 0; elapsed < soak; elapsed += 30) {
        await measure('soak/' + elapsed, Math.min(30, soak - elapsed));
        report.cases[report.cases.length - 1].processes = await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, memory: item.memory })));
      }
    }
  } catch (error) {
    report.error = error.message;
    if (session) report.failureState = await session.page.evaluate(() => ({
      editor: window.SoapyPanels.debug.effects.getEditorState(),
      entries: window.SoapyPanels.debug.filterPreview.entries(),
      status: document.querySelector('#imageEffectsStatus').textContent,
      videos: window.SoapyPanels.debug.video.getEntries(),
    })).catch(() => null);
    throw error;
  } finally {
    console.log(JSON.stringify(report, null, 2));
    await closeTestApp(session);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
