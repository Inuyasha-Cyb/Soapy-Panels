const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { _electron: electron } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");

function electronEnvironment() {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

async function activateSampler(page, inputId) {
  await page.locator(`[data-canvas-sampler-for="${inputId}"]`).dispatchEvent("pointerdown", {
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  await page.waitForFunction(() => document.body.classList.contains("gradient-canvas-sampling"));
}

async function sampleStageCenter(page) {
  const box = await page.locator("#stage").boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, "the canvas should be visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("gradient samplers isolate targets, exclude ordinary controls, and recover safely", { timeout: 90000 }, async () => {
  const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), "soapy-panels-color-picker-"));
  let app;
  try {
    app = await electron.launch({
      args: [repoRoot, `--user-data-dir=${profilePath}`,
        ...(process.env.SOAPY_TEST_OZONE_PLATFORM ? [`--ozone-platform=${process.env.SOAPY_TEST_OZONE_PLATFORM}`] : [])],
      env: electronEnvironment(),
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("crash", () => pageErrors.push("renderer crashed"));

    await page.waitForFunction(() => window.SoapyPanels && window.SoapyPanels.debug && window.SoapyPanels.debug.video);
    await page.locator('[data-locale-option="en"]').click();
    await page.evaluate(() => window.SoapyPanels.debug.video.setCanvasBackground("#123456", 1));
    await page.waitForTimeout(50);

    await page.evaluate(() => {
      window.colorSwatchClicks = [];
      document.addEventListener("click", (event) => {
        if (event.target.matches('input[type="color"]')) {
          window.colorSwatchClicks.push(event.target.id);
          event.preventDefault(); // Record native-picker activation without opening an OS dialog.
        }
      }, true);
    });
    assert.equal(await page.locator('.canvas-color-sampler-button:not(#gradientOverlay *)').count(), 0);
    await page.evaluate(() => document.querySelector('.color-gradient-button[data-gradient-target="bgColor"]').click());
    await page.waitForSelector('#gradientOverlay[aria-hidden="false"]');
    const inputs = page.locator('.gradient-stop input[type=color]');
    const firstId = await inputs.first().getAttribute('id');
    const secondId = await inputs.nth(1).getAttribute('id');
    const secondBefore = await inputs.nth(1).inputValue();
    assert.equal(await page.locator('#gradientOverlay .canvas-color-sampler-button').count(),
      await page.locator('#gradientOverlay input[type=color]').count());
    await activateSampler(page, firstId);
    await sampleStageCenter(page);
    assert.equal(await inputs.first().inputValue(), '#123456');
    assert.equal(await inputs.nth(1).inputValue(), secondBefore);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.canvasSamplerFor || document.activeElement?.outerHTML.slice(0, 300)), firstId);

    const button = page.locator(`[data-canvas-sampler-for="${firstId}"]`);
    for (const key of ['Enter', 'Space']) {
      await button.focus();
      await page.keyboard.press(key);
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
    }
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    // Assistive technology can activate using click alone.
    await button.dispatchEvent('click', { detail: 0 });
    await page.keyboard.press('Escape');
    for (const cancel of ['outside', 'right', 'leave']) {
      await activateSampler(page, firstId);
      if (cancel === 'outside') await page.mouse.click(5, 5);
      if (cancel === 'right') {
        const box = await page.locator('#stage').boundingBox();
        await page.mouse.click(box.x + 20, box.y + 20, { button: 'right' });
      }
      if (cancel === 'leave') await page.locator('#stage').dispatchEvent('pointerleave');
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#gradientOverlay[aria-hidden="false"]').count(), 1);
    }
    // A failed read must restore the editor and permit another successful pick.
    await page.evaluate(() => {
      window.originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function () { throw new Error('test read failure'); };
    });
    await activateSampler(page, secondId);
    await sampleStageCenter(page);
    assert.equal(await inputs.nth(1).inputValue(), secondBefore);
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => { CanvasRenderingContext2D.prototype.getImageData = window.originalGetImageData; });
    await activateSampler(page, secondId);
    await sampleStageCenter(page);
    assert.equal(await inputs.nth(1).inputValue(), '#123456');

    await activateSampler(page, firstId);
    await inputs.first().evaluate((input) => { input.disabled = true; });
    await page.waitForFunction(() => !window.SoapyPanels.debug.colorSampler.getState().activeInputId);
    assert.equal(await button.isDisabled(), true);
    await inputs.first().evaluate((input) => { input.disabled = false; });
    await activateSampler(page, firstId);
    await page.locator('[data-gradient-add-stop]').evaluate((button) => button.click());
    await page.waitForFunction(() => !window.SoapyPanels.debug.colorSampler.getState().activeInputId);
    assert.equal(await inputs.count(), 3);
    assert.equal(await page.locator('.gradient-stop .canvas-color-sampler-button').count(), 3);
    await page.locator('[data-gradient-apply]').click();
    assert.equal(await page.locator('#gradientOverlay').getAttribute('aria-hidden'), 'true');

    await page.evaluate(() => window.SoapyPanels.debug.video.setCanvasBackground('#123456', 1));
    await page.click('#addBubbleToggle');
    await page.click('.add-bubble-option[data-bubble-type="speech"]');
    await page.locator('#btnTextOutlineToggle').evaluate((button) => button.click());
    await page.evaluate(() => document.querySelector('.color-gradient-button[data-gradient-target="propTextStroke"]').click());
    await page.locator('[data-gradient-mode="double"]').click();
    for (const id of ['gradientDoubleInner', 'gradientDoubleOuter']) {
      await activateSampler(page, id);
      const box = await page.locator('#stage').boundingBox();
      await page.mouse.click(box.x + 10, box.y + 10);
      assert.equal(await page.locator(`#${id}`).inputValue(), '#123456');
    }
    await activateSampler(page, 'gradientDoubleInner');
    await page.locator('[data-gradient-cancel]').evaluate((button) => button.click());
    assert.equal(await page.locator('body').evaluate((body) => body.classList.contains('gradient-canvas-sampling')), false);
    assert.deepEqual(await page.evaluate(() => window.colorSwatchClicks), []);
    await page.locator('#bgColor').dispatchEvent('click');
    assert.deepEqual(await page.evaluate(() => window.colorSwatchClicks), ['bgColor']);
    // A large image layer exercises scaling and final artwork rendering.
    await page.evaluate(async () => {
      const image = document.createElement('canvas');
      image.width = image.height = 2;
      const ctx = image.getContext('2d');
      ctx.fillStyle = '#35a06c';
      ctx.fillRect(0, 0, 2, 2);
      await window.SoapyPanels.debug.effects.addDataUrlAsBackground(image.toDataURL(), {
        id: 'sampler-large', reset: true, canvasWidth: 16000, canvasHeight: 12000,
        width: 16000, height: 12000,
      });
      document.querySelector('.color-gradient-button[data-gradient-target="bgColor"]').click();
    });
    const largeInput = page.locator('.gradient-stop input[type=color]').first();
    const largeId = await largeInput.getAttribute('id');
    for (let i = 0; i < 3; i++) {
      await activateSampler(page, largeId);
      // Simulate editor markings on the display canvas: these must not enter the pick.
      await page.evaluate(() => {
        const canvas = document.querySelector('#stage');
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.resetTransform();
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      });
      const point = await page.evaluate(() => {
        const stage = document.querySelector('#stage').getBoundingClientRect();
        const viewport = document.querySelector('#scroller').getBoundingClientRect();
        return { x: Math.max(stage.left, viewport.left) + 40, y: Math.max(stage.top, viewport.top) + 40 };
      });
      await page.mouse.click(point.x, point.y);
      assert.equal(await largeInput.inputValue(), '#35a06c');
      const stats = await page.evaluate(() => window.SoapyPanels.debug.colorSampler.getState());
      assert.equal(stats.width, stats.displayWidth);
      assert.equal(stats.height, stats.displayHeight);
      assert.ok(stats.width < stats.logicalWidth);
    }
    await largeInput.dispatchEvent('click');
    assert.equal(await page.locator('#gradientOverlay').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('body').evaluate((body) => body.classList.contains('gradient-canvas-sampling')), false);
    await page.locator('[data-gradient-cancel]').click();
    assert.deepEqual(pageErrors, []);
  } finally {
    if (app) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()));
      await app.close();
    }
    await fs.rm(profilePath, { recursive: true, force: true });
  }
});
