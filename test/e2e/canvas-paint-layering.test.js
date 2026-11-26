const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { PNG } = require('pngjs');
const { launchTestApp, dismissStartupOverlays, closeTestApp } = require('../support/electron-app');

async function setup() {
  const session = await launchTestApp(process.env.SOAPY_PAINT_TEST_APPIMAGE ? {
    executablePath: path.resolve(process.env.SOAPY_PAINT_TEST_APPIMAGE),
    args: process.env.SOAPY_TEST_OZONE_PLATFORM ? [`--ozone-platform=${process.env.SOAPY_TEST_OZONE_PLATFORM}`] : [],
  } : {});
  try {
  session.page.setDefaultTimeout(15000);
  if (process.env.SOAPY_PAINT_TEST_APPIMAGE) {
    const settings = await session.app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
    }));
    assert.deepEqual(settings, { packaged: true, noSandbox: false, sandbox: true });
  }
  await dismissStartupOverlays(session.page);
  const hint = session.page.locator('#dropHint .drop-message .drop-close-button');
  if (await hint.isVisible()) await hint.click();
  await session.page.click('#footerTabToolbox');
  await session.page.click('#footerToolboxPaintBrush');
  await session.page.locator('#paintBrushColor').evaluate(el => {
    el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return session;
  } catch (error) { await closeTestApp(session); throw error; }
}
const snapshot = page => page.evaluate(() => window.SoapyPanels.debug.video.takeProjectSnapshot());
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function screenPoint(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const r = document.querySelector('#stage').getBoundingClientRect();
    const bg = window.SoapyPanels.debug.video.takeProjectSnapshot().bg;
    return { x: r.x + x * r.width / bg.w, y: r.y + y * r.height / bg.h };
  }, { x, y });
}
async function paint(page) {
  const a = await screenPoint(page, 160, 180), b = await screenPoint(page, 600, 180);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 }); await page.mouse.up();
  await page.mouse.move(10, 10);
  await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length > 0);
  await settle(page);
}
async function visiblePixel(page, x, y) {
  const p = await screenPoint(page, x, y);
  const image = PNG.sync.read(await page.screenshot({ clip: { x: Math.floor(p.x), y: Math.floor(p.y), width: 1, height: 1 } }));
  return Array.from(image.data.subarray(0, 4));
}
async function expectPixel(page, x, y, expected) {
  await settle(page);
  assert.deepEqual(await visiblePixel(page, x, y), expected, 'visible artwork pixel');
  assert.deepEqual(await page.evaluate(({ x, y }) => window.SoapyPanels.debug.effects.getExportPixel(x, y), { x, y }), expected, 'export pixel');
}
async function importImage(page, transparent = false, rgba = [0, 0, 255, 255]) {
  const image = new PNG({ width: 1280, height: 720 });
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    image.data.set([rgba[0], rgba[1], rgba[2], transparent && x < 400 ? 0 : rgba[3]], offset);
  }
  const count = (await snapshot(page)).bg.images.length;
  const buffer = PNG.sync.write(image);
  await page.locator('#fileImage').setInputFiles({ name: 'layer.png', mimeType: 'image/png', buffer });
  await page.waitForFunction(n => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.images.length === n, count + 1);
  await settle(page);
  return 'data:image/png;base64,' + buffer.toString('base64');
}
async function undo(page, count) {
  await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
  await page.waitForFunction(n => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.images.length === n, count);
  await settle(page);
}

test('imported images cover existing canvas paint immediately and retain it through clicks and undo', { timeout: 90000 }, async () => {
  const s = await setup(), { page } = s;
  try {
    await paint(page);
    const original = (await snapshot(page)).bg.paintMask;
    await expectPixel(page, 300, 180, [255, 0, 0, 255]);
    await importImage(page);
    // This assertion must pass before any canvas click changes the image renderer.
    await expectPixel(page, 300, 180, [0, 0, 255, 255]);
    const p = await screenPoint(page, 800, 400);
    await page.mouse.click(p.x, p.y); await page.mouse.move(10, 10);
    assert.ok((await snapshot(page)).bg.images[0].paintMask.strokes.length > 0);
    assert.deepEqual((await snapshot(page)).bg.paintMask, original);
    await expectPixel(page, 300, 180, [0, 0, 255, 255]);
    await page.click('#footerToolboxPaintBrush');
    await page.mouse.click(p.x, p.y); await page.mouse.move(10, 10);
    await expectPixel(page, 300, 180, [0, 0, 255, 255]);
    await undo(page, 1); // Undo paint attached to the image.
    await undo(page, 0); // Undo the import, revealing the original strokes.
    await expectPixel(page, 300, 180, [255, 0, 0, 255]);
    await page.evaluate(() => window.SoapyPanels.debug.undo.redo());
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.images.length === 1);
    await expectPixel(page, 300, 180, [0, 0, 255, 255]);
    assert.deepEqual((await snapshot(page)).bg.paintMask, original);
    assert.deepEqual(s.errors, []);
  } finally { await closeTestApp(s); }
});

