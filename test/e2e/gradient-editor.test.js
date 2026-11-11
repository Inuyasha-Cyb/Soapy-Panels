const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchTestApp, dismissStartupOverlays, closeTestApp } = require('../support/electron-app');
async function openGradient(page, target = 'propTextFill') {
  await page.evaluate((target) => {
    if (target !== 'bgColor') {
      const bubbles = window.SoapyPanels.debug.undo.captureState().bubbles;
      if (bubbles.length) window.SoapyPanels.debug.undo.selectBubble(bubbles[0].id);
    }
    const toggleId = target === 'propTextShadowColor' ? 'btnTextShadowToggle'
      : target === 'propTextHighlight' ? 'btnTextHighlightToggle'
      : target.startsWith('propBubble') ? 'btnBubbleShadowToggle' : null;
    if (toggleId) {
      const toggle = document.getElementById(toggleId);
      if (toggle.getAttribute('aria-pressed') === 'false') toggle.click();
    }
    if (target === 'propBubbleInnerShadowColor' || target === 'propBubbleTailShadowColor') {
      document.querySelector('#shadowStyleMenu [data-value="combined"]').click();
      const manual = document.querySelector('#btnTailShadowManual');
      if (target === 'propBubbleTailShadowColor' && manual.getAttribute('aria-pressed') === 'false') manual.click();
    }
    const button = document.querySelector(`[data-gradient-target="${target}"]`);
    // These legacy bindings remain supported, but the current UI uses a unified shadow control.
    if (target === 'propBubbleInnerShadowColor' || target === 'propBubbleTailShadowColor') button.disabled = false;
    button.focus();
    button.click();
  }, target);
  await page.locator('#gradientOverlay:not([hidden])').waitFor({ timeout: 5000 }).catch(() => { throw new Error('Gradient editor did not open for ' + target); });
}
async function value(page, selector, next) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, next);
}
const snapshot = (page) => page.evaluate(() => {
  const bubble = window.SoapyPanels.debug.undo.captureState().selectedBubble;
  // The renderer lazily populates these two default fields on an otherwise unchanged bubble.
  return { ...bubble, strokeGradient: bubble.strokeGradient ?? null, textVertical: !!bubble.textVertical };
});
async function setup() {
  const s = await launchTestApp();
  await dismissStartupOverlays(s.page);
  await s.page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
  await s.page.evaluate(() => { document.querySelector('.add-bubble-option[data-bubble-type="speech"]').click(); document.querySelector('#btnTextOutlineToggle').click(); });
  return s;
}
test('gradient drafts, stable stops, numeric controls, focus, and undo remain consistent', { timeout: 90000 }, async () => {
  let s;
  try {
    s = await setup(); const { page } = s;
    await openGradient(page);
    await page.waitForTimeout(100);
    const before = await snapshot(page);
    assert.equal(await page.locator('[data-gradient-title]').textContent(), 'Text Fill Gradient');
    await page.locator('[data-gradient-apply]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-gradient-close]').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('[data-gradient-apply]').evaluate(el => el === document.activeElement), true);
    await value(page, '[data-gradient-range="angle"]', 123);
    assert.equal(await page.locator('#gradientAngle').inputValue(), '123');
    await page.locator('#gradientAngle').fill('');
    assert.equal(await page.locator('#gradientAngle').inputValue(), '');
    await page.locator('[data-gradient-title]').click();
    assert.equal(await page.locator('#gradientAngle').inputValue(), '123');
    await page.locator('#gradientAngle').fill('999');
    await page.locator('[data-gradient-title]').click();
    assert.equal(await page.locator('#gradientAngle').inputValue(), '279');
    const add = page.locator('[data-gradient-add-stop]');
    await add.click(); await add.click(); await add.click();
    assert.equal(await add.isDisabled(), true);
    assert.equal(await page.locator('[data-gradient-limit]').isVisible(), true);
    assert.equal(await page.locator('.gradient-stop-remove:disabled').count(), 2);
    const moving = page.locator('.gradient-stop').nth(1).locator('[data-gradient-field="position"]');
    await moving.focus();
    await moving.evaluate(input => { window.gradientTestStop = input.closest('.gradient-stop')._gradientStop; });
    await moving.fill('90');
    assert.equal(await moving.inputValue(), '90');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => Number(document.querySelectorAll('.gradient-stop [type=number]')[3].value) === 90);
    assert.equal(await page.evaluate(() => document.activeElement.closest('.gradient-stop')._gradientStop === window.gradientTestStop), true);
    assert.deepEqual(await page.locator('.gradient-stop [type="number"]').evaluateAll(inputs => inputs.map(i => Number(i.value))), [0, 25, 50, 90, 100]);
    await page.locator('.gradient-stop-remove:not(:disabled)').first().click();
    assert.equal(await add.isDisabled(), false);
    await page.locator('[data-gradient-mode="radial"]').click();
    await value(page, '[data-gradient-range="centerX"]', 30);
    await value(page, '[data-gradient-range="radius"]', 145);
    assert.equal(await page.locator('#gradientCenterX').inputValue(), '30');
    assert.equal(await page.locator('#gradientRadius').inputValue(), '145');
    await page.locator('[data-gradient-cancel]').click();
    assert.deepEqual(await snapshot(page), before);
    await openGradient(page);
    await value(page, '[data-gradient-range="angle"]', 45);
    await page.locator('[data-gradient-apply]').click();
    await page.waitForTimeout(250);
    const applied = await snapshot(page);
    assert.equal(applied.textFillGradient.angle, 45);
    await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
    await page.waitForTimeout(150);
    assert.deepEqual((await snapshot(page)).textFillGradient, before.textFillGradient);
    await page.evaluate(() => window.SoapyPanels.debug.undo.redo());
    await page.waitForTimeout(150);
    assert.deepEqual((await snapshot(page)).textFillGradient, applied.textFillGradient);
    // Round-trip through the real project loader, not just the in-memory draft.
    await page.evaluate(() => {
      const project = window.SoapyPanels.debug.video.takeProjectSnapshot();
      window.showOpenFilePicker = async () => [{ getFile: async () =>
        new File([JSON.stringify(project)], 'gradient.soapy', { type: 'application/json' }) }];
      document.querySelector('#mi-open').click();
    });
    await page.locator('#projectSafetyOverlay:not([hidden])').waitFor();
    await page.locator('[data-project-safety-continue]').click();
    await page.waitForFunction(() => !document.querySelector('#projectSafetyOverlay:not([hidden])'));
    await openGradient(page);
    assert.equal(await page.locator('#gradientAngle').inputValue(), '45');
    await page.locator('[data-gradient-clear]').click();
    await page.waitForTimeout(250);
    assert.equal((await snapshot(page)).textFillGradient == null, true);
    await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
    await page.waitForTimeout(150);
    assert.deepEqual((await snapshot(page)).textFillGradient, applied.textFillGradient);
    await page.locator('#menu-view').focus();
    await openGradient(page, 'propTextStroke');
    await page.locator('[data-gradient-mode="double"]').click();
    assert.equal(await page.locator('[data-gradient-stop-section]').isVisible(), false);
    await value(page, '[data-gradient-range="doubleSplit"]', 35);
    assert.equal(await page.locator('#gradientDoubleSplit').inputValue(), '35');
    assert.equal(await page.locator('#gradientDoubleSplitOuter').textContent(), '65%');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#gradientOverlay').isVisible(), false);
    // A dock can invoke a hidden legacy control; return focus to its visible initiator.
    assert.equal(await page.locator('#menu-view').evaluate(el => el === document.activeElement), true);
    assert.deepEqual(s.errors, []);
  } finally { await closeTestApp(s); }
});

