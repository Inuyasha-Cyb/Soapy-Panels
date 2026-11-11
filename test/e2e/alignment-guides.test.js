const test = require('node:test');
const assert = require('node:assert/strict');
const {
  launchTestApp,
  dismissStartupOverlays,
  closeTestApp,
} = require('../support/electron-app');
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 0.6, `${actual} != ${expected}`);
async function setup(overrides, options = {}) {
  const session = await launchTestApp();
  const { page } = session;
  await dismissStartupOverlays(page);
  await page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
  await page.evaluate((items) => {
    document
      .querySelector('.add-bubble-option[data-bubble-type="speech"]')
      .click();
    const template =
      window.SoapyPanels.debug.undo.captureState().selectedBubble;
    const project = window.SoapyPanels.debug.video.takeProjectSnapshot();
    project.bg.w = 800;
    project.bg.h = 500;
    project.bubbles = items.map((item) => {
      const b = JSON.parse(JSON.stringify(template));
      b.text = '';
      b.tail.enabled = false;
      b.mergedWith = [];
      return Object.assign(b, { w: 80, h: 60 }, item);
    });
    window.showOpenFilePicker = async () => [
      {
        getFile: async () =>
          new File([JSON.stringify(project)], 'alignment.soapy', {
            type: 'application/json',
          }),
      },
    ];
    document.querySelector('#mi-open').click();
  }, overrides);
  await page.locator('#projectSafetyOverlay:not([hidden])').waitFor();
  await page.click('[data-project-safety-continue]');
  await page.waitForFunction(() =>
    window.SoapyPanels.debug.undo
      .captureState()
      .bubbles.some((b) => b.id === 'm'),
  );
  await page.evaluate(() => {
    window.SoapyPanels.debug.undo.selectBubble('m');
    document.querySelector('[data-alignment-mode="snap"]').click();
  });
  if (options.canvas)
    await page.locator('#hitAnchors').evaluate((el) => {
      el.style.display = 'none';
    });
  await page
    .locator('#dropHint .drop-message .drop-close-button')
    .click({ force: true });
  await page.waitForTimeout(150);
  return session;
}
async function startDrag(page, x, y, dx, dy) {
  const p = await page.evaluate(
    ({ x, y, dx, dy }) => {
      const box = document
        .querySelector('#canvasInner')
        .getBoundingClientRect();
      return {
        x: box.x + (x * box.width) / 800,
        y: box.y + (y * box.height) / 500,
        endX: box.x + ((x + dx) * box.width) / 800,
        endY: box.y + ((y + dy) * box.height) / 500,
      };
    },
    { x, y, dx, dy },
  );
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.endX, p.endY, { steps: 5 });
}
async function positions(page) {
  return page.evaluate(() =>
    window.SoapyPanels.debug.undo
      .captureState()
      .bubbles.map((b) => ({ id: b.id, x: b.x, y: b.y })),
  );
}

