const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PNG } = require('pngjs');
const { launchTestApp, dismissStartupOverlays, closeTestApp } = require('../support/electron-app');

test('Linux color popup updates live, samples, cancels sampling and recovers without a native dialog', { skip: process.platform !== 'linux', timeout: 90000 }, async () => {
  const session = await launchTestApp();
  const { page, errors } = session;
  try {
    await dismissStartupOverlays(page);
    page.setDefaultTimeout(10000);
    await page.click("#footerTabColor");
    await page.evaluate(() => window.SoapyPanels.debug.video.setCanvasBackground('#123456', 1));
    const popup = page.locator('#linuxColorPicker');
    const hex = popup.locator('[data-color-hex]');
    const bg = page.locator('#bgColor');
    await page.locator('.footer-custom-color-picker').click();
    await hex.fill('#abcdef');
    await page.waitForFunction(() => document.querySelector('#bgColor').value === '#abcdef');
    await page.keyboard.press('Escape');
    assert.equal(await popup.isVisible(), false);
    await page.waitForFunction(() => document.querySelector('#bgColor').value === '#abcdef');
    await bg.focus();
    await page.keyboard.press('Enter');
    await hex.fill('wrong');
    assert.equal(await hex.getAttribute('aria-invalid'), 'true');
    assert.equal(await bg.inputValue(), '#abcdef');
    await hex.fill('#abc');
    await popup.locator('[data-color-close]').click();
    assert.equal(await bg.inputValue(), '#aabbcc');
    await page.evaluate(() => window.SoapyPanels.debug.video.setCanvasBackground('#123456', 1));

    await page.locator('#bgColor').evaluate(el => el.click());
    const brushBefore = await page.locator('#bgColor').inputValue();
    const pick = popup.locator('[data-color-pick]');
    await pick.click();
    assert.equal(await popup.isVisible(), false);
    await page.keyboard.press('Escape');
    assert.equal(await popup.isVisible(), true);
    await pick.click();
    await page.mouse.click(2, 2);
    assert.equal(await popup.isVisible(), true);
    const sample = async () => {
      await pick.click();
      const box = await page.locator('#stage').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await popup.waitFor({ state: 'visible' });
    };
    await page.evaluate(() => {
      window.savedReadPixel = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = () => { throw new Error('forced read failure'); };
    });
    await sample();
    assert.match(await popup.locator('[data-color-message]').innerText(), /try again/i);
    assert.equal(await page.locator('#bgColor').inputValue(), brushBefore);
    await page.evaluate(() => { CanvasRenderingContext2D.prototype.getImageData = window.savedReadPixel; });
    await sample();
    assert.equal(await hex.inputValue(), '#123456');
    await page.waitForFunction(() => document.querySelector('#bgColor').value === '#123456');
    await popup.locator('[data-color-close]').click();
    assert.equal(await page.locator('#bgColor').inputValue(), '#123456');

    await bg.evaluate(el => el.click());
    await bg.evaluate(el => { el.disabled = true; });
    await popup.waitFor({ state: 'hidden' });
    await bg.evaluate(el => { el.disabled = false; });
    await page.evaluate(() => {
      const input = document.createElement('input'); input.type = 'color'; input.id = 'temporaryColor';
      document.body.appendChild(input); input.click(); input.remove();
    });
    await popup.waitFor({ state: 'hidden' });

    await page.locator('.color-gradient-button[data-gradient-target="bgColor"]').evaluate(el => el.click());
    const stop = page.locator('.gradient-stop input[type=color]').first();
    await stop.click();
    await hex.fill('#ff8800');
    await page.keyboard.press('Escape');
    assert.equal(await stop.inputValue(), '#ff8800');
    assert.equal(await page.locator('#gradientOverlay').isVisible(), true);
    await stop.click();
    await sample();
    assert.equal(await hex.inputValue(), '#123456');
    await popup.locator('[data-color-close]').click();
    assert.equal(await stop.inputValue(), '#123456');
    await page.locator('[data-gradient-cancel]').click();
    await page.evaluate(() => window.SoapyPanels.debug.video.setCanvasBackground('#ff0000', 0));
    await bg.evaluate(el => el.click());
    await pick.click();
    // Compare the same settled checkerboard state before and after the click.
    // Sampling its fade or an antialiased tile boundary compares different colors.
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#canvasChecker'), '::before').opacity === '1');
    const { x, y } = await page.evaluate(() => {
      const rect = document.querySelector('#stage').getBoundingClientRect();
      const bg = window.SoapyPanels.debug.video.takeProjectSnapshot().bg;
      const halfTile = parseFloat(getComputedStyle(document.querySelector('#canvasChecker'), '::before').backgroundSize) / 2;
      const center = size => Math.floor(size / 2 / halfTile) * halfTile + halfTile / 2;
      return { x: Math.floor(rect.x + center(bg.w) * rect.width / bg.w),
        y: Math.floor(rect.y + center(bg.h) * rect.height / bg.h) };
    });
    const expectedPixel = PNG.sync.read(await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).data;
    await page.mouse.click(x + 0.5, y + 0.5);
    await popup.waitFor({ state: 'visible' });
    const pickedColor = await hex.inputValue();
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(parseInt(pickedColor.slice(1 + i * 2, 3 + i * 2), 16) - expectedPixel[i]) <= 3, `transparent backdrop channel ${i}: picked ${pickedColor}, displayed ${[...expectedPixel]}`);
    await popup.locator('[data-color-close]').click();
    assert.deepEqual(errors, []);
  } finally { await closeTestApp(session); }
});

