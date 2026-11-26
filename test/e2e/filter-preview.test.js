const test = require('node:test');
const assert = require('node:assert/strict');
const { launchTestApp, dismissStartupOverlays, closeTestApp } = require('../support/electron-app');
const { makeVideo, selectEffect } = require('../support/filter-preview');

test('animated filters render, coalesce adjustments, seek, sharpen paused frames and release replaced media', { timeout: 90000 }, async () => {
  let session;
  try {
    session = await launchTestApp();
    const { page } = session;
    await dismissStartupOverlays(page);
    const data = await makeVideo(page);
    await page.evaluate(data => window.SoapyPanels.debug.video.addDataUrlAsBackground(data, { id: 'preview-test', reset: true, canvasWidth: 1920, canvasHeight: 1080 }), data);
    for (const type of ['grayscale', 'threshold', 'posterize', 'duotone', 'gradientMap']) {
      await selectEffect(page, 'preview-test', type);
      const entries = await page.evaluate(() => window.SoapyPanels.debug.filterPreview.entries());
      assert.ok(entries[0].width > 0, type);
      assert.equal(entries[0].error, null);
    }
    await page.evaluate(() => {
      window.SoapyPanels.debug.filterPreview.metrics.enable();
      window.SoapyPanels.debug.video.togglePlayback("preview-test");
    });
    await page.waitForFunction(() => window.SoapyPanels.debug.filterPreview.metrics.snapshot().displayIntervalMs?.count > 5);
    await page.evaluate(() => window.SoapyPanels.debug.filterPreview.metrics.reset());
    await page.waitForTimeout(2200); // Include a loop/seek without any new control input.
    assert.equal(await page.evaluate(() => window.SoapyPanels.debug.filterPreview.metrics.snapshot().adjustmentMs), undefined);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.SoapyPanels.debug.filterPreview.queue().active === 0);
    assert.equal(await page.evaluate(() => window.SoapyPanels.debug.filterPreview.queue().paused), true);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => !window.SoapyPanels.debug.filterPreview.queue().paused);
    await page.evaluate(async () => {
      const input = document.querySelector('#imageEffectAmount');
      for (let i = 0; i < 12; i++) {
        input.value = String(30 + i * 5);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#imageEffectsStatus').dataset.state === 'success');
    const queue = await page.evaluate(() => window.SoapyPanels.debug.filterPreview.queue());
    assert.ok(queue.active <= 1 && queue.pending <= 1);
    await page.evaluate(() => window.SoapyPanels.debug.video.togglePlayback("preview-test"));
    await page.waitForFunction(() => !window.SoapyPanels.debug.filterPreview.entries()[0].active);
    const before = await page.evaluate(() => window.SoapyPanels.debug.filterPreview.entries()[0]);
    await page.evaluate(() => {
      window.SoapyPanels.debug.video.seek('preview-test', 0.5);
    });
    await page.waitForFunction(generation => {
      const entry = window.SoapyPanels.debug.filterPreview.entries()[0];
      return entry.generation > generation && entry.width > 0 && !entry.active;
    }, before.generation);
    const after = await page.evaluate(() => window.SoapyPanels.debug.filterPreview.entries()[0]);
    assert.equal(after.frameCount, 1);
    assert.ok(after.width >= before.width);
    for (let iteration = 0; iteration < 4; iteration++) {
      await page.evaluate(data => window.SoapyPanels.debug.video.addDataUrlAsBackground(data, { id: 'replacement', reset: true }), data);
      await page.waitForFunction(() => window.SoapyPanels.debug.filterPreview.queue().active === 0);
      assert.equal((await page.evaluate(() => window.SoapyPanels.debug.filterPreview.entries()))[0].frameCount, 0);
      await selectEffect(page, 'replacement', 'posterize');
    }
    assert.deepEqual(session.errors, []);
  } finally { await closeTestApp(session); }
});

test('reused worker canvas preserves alpha, dimensions and all filter pixels', { timeout: 60000 }, async () => {
  let session;
  try {
    session = await launchTestApp();
    const results = await session.page.evaluate(async () => {
      const processor = window.SoapyPanels.images.effectsRuntime.createProcessor();
      const effects = window.SoapyPanels.images.effects;
      const results = [];
      try {
        for (const size of [32, 48, 32]) {
          for (const type of effects.EFFECT_TYPES) {
            const canvas = new OffscreenCanvas(size, size);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#e04020';
            ctx.fillRect(0, 0, size / 2, size);
            const reference = ctx.getImageData(0, 0, size, size);
            const effect = effects.defaultsForType(type);
            effects.processImageData(reference, effect);
            const bitmap = await processor.process(canvas, effect);
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(bitmap, 0, 0);
            const actual = ctx.getImageData(0, 0, size, size).data;
            results.push(bitmap.width === size && reference.data.every((value, i) => value === actual[i]));
            bitmap.close();
          }
        }
      } finally { processor.destroy(); }
      return results;
    });
    assert.ok(results.every(Boolean));
    assert.deepEqual(session.errors, []);
  } finally { await closeTestApp(session); }
});

test('GIF cached frames keep repainting across loops with bounded resources', { timeout: 60000 }, async () => {
  const { makeGif } = require('../support/filter-preview');
  let session;
  try {
    session = await launchTestApp();
    const { page } = session;
    await dismissStartupOverlays(page);
    await page.evaluate(data => window.SoapyPanels.debug.gif.addDataUrlAsBackground(data, { id: 'gif-test', reset: true, canvasWidth: 640, canvasHeight: 360 }), makeGif());
    await selectEffect(page, 'gif-test', 'duotone');
    await page.evaluate(() => window.SoapyPanels.debug.filterPreview.metrics.enable());
    await page.waitForFunction(() => window.SoapyPanels.debug.filterPreview.metrics.snapshot().displayIntervalMs?.count > 15);
    const entry = await page.evaluate(() => window.SoapyPanels.debug.filterPreview.entries()[0]);
    assert.ok(entry.frameCount > 1 && entry.frameCount <= 12);
    assert.ok(entry.pixels <= 12000000);
    assert.deepEqual(session.errors, []);
  } finally { await closeTestApp(session); }
});

test('fallback frame scheduling and full-resolution exports remain functional', { timeout: 90000 }, async () => {
  let session;
  try {
    session = await launchTestApp();
    const { page } = session;
    await dismissStartupOverlays(page);
    await page.evaluate(() => { HTMLVideoElement.prototype.requestVideoFrameCallback = undefined; });
    const data = await makeVideo(page, 320, 180);
    await page.evaluate(data => window.SoapyPanels.debug.video.addDataUrlAsBackground(data, { id: 'export-test', reset: true, canvasWidth: 320, canvasHeight: 180 }), data);
    await selectEffect(page, 'export-test', 'grayscale');
    await page.evaluate(() => {
      document.querySelector('#btnImageEffectsApply').click();
      window.SoapyPanels.debug.filterPreview.metrics.enable();
      window.SoapyPanels.debug.video.togglePlayback('export-test');
    });
    await page.waitForFunction(() => window.SoapyPanels.debug.filterPreview.metrics.snapshot().displayIntervalMs?.count > 5);
    await page.evaluate(() => window.SoapyPanels.debug.video.togglePlayback('export-test'));
    const png = await page.evaluate(async () => {
      const url = await window.SoapyPanels.debug.effects.exportImageDataUrl('png');
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixel: Array.from(context.getImageData(5, 5, 1, 1).data) };
    });
    assert.equal(png.width, 320);
    assert.equal(png.height, 180);
    assert.equal(png.pixel[0], png.pixel[1]);
    assert.equal(png.pixel[1], png.pixel[2]);
    const mp4 = await page.evaluate(() => window.SoapyPanels.debug.video.exportMp4DataUrl({ fps: 30 }));
    assert.equal(mp4.width, 320);
    assert.equal(mp4.height, 180);
    assert.equal(mp4.fps, 30);
    assert.equal(mp4.frameCount, 60);
    assert.equal(mp4.durationMs, 2000);
    assert.deepEqual(session.errors, []);
  } finally { await closeTestApp(session); }
});
