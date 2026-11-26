const test = require('node:test');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const { launchTestApp, dismissStartupOverlays, closeTestApp } = require('../support/electron-app');

test('New Project clears real brush strokes, pending gestures, history and saved paint', { timeout: 90000 }, async () => {
  const session = await launchTestApp();
  const { page } = session;
  page.setDefaultTimeout(15000);
  try {
    await dismissStartupOverlays(page);
    await page.locator('#footerTabToolbox').click();
    await page.locator('#footerToolboxPaintBrush').click();
    const box = await page.locator('#stage').boundingBox();
    const x = box.x + box.width / 4, y = box.y + box.height / 4;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 40, y + 30, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length > 0);
    const painted = await page.evaluate(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask);
    const preference = await page.locator('#paintBrushColor').inputValue();
    await page.click('#menu-file'); await page.click('#mi-new');
    await page.click('[data-project-safety-cancel]');
    assert.deepEqual(await page.evaluate(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask), painted);

    // Request New during a stroke, then deliver its late move/up to the new document.
    await page.mouse.move(x, y); await page.mouse.down();
    await page.locator('#mi-new').evaluate(el => el.click());
    await page.locator('[data-project-safety-continue]').waitFor({ state: 'visible' });
    await page.locator('[data-project-safety-continue]').evaluate(el => el.click());
    await page.waitForFunction(() => !window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length && !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
    await page.mouse.move(x + 80, y + 80, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
    assert.equal(await page.evaluate(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length), 0);
    assert.equal(await page.locator('#paintBrushColor').inputValue(), preference);
    const png = await page.evaluate(() => window.SoapyPanels.debug.video.exportImageDataUrl('png'));
    const dataUrl = typeof png === 'string' ? png : png.dataUrl;
    const image = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
    for (let i = 3; i < image.data.length; i += 4) assert.equal(image.data[i], 0, 'New Project export must be transparent');
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => ({ name: 'empty.soapy', queryPermission: async () => 'granted',
        createWritable: async () => ({ write: async blob => { window.savedEmptyPaint = await blob.text(); }, close: async () => {} }) });
      document.querySelector('#mi-save-as').click();
    });
    await page.waitForFunction(() => !!window.savedEmptyPaint && !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
    assert.equal(await page.evaluate(() => JSON.parse(window.savedEmptyPaint).bg.paintMask.strokes.length), 0);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 40, y + 30, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length > 0);
    await page.evaluate(() => {
      window.showOpenFilePicker = async () => [{ getFile: async () => new File([window.savedEmptyPaint], 'empty.soapy', { type: 'application/json' }) }];
      document.querySelector('#mi-open').click();
    });
    await page.click('[data-project-safety-continue]');
    await page.waitForFunction(() => !window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length && !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
    await page.evaluate(() => window.SoapyPanels.debug.recovery.flush());
    assert.equal(await page.evaluate(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length), 0);
    assert.deepEqual(session.errors, []);
  } finally { await closeTestApp(session); }
});