test('rainbow hue and magnifier show live colors without changing canvas zoom', { skip: process.platform !== 'linux', timeout: 60000 }, async () => {
  const session = await launchTestApp();
  const { page } = session;
  page.setDefaultTimeout(12000);
  try {
    await dismissStartupOverlays(page);
    await page.click('#footerTabColor');
    await page.locator('#bgColor').evaluate(el => el.click());
    const popup = page.locator('#linuxColorPicker');
    const hex = popup.locator('[data-color-hex]');
    await hex.fill('#ff0000');
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.color === '#ff0000');
    await popup.locator('[data-color-hue]').evaluate(el => { el.value = '180'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.color === '#00ffff');
    const track = await popup.locator('[data-color-hue]').evaluate(el => ({
      track: getComputedStyle(el).backgroundImage,
      thumb: getComputedStyle(el, '::-webkit-slider-thumb').backgroundColor,
      hue: el.style.getPropertyValue('--selected-hue'),
      overlay: getComputedStyle(document.querySelector('#linuxColorPicker')).backgroundColor,
    }));
    assert.match(track.track, /linear-gradient/);
    assert.equal(track.hue, '#00ffff');
    assert.equal(track.overlay, 'rgba(0, 0, 0, 0)');
    assert.equal(await popup.locator('[data-color-apply], [data-color-cancel]').count(), 0);
    const pick = popup.locator('[data-color-pick]');
    assert.equal(await pick.innerText(), '');
    assert.match(await pick.getAttribute('aria-label'), /canvas/i);
    const zoom = await page.locator('#zoom').inputValue();
    const before = await page.locator('#bgColor').inputValue();
    await pick.click();
    const box = await page.locator('#stage').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const lens = page.locator('#canvasColorMagnifier');
    await lens.waitFor({ state: 'visible' });
    assert.equal(await lens.locator('span').innerText(), '#00ffff');
    const center = await lens.locator('canvas').evaluate(el => Array.from(el.getContext('2d').getImageData(5, 5, 1, 1).data));
    assert.deepEqual(center, [0, 255, 255, 255]);
    assert.equal(await page.locator('#bgColor').inputValue(), before);
    assert.equal(await page.locator('#zoom').inputValue(), zoom);
    await fs.mkdir(path.resolve('out/linux-validation/live-color'), { recursive: true });
    await page.screenshot({ path: 'out/linux-validation/live-color/magnifier.png' });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await popup.waitFor({ state: 'visible' });
    assert.equal(await lens.isVisible(), false);
    const stats = await page.evaluate(() => window.SoapyPanels.debug.colorSampler.getState());
    assert.equal(stats.bufferWidth, 1);
    await page.screenshot({ path: 'out/linux-validation/live-color/picker.png' });
    await page.keyboard.press('Escape');
    assert.deepEqual(session.errors, []);
  } finally { await closeTestApp(session); }
});