test('transparent imports, restored documents and empty-paint transitions keep editor and export in agreement', { timeout: 90000 }, async () => {
  const s = await setup(), { page } = s;
  try {
    await paint(page); await importImage(page, true);
    await expectPixel(page, 300, 180, [255, 0, 0, 255]);
    await expectPixel(page, 500, 180, [0, 0, 255, 255]);
    await page.click('#footerToolboxPaintBrush');
    const savedPath = path.join(s.profile, 'paint-layers.soapy');
    await page.exposeFunction('savePaintLayers', text => fs.writeFile(savedPath, text));
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => ({ name: 'paint-layers.soapy', queryPermission: async () => 'granted',
        createWritable: async () => ({ write: async blob => window.savePaintLayers(await blob.text()), close: async () => {} }) });
      document.querySelector('#mi-save-as').click();
    });
    await page.waitForFunction(() => !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
    const saved = JSON.parse(await fs.readFile(savedPath, 'utf8'));
    assert.ok(saved.bg.paintMask.strokes.length);
    await page.click('#menu-file'); await page.click('#mi-new');
    await page.waitForFunction(() => !window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length);
    await importImage(page);
    await page.waitForFunction(() => document.querySelectorAll('#canvasBackground .canvas-bg-layer').length === 1);
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    const chooser = page.waitForEvent('filechooser');
    await page.click('#menu-file'); await page.click('#mi-open');
    await (await chooser).setFiles(savedPath);
    await page.click('[data-project-safety-continue]');
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length > 0);
    await expectPixel(page, 300, 180, [255, 0, 0, 255]);
    await expectPixel(page, 500, 180, [0, 0, 255, 255]);
    assert.equal(await page.locator('#canvasBackground .canvas-bg-layer').count(), 0);
    const withoutPaint = structuredClone(saved); withoutPaint.bg.paintMask.strokes = [];
    await page.evaluate(data => window.SoapyPanels.debug.effects.restoreProject(data), withoutPaint);
    await page.waitForFunction(() => document.querySelectorAll('#canvasBackground .canvas-bg-layer').length === 1);
    await expectPixel(page, 500, 180, [0, 0, 255, 255]);
    await page.evaluate(data => window.SoapyPanels.debug.effects.restoreProject(data), saved);
    await expectPixel(page, 300, 180, [255, 0, 0, 255]);
    await expectPixel(page, 500, 180, [0, 0, 255, 255]);
    await importImage(page, true, [0, 255, 0, 128]);
    await expectPixel(page, 300, 180, [255, 0, 0, 255]);
    await expectPixel(page, 500, 180, [0, 128, 127, 255]);
    assert.deepEqual(s.errors, []);
  } finally { await closeTestApp(s); }
});