test('gradient layout fits all themes, targets, locales and constrained viewports', { timeout: 90000 }, async () => {
  let s;
  try {
    s = await setup(); const { page } = s;
    const artifacts = process.env.SOAPY_GRADIENT_SCREENSHOTS;
    if (artifacts) await fs.mkdir(artifacts, { recursive: true });
    async function shot(name) {
      if (artifacts) await page.locator('#gradientOverlay .gradient-dialog').screenshot({ path: path.join(artifacts, name + '.png') });
    }
    async function fits() {
      const result = await page.evaluate(() => {
        const dialog = document.querySelector('#gradientOverlay .gradient-dialog');
        const body = dialog.querySelector('.gradient-body');
        const footer = dialog.querySelector('.gradient-dialog-footer').getBoundingClientRect();
        const bounds = dialog.getBoundingClientRect();
        return { overflow: body.scrollWidth > body.clientWidth + 1, fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, footer: footer.bottom <= innerHeight };
      });
      assert.deepEqual(result, { overflow: false, fits: true, footer: true });
    }
    for (const theme of ['light','dark','studio','graphite','dark-orange','sakura','forest','amethyst']) {
      await page.evaluate(() => document.querySelector('#mi-theme-chooser').click());
      await page.locator(`[data-theme-option="${theme}"]`).click();
      await page.keyboard.press('Escape');
      await openGradient(page);
      await fits(); await shot(theme);
      await page.locator('[data-gradient-cancel]').click();
    }
    for (const target of ['propFill','propStroke','propTextShadowColor','propTextHighlight','propBubbleShadowColor','propBubbleInnerShadowColor','propBubbleTailShadowColor','bgColor']) {
      await openGradient(page, target); await fits(); await shot(target);
      await page.locator('[data-gradient-mode="radial"]').click(); await fits();
      if (target === 'bgColor') await shot('radial');
      await page.locator('[data-gradient-cancel]').click();
    }
    await openGradient(page, 'propTextStroke');
    await page.locator('[data-gradient-mode="double"]').click(); await shot('double');
    await page.locator('[data-gradient-cancel]').click();
    for (const locale of ['en','es','de','fr','id','ja','ru','uk','zh-hans']) {
      await page.evaluate(locale => window.SoapyPanels.i18n.setLocale(locale), locale);
      await openGradient(page); await fits();
      assert.equal((await page.locator('[data-gradient-title]').textContent()).startsWith('gradient.'), false);
      await page.locator('[data-gradient-cancel]').click();
    }
    await page.evaluate(() => window.SoapyPanels.i18n.setLocale('en'));
    for (const [width, height] of [[800,600],[390,700],[360,500]]) {
      await page.setViewportSize({ width, height });
      await openGradient(page); await page.locator('[data-gradient-add-stop]').click(); await fits(); await shot(`${width}x${height}`);
      await page.locator('[data-gradient-mode="radial"]').click(); await fits();
      await page.locator('[data-gradient-cancel]').click();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await s.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getType() === 'window').setZoomFactor(1.5));
    await openGradient(page); await fits(); await shot('zoom150');
    assert.deepEqual(s.errors, []);
  } finally { await closeTestApp(s); }
});

