const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  launchTestApp,
  dismissStartupOverlays,
  closeTestApp,
} = require('../support/electron-app');
const { gif, dataUrl } = require('../support/gif-security');
const emptyProject = {
  bg: { w: 128, h: 128, images: [], color: '#ffffff' },
  bubbles: [],
  savedStyles: [],
};
async function ready(session) {
  await dismissStartupOverlays(session.page);
  await session.page.evaluate(() => window.SoapyPanels.debug.recovery.ready());
}
async function resourceUsage(page) {
  await page.waitForFunction(
    () => window.SoapyPanels.media.gif.getResourceUsage().activeDecoders === 0,
  );
  return page.evaluate(() => window.SoapyPanels.media.gif.getResourceUsage());
}
async function interceptImages(page) {
  await page.evaluate(() => {
    window.__nativeImageSources = [];
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'src',
    );
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value) {
        window.__nativeImageSources.push(value);
        descriptor.set.call(this, value);
      },
    });
  });
}

test(
  'mixed imports reject the tiny bomb, accept disguised GIFs, and never invoke native GIF decoding',
  { timeout: 60000 },
  async () => {
    let session;
    try {
      session = await launchTestApp();
      await ready(session);
      const { page } = session;
      await page.evaluate(() => {
        window.__gifAlerts = [];
        window.alert = (message) => window.__gifAlerts.push(message);
      });
      await interceptImages(page);
      await page.locator('#fileImage').setInputFiles([
        {
          name: 'bad.png',
          mimeType: 'image/png',
          buffer: gif({ width: 8192, height: 8192, frames: 30 }),
        },
        { name: 'good.png', mimeType: 'image/png', buffer: gif() },
      ]);
      await page.waitForFunction(() => window.__gifAlerts.length === 1);
      const message = await page.evaluate(() => window.__gifAlerts[0]);
      await page.waitForFunction(
        () => window.SoapyPanels.debug.gif.getEntries().length === 1,
      );
      await resourceUsage(page);
      assert.equal(
        (
          await page.evaluate(() => window.SoapyPanels.debug.gif.getEntries())
        )[0].runtimeFrameCount,
        2,
      );
      assert.match(message, /bad.png.*4,096/);
      assert.equal(
        await page.evaluate(
          () =>
            window.__nativeImageSources.filter((src) =>
              /^(blob:|data:)/.test(src),
            ).length,
        ),
        0,
      );
      await page.evaluate(
        (project) => window.SoapyPanels.debug.gif.restoreProject(project),
        emptyProject,
      );
      assert.equal((await resourceUsage(page)).usedBytes, 0);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);

test(
  'blocked project GIFs preserve source and geometry through save/reopen and block every export',
  { timeout: 90000 },
  async () => {
    let session;
    try {
      session = await launchTestApp();
      await ready(session);
      const { page } = session;
      const source = dataUrl(
        gif({ width: 8192, height: 8192, frames: 30 }),
        'image/png',
      );
      const project = {
        ...emptyProject,
        bg: {
          ...emptyProject.bg,
          images: [
            {
              id: 'blocked',
              name: 'Blocked art',
              src: source,
              x: 7,
              y: 9,
              width: 80,
              height: 60,
              naturalWidth: 8192,
              naturalHeight: 8192,
              rot: 0.25,
              opacity: 0.7,
            },
            {
              id: 'valid',
              name: 'Valid art',
              src: dataUrl(gif()),
              x: 0,
              y: 0,
              width: 16,
              height: 16,
              naturalWidth: 2,
              naturalHeight: 2,
            },
          ],
        },
      };
      await interceptImages(page);
      await page.evaluate(
        (project) => window.SoapyPanels.debug.gif.restoreProject(project),
        project,
      );
      const entries = await page.evaluate(() =>
        window.SoapyPanels.debug.gif.getEntries(),
      );
      assert.equal(entries.length, 2);
      assert.match(
        entries.find((e) => e.id === 'blocked').decodeError,
        /4,096/,
      );
      assert.equal(entries.find((e) => e.id === 'valid').runtimeFrameCount, 2);
      for (const format of ['png', 'jpg', 'gif', 'mp4']) {
        const message = await page.evaluate(async (format) => {
          try {
            const debug = window.SoapyPanels.debug;
            if (format === 'gif') await debug.gif.exportDataUrl();
            else if (format === 'mp4') await debug.video.exportMp4DataUrl();
            else await debug.effects.exportImageDataUrl(format);
            return 'unexpected success';
          } catch (error) {
            return error.message;
          }
        }, format);
        assert.match(message, /Blocked art/, format);
      }
      await page.evaluate(() => {
        window.showSaveFilePicker = async () => ({
          name: 'blocked.soapy',
          queryPermission: async () => 'granted',
          createWritable: async () => ({
            write: async (blob) => {
              window.__savedProject = await blob.text();
            },
            close: async () => {},
          }),
        });
        document.querySelector('#mi-save-as').click();
      });
      await page.waitForFunction(
        () =>
          window.__savedProject && !document.querySelector('#mi-save').disabled,
      );
      const saved = await page.evaluate(() =>
        JSON.parse(window.__savedProject),
      );
      const blocked = saved.bg.images.find((e) => e.id === 'blocked');
      assert.equal(blocked.src, source);
      for (const key of [
        'x',
        'y',
        'width',
        'height',
        'naturalWidth',
        'naturalHeight',
        'rot',
        'opacity',
      ])
        assert.equal(blocked[key], project.bg.images[0][key], key);
      assert.equal('gifDecodeError' in blocked, false);
      await page.evaluate(
        (project) => window.SoapyPanels.debug.gif.restoreProject(project),
        saved,
      );
      assert.match(
        (
          await page.evaluate(() => window.SoapyPanels.debug.gif.getEntries())
        ).find((e) => e.id === 'blocked').decodeError,
        /4,096/,
      );
      assert.equal(
        await page.evaluate(() =>
          window.__nativeImageSources.some((src) =>
            src.startsWith('data:image/png;base64,R0lG'),
          ),
        ),
        false,
      );
      await page.evaluate(
        (project) => window.SoapyPanels.debug.gif.restoreProject(project),
        emptyProject,
      );
      assert.equal((await resourceUsage(page)).usedBytes, 0);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);

test(
  'GIF recovery preserves a blocked source and restores the remaining artwork',
  { timeout: 90000 },
  async () => {
    const profile = await fs.mkdtemp(
      path.join(os.tmpdir(), 'soapy-gif-recovery-'),
    );
    let session;
    const source = dataUrl(gif({ width: 8192, height: 8192, frames: 30 }));
    try {
      session = await launchTestApp({ profile });
      await ready(session);
      const project = {
        ...emptyProject,
        bg: {
          ...emptyProject.bg,
          images: [
            {
              id: 'blocked',
              src: source,
              name: 'Recovery GIF',
              x: 3,
              y: 4,
              width: 64,
              height: 64,
              naturalWidth: 8192,
              naturalHeight: 8192,
            },
            {
              id: 'valid',
              src: dataUrl(gif()),
              x: 0,
              y: 0,
              width: 2,
              height: 2,
              naturalWidth: 2,
              naturalHeight: 2,
            },
          ],
        },
      };
      await session.page.evaluate(
        (project) => window.SoapyPanels.debug.gif.restoreProject(project),
        project,
      );
      await session.page.evaluate(() => {
        document
          .querySelector('.add-bubble-option[data-bubble-type="speech"]')
          .click();
        return window.SoapyPanels.debug.recovery.flush();
      });
      const process = session.app.process();
      const ended = new Promise((resolve) => process.once('exit', resolve));
      process.kill('SIGKILL');
      await ended;
      session = null;
      session = await launchTestApp({ profile });
      await dismissStartupOverlays(session.page);
      await session.page.waitForSelector('#projectRecoveryDialog[open]');
      await session.page.click('[data-recovery-action="recover"]');
      await session.page.evaluate(() =>
        window.SoapyPanels.debug.recovery.ready(),
      );
      await session.page.waitForFunction(
        () => window.SoapyPanels.debug.gif.getEntries().length === 2,
      );
      const restored = await session.page.evaluate(() => ({
        project: window.SoapyPanels.debug.video.takeProjectSnapshot(),
        entries: window.SoapyPanels.debug.gif.getEntries(),
      }));
      assert.equal(
        restored.project.bg.images.find((e) => e.id === 'blocked').src,
        source,
      );
      assert.ok(restored.entries.find((e) => e.id === 'blocked').decodeError);
      assert.equal(
        restored.entries.find((e) => e.id === 'valid').runtimeFrameCount,
        2,
      );
      assert.equal(restored.project.bubbles.length, 1);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
      await fs.rm(profile, { recursive: true, force: true });
    }
  },
);

test(
  'shared-budget placeholders can retry; delete, undo and redo release and reacquire frames',
  { timeout: 60000 },
  async () => {
    let session;
    try {
      session = await launchTestApp();
      await ready(session);
      const { page } = session;
      await page.evaluate(() => {
        const media = window.SoapyPanels.media.gif,
          original = media.loadImage;
        media.loadImage = async function () {
          media.loadImage = original;
          throw media.policy.error('GIF_SHARED_LIMIT');
        };
      });
      const project = {
        ...emptyProject,
        bg: {
          ...emptyProject.bg,
          images: [
            {
              id: 'retry',
              src: dataUrl(gif()),
              name: 'Retry GIF',
              mediaKind: 'gif',
              width: 64,
              height: 64,
              naturalWidth: 2,
              naturalHeight: 2,
              x: 0,
              y: 0,
            },
          ],
        },
      };
      await page.evaluate(
        (project) => window.SoapyPanels.debug.gif.restoreProject(project),
        project,
      );
      assert.equal((await resourceUsage(page)).usedBytes, 0);
      await page.click('#bgImageCollapseToggle');
      await page
        .getByRole('button', { name: 'Retry loading GIF', exact: true })
        .click();
      await page.waitForFunction(
        () =>
          window.SoapyPanels.debug.gif.getEntries()[0]?.runtimeFrameCount === 2,
      );
      assert.equal((await resourceUsage(page)).usedBytes, 32);
      await page.evaluate(() =>
        document
          .querySelector(
            '[data-bg-image-id="retry"] [data-bg-image-action="remove"]',
          )
          .click(),
      );
      await page.waitForFunction(
        () => window.SoapyPanels.debug.gif.getEntries().length === 0,
      );
      assert.equal((await resourceUsage(page)).usedBytes, 0);
      await page.evaluate(() => window.SoapyPanels.debug.undo.undo());
      await page.waitForFunction(
        () =>
          window.SoapyPanels.debug.gif.getEntries()[0]?.runtimeFrameCount === 2,
      );
      assert.equal((await resourceUsage(page)).usedBytes, 32);
      await page.evaluate(() => window.SoapyPanels.debug.undo.redo());
      await page.waitForFunction(
        () => window.SoapyPanels.debug.gif.getEntries().length === 0,
      );
      assert.equal((await resourceUsage(page)).usedBytes, 0);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);

test(
  'an MP4 export retains GIF frames after layer deletion and releases them on completion',
  { timeout: 90000 },
  async () => {
    let session;
    try {
      session = await launchTestApp();
      await ready(session);
      const { page } = session;
      await page.evaluate(() => {
        const media = window.SoapyPanels.media.gif,
          original = media.loadImage;
        media.loadImage = async function (...args) {
          const image = await original.apply(this, args);
          if (image._soapyGifRuntime) {
            window.__exportGif = image._soapyGifRuntime;
            const retain = window.__exportGif.retain;
            window.__gifExportPins = 0;
            window.__exportGif.retain = function () {
              const release = retain();
              window.__gifExportPins++;
              let done = false;
              return () => {
                if (!done) {
                  done = true;
                  window.__gifExportPins--;
                  release();
                }
              };
            };
          }
          return image;
        };
      });
      const project = {
        ...emptyProject,
        bg: {
          ...emptyProject.bg,
          w: 640,
          h: 360,
          images: [
            {
              id: 'export-gif',
              src: dataUrl(gif({ frames: 20 })),
              name: 'Export GIF',
              mediaKind: 'gif',
              width: 640,
              height: 360,
              naturalWidth: 2,
              naturalHeight: 2,
              x: 0,
              y: 0,
            },
          ],
        },
      };
      await page.evaluate(
        (project) => window.SoapyPanels.debug.gif.restoreProject(project),
        project,
      );
      await page.click('#bgImageCollapseToggle');
      await page.evaluate(() => {
        window.__mp4Result = null;
        window.SoapyPanels.debug.video
          .exportMp4DataUrl({ quality: '720p' })
          .then(
            (value) => {
              window.__mp4Result = { ok: true, bytes: value.dataUrl.length };
            },
            (error) => {
              window.__mp4Result = { ok: false, error: error.message };
            },
          );
      });
      await page.waitForFunction(
        () => window.__gifExportPins > 0 || window.__mp4Result,
      );
      assert.equal(await page.evaluate(() => window.__gifExportPins), 1);
      await page.evaluate(() =>
        document
          .querySelector(
            '[data-bg-image-id="export-gif"] [data-bg-image-action="remove"]',
          )
          .click(),
      );
      assert.equal(
        await page.evaluate(() => window.__exportGif.frames.length),
        20,
      );
      await page.waitForFunction(() => window.__mp4Result, null, {
        timeout: 60000,
      });
      const result = await page.evaluate(() => window.__mp4Result);
      assert.equal(result.ok, true, result.error);
      assert.ok(result.bytes > 100);
      assert.equal(
        await page.evaluate(() => window.__exportGif.frames.length),
        0,
      );
      assert.equal((await resourceUsage(page)).usedBytes, 0);
      assert.deepEqual(session.errors, []);
    } finally {
      await closeTestApp(session);
    }
  },
);