test('Linux popup commits one undoable edit, saves/reopens it and samples large filtered artwork', { skip: process.platform !== 'linux', timeout: 90000 }, async () => {
  const session = await launchTestApp();
  const { page, profile, errors } = session;
  page.setDefaultTimeout(12000);
  try {
    await dismissStartupOverlays(page);
    await page.click('#footerTabColor');
    const popup = page.locator('#linuxColorPicker');
    const bg = page.locator('#bgColor');
    const before = await page.evaluate(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.color);
    await bg.evaluate(el => el.click());
    await popup.locator('[data-color-hex]').fill('#ff8800');
    await page.waitForTimeout(400);
    await popup.locator('[data-color-hex]').fill('#35a06c');
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.color === '#35a06c');
    await popup.locator('[data-color-close]').click();
    await page.waitForTimeout(400); // Existing history commits are debounced by 300 ms.
    await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
    await page.waitForFunction(color => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.color === color, before);
    await page.evaluate(() => window.SoapyPanels.debug.undo.redo());
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.color === '#35a06c');
    const destination = path.join(profile, 'sampled-color.soapy');
    await page.exposeFunction('writeColorProject', text => fs.writeFile(destination, text));
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => ({ name: 'sampled-color.soapy', queryPermission: async () => 'granted',
        createWritable: async () => ({ write: async blob => window.writeColorProject(await blob.text()), close: async () => {} }) });
      document.querySelector('#mi-save-as').click();
    });
    await page.waitForFunction(() => !window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges);
    assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).bg.color, '#35a06c');
    await bg.evaluate(el => el.click());
    // Merely reopening and closing must preserve the saved state.
    await popup.locator('[data-color-close]').click();
    assert.equal(await page.evaluate(() => window.SoapyPanels.debug.video.getProjectSafetyState().hasUnsavedChanges), false);
    await page.click('#menu-file');
    await page.click('#mi-new');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    const chooser = page.waitForEvent('filechooser');
    await page.click('#menu-file');
    await page.click('#mi-open');
    await (await chooser).setFiles(destination);
    await page.waitForFunction(() => window.SoapyPanels.debug.video.takeProjectSnapshot().bg.color === '#35a06c');

    await page.evaluate(async () => {
      const image = document.createElement('canvas'); image.width = image.height = 2;
      const ctx = image.getContext('2d'); ctx.fillStyle = '#35a06c'; ctx.fillRect(0, 0, 2, 2);
      await window.SoapyPanels.debug.effects.addDataUrlAsBackground(image.toDataURL(), {
        id: 'popup-large', reset: true, canvasWidth: 16000, canvasHeight: 12000, width: 16000, height: 12000,
      });
      const zoom = document.querySelector('#zoom'); zoom.value = '20'; zoom.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#scroller').scrollTo(350, 250);
      window.SoapyPanels.debug.effects.openEditor('popup-large');
      const mode = document.querySelector('#imageEffectMode'); mode.value = 'duotone'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#imageEffectsStatus').dataset.state === 'success');
    const effect = page.locator('#imageEffectDuotoneShadow');
    await effect.click();
    await popup.locator('[data-color-hex]').fill('#112233');
    await popup.locator('[data-color-close]').click();
    assert.equal(await effect.inputValue(), '#112233');
    // Switch back to original artwork while keeping an ordinary color target available.
    await page.locator('#btnImageEffectsClose').click();
    await page.evaluate(() => {
      window.SoapyPanels.debug.effects.openEditor('popup-large');
      const mode = document.querySelector('#imageEffectMode'); mode.value = 'none'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#btnImageEffectsClose').click();
    await page.locator('.color-gradient-button[data-gradient-target="bgColor"]').evaluate(el => el.click());
    const stop = page.locator('.gradient-stop input[type=color]').first();
    await stop.click();
    await popup.locator('[data-color-pick]').click();
    const point = await page.evaluate(() => {
      const stage = document.querySelector('#stage');
      const ctx = stage.getContext('2d'); ctx.save(); ctx.resetTransform(); ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, stage.width, stage.height); ctx.restore();
      const a = stage.getBoundingClientRect(), b = document.querySelector('#scroller').getBoundingClientRect();
      return { x: Math.max(a.left, b.left) + 40, y: Math.max(a.top, b.top) + 40 };
    });
    await page.mouse.click(point.x, point.y);
    await popup.waitFor({ state: 'visible' });
    assert.equal(await popup.locator('[data-color-hex]').inputValue(), '#35a06c');
    const stats = await page.evaluate(() => window.SoapyPanels.debug.colorSampler.getState());
    assert.equal(stats.width, stats.displayWidth);
    assert.ok(stats.width < stats.logicalWidth);
    await popup.locator('[data-color-close]').click();
    await page.locator('[data-gradient-cancel]').click();
    assert.deepEqual(errors, []);
  } finally { await closeTestApp(session); }
});