test('real stop edits preserve Tab order, pointer actions, slider identity and focus at the limit', { timeout: 90000 }, async () => {
  let s;
  try {
    s = await setup(); const { page } = s;
    await openGradient(page);
    const add = page.locator('[data-gradient-add-stop]');
    await add.click(); await add.click();
    await page.locator('.gradient-stop').nth(1).evaluate(row => { row.dataset.reviewStop = 'moving'; window.reviewStop = row._gradientStop; });
    const row = page.locator('[data-review-stop="moving"]');
    const number = row.locator('[type=number]');
    await number.click(); await number.press('ControlOrMeta+A'); await number.pressSequentially('75');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.querySelectorAll('.gradient-stop')[2]._gradientStop === window.reviewStop);
    assert.equal(await row.locator('[type=range]').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await number.evaluate(el => el === document.activeElement), true);
    await number.press('ControlOrMeta+A'); await number.pressSequentially('10');
    await row.locator('.gradient-stop-remove').click();
    assert.equal(await row.count(), 0);
    assert.equal(await page.locator('.gradient-stop').count(), 3);
    assert.equal(await page.locator('.gradient-stop').nth(1).locator('[type=color]').evaluate(el => el === document.activeElement), true);
    await add.click();
    await page.locator('.gradient-stop').nth(1).evaluate(el => { el.dataset.reviewStop = 'drag'; window.reviewStop = el._gradientStop; });
    const slider = page.locator('[data-review-stop="drag"] [type=range]');
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width * .25, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .85, box.y + box.height / 2, { steps: 8 });
    assert.equal(await page.locator('.gradient-stop').nth(1).getAttribute('data-review-stop'), 'drag', 'do not move rows while dragging');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('.gradient-stop')[2]._gradientStop === window.reviewStop);
    assert.equal(await slider.evaluate(el => el === document.activeElement), true);
    const dragged = Number(await slider.inputValue());
    await slider.press('ArrowLeft'); await slider.press('ArrowLeft'); await slider.press('ArrowLeft');
    assert.ok(Math.abs(Number(await slider.inputValue()) - (dragged - .3)) < .01);
    assert.equal(await slider.evaluate(el => el === document.activeElement), true);
    await add.click();
    assert.equal(await add.isDisabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement.matches('.gradient-stop input[type=color]')), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('#gradientOverlay')), true);
    while (await page.locator('.gradient-stop-remove:not(:disabled)').count()) {
      await page.locator('.gradient-stop-remove:not(:disabled)').first().click();
    }
    assert.equal(await add.evaluate(el => el === document.activeElement), true);
    assert.equal(await add.isDisabled(), false);
    assert.equal(await page.locator('.gradient-stop').count(), 2);
    assert.deepEqual(s.errors, []);
  } finally { await closeTestApp(s); }
});

