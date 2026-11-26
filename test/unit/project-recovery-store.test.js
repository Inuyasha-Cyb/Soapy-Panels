const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  createRecoveryStore,
} = require('../../app/main/project-recovery-store');
const data = (revision) => ({
  version: 1,
  generation: 0,
  revision,
  name: 'Test',
  excludedVideoCount: 0,
  project: {
    bg: { w: 1280, h: 720, images: [] },
    bubbles: [],
    savedStyles: [],
  },
});
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createRecoveryStore(dir, options);
  return { dir, store, id: await store.start(1) };
}
test('two generations survive restart; corrupt latest and partial temp fall back', async (t) => {
  const { dir, store, id } = await fixture(t);
  for (let revision = 1; revision <= 3; revision++)
    await store.write(1, id, data(revision));
  const files = (await fs.readdir(path.join(dir, id))).filter((n) =>
    n.startsWith('snapshot-'),
  );
  assert.equal(files.length, 2);
  await fs.writeFile(path.join(dir, id, 'snapshot-0-3.json'), '{bad');
  await fs.writeFile(path.join(dir, id, 'unfinished.tmp'), '{');
  await store.releaseRenderer(1);
  const next = createRecoveryStore(dir);
  assert.equal((await next.list()).sessions.length, 1);
  await next.claim(2, id);
  assert.equal((await next.read(2, id)).revision, 2);
});
test('live sessions cannot be claimed; only one concurrent claimant wins', async (t) => {
  const { dir, store, id } = await fixture(t);
  await store.write(1, id, data(1));
  const a = createRecoveryStore(dir),
    b = createRecoveryStore(dir);
  await assert.rejects(a.claim(2, id), /active/);
  await store.releaseRenderer(1);
  const results = await Promise.allSettled([a.claim(2, id), b.claim(3, id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});
test('save floor rejects stale writes without deleting newer edits', async (t) => {
  const { store, id } = await fixture(t);
  await store.write(1, id, data(3));
  await store.clearThrough(1, id, { generation: 0, revision: 2 });
  assert.equal((await store.read(1, id)).revision, 3);
  assert.equal(await store.write(1, id, data(2)), false);
  await store.clearThrough(1, id, { generation: 0, revision: 3 });
  await assert.rejects(store.read(1, id), /No valid/);
});
test('discard fences queued writes and cannot recreate a deleted session', async (t) => {
  const { dir, store, id } = await fixture(t);
  const pending = store.write(1, id, data(1));
  const result = store.discard(1, id);
  await Promise.allSettled([pending, result]);
  await assert.rejects(fs.stat(path.join(dir, id)), { code: 'ENOENT' });
  assert.throws(() => store.write(1, id, data(2)), /owned/);
});
test('ownership, identifiers, oversized data and temporary media are rejected', async (t) => {
  const { store, id } = await fixture(t, { maxBytes: 400 });
  assert.throws(() => store.write(2, id, data(1)), /owned/);
  await assert.rejects(store.claim(1, '../elsewhere'), /identifier/);
  const large = data(1);
  large.project.notes = 'x'.repeat(500);
  await assert.rejects(store.write(1, id, large), /size limit/);
  const blob = data(1);
  blob.project.bg.images.push({ src: 'blob:temporary' });
  await assert.rejects(store.write(1, id, blob), /embedded/);
});
test('disk failure preserves the previous durable snapshot', async (t) => {
  let fail = false;
  const io = {
    ...fs,
    rename: async (...args) => {
      if (fail) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return fs.rename(...args);
    },
  };
  const { store, id } = await fixture(t, { fs: io });
  await store.write(1, id, data(1));
  fail = true;
  await assert.rejects(store.write(1, id, data(2)), /disk full/);
  assert.equal((await store.read(1, id)).revision, 1);
});

test('retry after publication is idempotent and retains the previous generation', async (t) => {
  const { dir, store, id } = await fixture(t);
  await store.write(1, id, data(1));
  await store.write(1, id, data(2));
  assert.equal(await store.write(1, id, data(2)), true);
  assert.equal(
    (await fs.readdir(path.join(dir, id))).filter((name) =>
      name.startsWith('snapshot-'),
    ).length,
    2,
  );
  const conflict = data(2);
  conflict.project.bg.w = 800;
  await assert.rejects(store.write(1, id, conflict), /Conflicting/);
});