test(
  'anchor drag snaps both axes, renders guides, bypasses on Ctrl and supports one-step undo/redo',
  { timeout: 60000 },
  async () => {
    let session;
    try {
      session = await setup([
        { id: 'm', x: 300, y: 230 },
        { id: 'a', x: 100, y: 80 },
      ]);
      const { page } = session;
      await startDrag(page, 350, 245, -196, -86);
      let moved = (await positions(page)).find((b) => b.id === 'm');
      near(moved.x, 100);
      near(moved.y, 140);
      await page.waitForFunction(
        () => document.querySelectorAll('#alignmentGuides line').length >= 2,
      );
      const preparations = await page.evaluate(
        () => window.SoapyPanels.debug.alignment.inspect().preparations,
      );
      await page.keyboard.down('Control');
      moved = (await positions(page)).find((b) => b.id === 'm');
      near(moved.x, 104);
      near(moved.y, 144);
      await page.keyboard.up('Control');
      moved = (await positions(page)).find((b) => b.id === 'm');
      near(moved.x, 100);
      near(moved.y, 140);
      assert.equal(
        await page.evaluate(
          () => window.SoapyPanels.debug.alignment.inspect().preparations,
        ),
        preparations,
      );
      const withGuides = await page.evaluate(async () => ({
        pixels: await window.SoapyPanels.debug.video.exportImageDataUrl('png'),
        project: JSON.stringify(
          window.SoapyPanels.debug.video.takeProjectSnapshot(),
        ),
      }));
      await page.mouse.up();
      assert.equal(await page.locator('#alignmentGuides line').count(), 0);
      const withoutGuides = await page.evaluate(async () => ({
        pixels: await window.SoapyPanels.debug.video.exportImageDataUrl('png'),
        project: JSON.stringify(
          window.SoapyPanels.debug.video.takeProjectSnapshot(),
        ),
      }));
      assert.deepEqual(withGuides, withoutGuides);
      await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
      await page.waitForFunction(
        () =>
          !window.SoapyPanels.debug.undo.captureState().historyRestoreActive,
      );
      moved = (await positions(page)).find((b) => b.id === 'm');
      near(moved.x, 300);
      near(moved.y, 230);
      await page.evaluate(() => window.SoapyPanels.debug.undo.redo());
      await page.waitForFunction(
        () =>
          !window.SoapyPanels.debug.undo.captureState().historyRestoreActive,
      );
      moved = (await positions(page)).find((b) => b.id === 'm');
      near(moved.x, 100);
      near(moved.y, 140);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);

test(
  'canvas drag shows equal-gap labels and guides-only mode leaves geometry unsnapped',
  { timeout: 60000 },
  async () => {
    let session;
    try {
      session = await setup(
        [
          { id: 'm', x: 240, y: 240, w: 40, h: 40 },
          { id: 'a', x: 100, y: 80, w: 80 },
          { id: 'b', x: 420, y: 80, w: 80 },
        ],
        { canvas: true },
      );
      const { page } = session;
      await startDrag(page, 260, 260, 36, -150); // midpoint left=280, raw=276
      let moved = (await positions(page)).find((b) => b.id === 'm');
      near(moved.x, 280);
      await page.waitForFunction(
        () => document.querySelectorAll('#alignmentGuides text').length === 2,
      );
      assert.match(
        await page.locator('#alignmentGuides').textContent(),
        /100 px/,
      );
      await page.mouse.up();
      await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
      await page.waitForFunction(
        () =>
          !window.SoapyPanels.debug.undo.captureState().historyRestoreActive,
      );
      await page.click('#menu-view');
      await page.click('#alignmentGuidesMenu summary');
      await page.click('[data-alignment-mode="guides"]');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('sp.alignmentGuides')),
        'guides',
      );
      await startDrag(page, 260, 260, 36, -150);
      moved = (await positions(page)).find((b) => b.id === 'm');
      near(moved.x, 276);
      await page.waitForFunction(
        () => document.querySelectorAll('#alignmentGuides text').length === 2,
      );
      await page.mouse.up();
      assert.equal(await page.locator('#alignmentGuides line').count(), 0);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);

test(
  'connected groups preserve member offsets through snapping',
  { timeout: 60000 },
  async () => {
    let session;
    try {
      session = await setup([
        { id: 'm', x: 300, y: 230, mergedWith: ['n'] },
        { id: 'n', x: 400, y: 230, mergedWith: ['m'] },
        { id: 'a', x: 100, y: 80 },
      ]);
      await startDrag(session.page, 350, 245, -196, -86);
      await session.page.mouse.up();
      const all = await positions(session.page),
        m = all.find((b) => b.id === 'm'),
        n = all.find((b) => b.id === 'n');
      near(m.x, 100);
      near(n.x - m.x, 100);
      near(n.y - m.y, 0);
      await session.page.evaluate(() => window.SoapyPanels.debug.undo.undo());
      await session.page.waitForFunction(
        () =>
          !window.SoapyPanels.debug.undo.captureState().historyRestoreActive,
      );
      let restored = await positions(session.page);
      near(restored.find((b) => b.id === 'm').x, 300);
      near(restored.find((b) => b.id === 'n').x, 400);
      await session.page.evaluate(() => window.SoapyPanels.debug.undo.redo());
      await session.page.waitForFunction(
        () =>
          !window.SoapyPanels.debug.undo.captureState().historyRestoreActive,
      );
      restored = await positions(session.page);
      near(restored.find((b) => b.id === 'm').x, 100);
      near(restored.find((b) => b.id === 'n').x, 200);

      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);

test(
  'pointer cancellation, lost capture, selection changes and blur clear guides',
  { timeout: 60000 },
  async () => {
    let session;
    try {
      session = await setup(
        [
          { id: 'm', x: 300, y: 230 },
          { id: 'a', x: 100, y: 80 },
        ],
        { canvas: true },
      );
      const { page } = session;
      for (const reason of [
        'pointercancel',
        'lostpointercapture',
        'selection',
        'blur',
      ]) {
        await page.evaluate(() =>
          window.SoapyPanels.debug.undo.selectBubble('m'),
        );
        await startDrag(page, 350, 245, -196, -86);
        await page.waitForFunction(
          () => document.querySelectorAll('#alignmentGuides line').length > 0,
        );
        await page.evaluate((reason) => {
          const state = window.SoapyPanels.debug.alignment.inspect();
          if (reason === 'selection')
            window.SoapyPanels.debug.undo.selectBubble('a');
          else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
          else
            document.querySelector('#stage').dispatchEvent(
              new PointerEvent(reason, {
                bubbles: true,
                pointerId: state.pointerId,
              }),
            );
        }, reason);
        await page.waitForFunction(
          () => document.querySelectorAll('#alignmentGuides line').length === 0,
        );
        await page.mouse.up();
        await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
        await page.waitForFunction(
          () =>
            !window.SoapyPanels.debug.undo.captureState().historyRestoreActive,
        );
      }
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);

test(
  'a dense 2,000-bubble document prepares targets once during real movement',
  { timeout: 60000 },
  async () => {
    let session;
    try {
      const items = Array.from({ length: 1999 }, (_, i) => ({
        id: `b${i}`,
        x: (i % 100) * 10,
        y: Math.floor(i / 100) * 10,
        w: 8,
        h: 8,
      }));
      items.push({ id: 'm', x: 300, y: 330, w: 80, h: 60 });
      session = await setup(items, { canvas: true });
      const { page } = session;
      const before = await page.evaluate(
        () => window.SoapyPanels.debug.alignment.inspect().preparations,
      );
      const started = Date.now();
      await startDrag(page, 350, 345, -96, -86);
      const state = await page.evaluate(() =>
        window.SoapyPanels.debug.alignment.inspect(),
      );
      assert.equal(state.active, true);
      assert.equal(state.preparations - before, 1);
      assert.ok(state.evaluations < 24000);
      assert.notEqual((await positions(page)).find((b) => b.id === 'm').x, 300);
      console.log(
        `Dense Electron drag: ${Date.now() - started}ms for pointer down and five movement steps; ${state.evaluations} candidate checks`,
      );
      await page.mouse.up();
      assert.equal(await page.locator('#alignmentGuides line').count(), 0);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);