test('gradient styles do not change the text editor or style-code dialog', { timeout: 90000 }, async () => {
  let s;
  try {
    s = await setup(); const { page } = s;
    async function compare(selector) {
      const dialog = page.locator(selector);
      await dialog.waitFor();
      // Focus a noneditable element to keep screenshots free of a blinking caret.
      await dialog.focus();
      await page.waitForTimeout(100);
      const before = await dialog.screenshot();
      async function layout() {
        return dialog.evaluate(el => [el, ...el.querySelectorAll('*')].map(node => {
          const style = getComputedStyle(node);
          return { bounds: node.getBoundingClientRect().toJSON(), display: style.display,
            padding: style.padding, gap: style.gap, color: style.color, background: style.background,
            font: style.font, border: style.border, overflow: style.overflow };
        }));
      }
      const original = await layout();
      const removed = await page.evaluate(() => {
        window.reviewGradientRules = [];
        for (const sheet of document.styleSheets) {
          let rules; try { rules = sheet.cssRules; } catch { continue; }
          for (let i = rules.length - 1; i >= 0; i--) {
            if (rules[i].cssText.includes('#gradientOverlay')) {
              window.reviewGradientRules.push({ sheet, index: i, text: rules[i].cssText });
              sheet.deleteRule(i);
            }
          }
        }
        return window.reviewGradientRules.length;
      });
      assert.ok(removed > 0);
      assert.deepEqual(await layout(), original);
      assert.deepEqual(await dialog.screenshot(), before);
      await page.evaluate(() => {
        for (const rule of window.reviewGradientRules.reverse()) rule.sheet.insertRule(rule.text, rule.index);
        delete window.reviewGradientRules;
      });
    }
    await page.evaluate(() => document.querySelector('#btnOpenTextEditor').click());
    await compare('#textEditorDialog');
    const originalText = (await snapshot(page)).text;
    await page.locator('#textEditorInput').fill('Review draft');
    await page.locator('#btnTextEditorCancel').click();
    assert.equal((await snapshot(page)).text, originalText);
    await page.evaluate(() => document.querySelector('#btnOpenTextEditor').click());
    await page.locator('#textEditorInput').fill('Review saved');
    await page.locator('#btnTextEditorSave').click();
    assert.equal((await snapshot(page)).text, 'Review saved');
    await page.evaluate(() => document.querySelector('#btnImportStyleCode').click());
    await compare('#styleCodeOverlay .gradient-dialog');
    await page.locator('#styleCodeText').fill('invalid-style-code');
    await page.locator('#btnStyleCodeApply').click();
    assert.equal(await page.locator('#styleCodeError').isVisible(), true);
    await page.locator('[data-style-code-close]').click();
    assert.equal(await page.locator('#styleCodeOverlay').isVisible(), false);
    assert.deepEqual(s.errors, []);
  } finally { await closeTestApp(s); }
});
