const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const {
  launchTestApp,
  dismissStartupOverlays,
  closeTestApp,
} = require('../support/electron-app');
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() > deadline)
      assert.fail('Timed out waiting for export cleanup');
    await delay(25);
  }
}
test(
  'real IPC exports stay private and renderer navigation and destruction clean staging',
  { timeout: 90000 },
  async () => {
    const session = await launchTestApp();
    try {
      const { app, page, profile } = session;
      const root = path.join(profile, 'export-staging');
      const destination = path.join(profile, 'private.mp4');
      await dismissStartupOverlays(page);
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, destination);
      async function begin() {
        const result = await page.evaluate(async () => {
          const api = window.electronApi;
          const target = await api.showExportSaveDialog({
            mime: 'video/mp4',
            suggestedName: 'selected.mp4',
            extensions: ['mp4'],
          });
          const stream = await api.beginExportStream(target.targetId);
          if (!stream.ok) throw new Error(stream.error);
          const write = await api.writeExportStreamChunk(
            stream.sessionId,
            0,
            new TextEncoder().encode('private').buffer,
          );
          if (!write.ok) throw new Error(write.error);
          return stream.sessionId;
        });
        const runs = await fs.readdir(root);
        const file = path.join(root, runs[0], result + '.tmp');
        assert.equal(await fs.readFile(file, 'utf8'), 'private');
        if (process.platform !== 'win32') {
          assert.equal((await fs.stat(root)).mode & 0o777, 0o700);
          assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
          assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
        }
        return { id: result, file };
      }
      async function gone(file) {
        await until(async () => {
          try {
            await fs.stat(file);
            return false;
          } catch (e) {
            if (e.code === 'ENOENT') return true;
            throw e;
          }
        });
      }
      let stream = await begin();
      assert.equal(
        (
          await page.evaluate(
            (id) => window.electronApi.finishExportStream(id),
            stream.id,
          )
        ).ok,
        true,
      );
      await gone(stream.file);
      assert.equal(await fs.readFile(destination, 'utf8'), 'private');
      if (process.platform !== 'win32')
        assert.equal((await fs.stat(destination)).mode & 0o777, 0o600);
      stream = await begin();
      await page.reload();
      await gone(stream.file);
      await page.waitForFunction(() => !!window.electronApi);
      stream = await begin();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].destroy(),
      );
      await gone(stream.file);
      await until(async () => (await fs.readdir(root)).length === 0);
    } finally {
      await closeTestApp(session);
    }
  },
);

test(
  'a crashed renderer releases its pending export without waiting for window destruction',
  { timeout: 60000 },
  async () => {
    const session = await launchTestApp();
    try {
      await session.app.evaluate(
        ({ dialog }, filePath) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        },
        path.join(session.profile, 'crash.mp4'),
      );
      const id = await session.page.evaluate(async () => {
        const api = window.electronApi;
        const target = await api.showExportSaveDialog({ mime: 'video/mp4' });
        const stream = await api.beginExportStream(target.targetId);
        if (!stream.ok) throw new Error(stream.error);
        await api.writeExportStreamChunk(
          stream.sessionId,
          0,
          new Uint8Array([1, 2, 3]).buffer,
        );
        return stream.sessionId;
      });
      const root = path.join(session.profile, 'export-staging');
      const run = (await fs.readdir(root))[0];
      const file = path.join(root, run, id + '.tmp');
      assert.equal((await fs.stat(file)).size, 3);
      const crashed = session.page.waitForEvent('crash');
      await session.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(),
      );
      await crashed;
      await until(async () => {
        try {
          await fs.stat(file);
          return false;
        } catch (error) {
          if (error.code === 'ENOENT') return true;
          throw error;
        }
      });
      assert.equal(
        await session.app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
        1,
      );
    } finally {
      await closeTestApp(session);
    }
  },
);