test('moving and deleting an image reveals paint, and large filtered artwork samples consistently', { skip: process.platform !== 'linux', timeout: 90000 }, async () => {
  const s = await setup(), { page } = s;
  try {
    await paint(page); const source = await importImage(page);
    const restoreBase = await snapshot(page);
    restoreBase.bg.images[0].src = source;
    const original = (await snapshot(page)).bg.paintMask;
    await page.click('#footerToolboxPaintBrush');
    await page.click('#footerTabLock');
    await page.click('#btnLockBgImagesIcon');
    const a = await screenPoint(page, 700, 350), b = await screenPoint(page, 1050, 350);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
    await page.mouse.move(10, 10);
    assert.ok((await snapshot(page)).bg.images[0].x >= 340, 'real drag moves the image');
    await page.click('#btnLockBgImagesIcon'); // Hide image-selection decorations before comparing pixels.
    await expectPixel(page, 250, 180, [255, 0, 0, 255]);
    await expectPixel(page, 500, 180, [0, 0, 255, 255]);
    await page.locator('#bgImageList [data-bg-image-action="remove"]').evaluate(el => el.click());
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.images.length === 0);
    await expectPixel(page, 500, 180, [255, 0, 0, 255]);
    assert.deepEqual((await snapshot(page)).bg.paintMask, original);
    await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.images.length === 1);
    const empty = await screenPoint(page, 100, 500);
    await page.mouse.click(empty.x, empty.y); await page.mouse.move(10, 10);
    await expectPixel(page, 500, 180, [0, 0, 255, 255]);

    const large = restoreBase;
    large.bg.w = 16000; large.bg.h = 12000;
    Object.assign(large.bg.images[0], { x: 0, y: 0, width: 16000, height: 12000 });
    await page.evaluate(data => window.SoapyPanels.debug.effects.restoreProject(data), large);
    await page.evaluate(() => {
      const zoom = document.querySelector('#zoom'); zoom.value = '10'; zoom.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#scroller').scrollTo(200, 100);
    });
    await page.click('#footerTabColor');
    await page.locator('#bgColor').evaluate(el => el.click());
    await page.click('#linuxColorPicker [data-color-pick]');
    const point = await page.evaluate(() => {
      const a = document.querySelector('#stage').getBoundingClientRect(), b = document.querySelector('#scroller').getBoundingClientRect();
      return { x: Math.max(a.x, b.x) + 80, y: Math.max(a.y, b.y) + 80 };
    });
    await page.mouse.click(point.x, point.y);
    await page.locator('#linuxColorPicker').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#linuxColorPicker [data-color-hex]').inputValue(), '#0000ff');
    const buffers = await page.evaluate(() => window.SoapyPanels.debug.colorSampler.getState());
    assert.ok(buffers.width < buffers.logicalWidth);
    assert.equal(buffers.width, buffers.displayWidth);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const id = window.SoapyPanels.debug.effects.getEntries()[0].id;
      window.SoapyPanels.debug.effects.openEditor(id);
      const mode = document.querySelector('#imageEffectMode'); mode.value = 'grayscale'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#imageEffectsStatus').dataset.state === 'success');
    await page.click('#btnImageEffectsClose');
    assert.equal(await page.locator('#canvasBackground .canvas-bg-layer').count(), 0);
    assert.deepEqual((await snapshot(page)).bg.paintMask, original);
    assert.deepEqual(s.errors, []);
  } finally { await closeTestApp(s); }
});

test('erasing the last canvas strokes restores image previews and undo restores paint layering', { timeout: 90000 }, async () => {
  const s = await setup(), { page } = s;
  try {
    await paint(page); const source = await importImage(page);
    const original = await snapshot(page);
    original.bg.images[0].src = source;
    // Leave the painted area uncovered, with an image on each rendering plane.
    original.bg.images[0].x = 700;
    const front = structuredClone(original.bg.images[0]);
    front.id += '-front'; front.x = 900; front.renderAboveBubbles = true;
    original.bg.images.push(front);
    await page.evaluate(data => window.SoapyPanels.debug.effects.restoreProject(data), original);
    assert.equal(await page.locator('.canvas-bg-layer').count(), 0);
    await page.locator('#toolboxPaintEraser').evaluate(el => el.click());
    const a = await screenPoint(page, 140, 180), b = await screenPoint(page, 620, 180);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 30 }); await page.mouse.up();
    await page.mouse.move(10, 10);
    await page.waitForFunction(() => !window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length);
    await settle(page);
    assert.equal(await page.locator('.canvas-bg-layer').count(), 2);
    await expectPixel(page, 1000, 180, [0, 0, 255, 255]);
    assert.deepEqual(await page.evaluate(() => window.SoapyPanels.debug.effects.getExportPixel(300, 180)), [0, 0, 0, 0]);
    await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.paintMask.strokes.length > 0);
    await expectPixel(page, 300, 180, [255, 0, 0, 255]);
    await expectPixel(page, 1000, 180, [0, 0, 255, 255]);
    assert.equal(await page.locator('.canvas-bg-layer').count(), 0);
    await page.evaluate(() => window.SoapyPanels.debug.undo.redo());
    await page.waitForFunction(() => document.querySelectorAll('.canvas-bg-layer').length === 2);
    assert.deepEqual(s.errors, []);
  } finally { await closeTestApp(s); }
});
