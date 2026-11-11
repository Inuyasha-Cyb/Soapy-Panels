const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const {
  createRecoveryStore,
  RECOVERY_LIMITS: L,
} = require('../../app/main/project-recovery-store');
const {
  boundedRead,
  createRecoveryCoordinator,
} = require('../../app/main/recovery-coordinator');
const data = (revision = 1) => ({
  generation: 0,
  revision,
  name: 'Test',
  excludedVideoCount: 0,
  project: { bg: { w: 100, h: 100, images: [] }, bubbles: [], savedStyles: [] },
});
const size = (value) =>
  Buffer.byteLength(
    JSON.stringify({
      version: 1,
      timestamp: '2000-01-01T00:00:00.000Z',
      name: value.name,
      generation: value.generation,
      revision: value.revision,
      excludedVideoCount: value.excludedVideoCount,
      project: value.project,
    }),
  );
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'soapy-recovery-limits-'),
  );
  const store = createRecoveryStore(root, options);
  t.after(async () => {
    await store.dispose().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, store, id: await store.start(1) };
}
async function seed(root, value = data(), extra = {}) {
  const id = randomUUID(),
    token = randomUUID(),
    dir = path.join(root, id);
  await fs.mkdir(dir);
  await fs.writeFile(
    path.join(dir, 'owner.json'),
    JSON.stringify({ token, pid: process.pid }),
  );
  await fs.writeFile(path.join(dir, `released-${token}`), '{}');
  await fs.writeFile(
    path.join(dir, `snapshot-${value.generation}-${value.revision}.json`),
    JSON.stringify({
      ...value,
      version: 1,
      timestamp: new Date().toISOString(),
      ...extra,
    }),
  );
  return { id, dir, token };
}
test('additional caller fields never persist or participate in serialization', async (t) => {
  const { root, store, id } = await fixture(t, {
    maxBytes: 400,
    maxSnapshotBytes: 400,
  });
  const value = {
    ...data(),
    version: 999,
    timestamp: 'untrusted',
    padding: 'x'.repeat(10000),
  };
  Object.defineProperty(value, 'ignored', {
    enumerable: true,
    get() {
      throw new Error('extra field accessed');
    },
  });
  await store.write(1, id, value);
  const file = await fs.readFile(
    path.join(root, id, 'snapshot-0-1.json'),
    'utf8',
  );
  assert.ok(Buffer.byteLength(file) <= 400);
  const saved = JSON.parse(file);
  assert.deepEqual(
    Object.keys(saved).sort(),
    [
      'version',
      'timestamp',
      'name',
      'generation',
      'revision',
      'excludedVideoCount',
      'project',
    ].sort(),
  );
  assert.equal(saved.version, 1);
  assert.ok(Number.isFinite(Date.parse(saved.timestamp)));
  assert.deepEqual(await store.read(1, id), saved);
});
test('complete UTF-8 snapshot limit accepts the exact boundary and rejects one byte above', async (t) => {
  const value = data();
  value.name = '猫😀';
  const exact = size(value),
    { store, id } = await fixture(t, { maxSnapshotBytes: exact });
  assert.equal(await store.write(1, id, value), true);
  const large = data(2);
  large.name = value.name + 'a';
  await assert.rejects(store.write(1, id, large), {
    code: 'RECOVERY_SIZE_LIMIT',
  });
  assert.equal((await store.read(1, id)).revision, 1);
});
test('metadata alone cannot bypass the whole snapshot limit; malformed input is rejected', async (t) => {
  const { store, id } = await fixture(t, { maxSnapshotBytes: 300 });
  await assert.rejects(
    store.write(1, id, { ...data(), name: '界'.repeat(100) }),
    { code: 'RECOVERY_SIZE_LIMIT' },
  );
  for (const patch of [
    { generation: -1 },
    { revision: NaN },
    { excludedVideoCount: -1 },
    { name: 'a'.repeat(513) },
    { project: null },
  ])
    await assert.rejects(store.write(1, id, { ...data(), ...patch }));
});
test('limits cannot be raised with caller options', async (t) => {
  const { store } = await fixture(t, {
    maxTotalBytes: Number.MAX_SAFE_INTEGER,
    maxSessions: 100000,
  });
  const { usage } = await store.list();
  assert.equal(usage.limitBytes, L.totalBytes);
  assert.equal(usage.sessionLimit, L.sessions);
  assert.throws(
    () => createRecoveryStore('/unused', { maxBytes: -1 }),
    /test limit/,
  );
});
test('temporary replacement bytes are charged before deleting either completed snapshot', async (t) => {
  const bytes = size(data());
  const { root, store, id } = await fixture(t, {
    maxTotalBytes: L.controlReserveBytes + bytes * 3 - 1,
  });
  await store.write(1, id, data(1));
  await store.write(1, id, data(2));
  await assert.rejects(store.write(1, id, data(3)), {
    code: 'RECOVERY_STORAGE_LIMIT',
  });
  assert.equal((await store.read(1, id)).revision, 2);
  assert.equal(
    (await fs.readdir(path.join(root, id))).filter((n) =>
      n.startsWith('snapshot-'),
    ).length,
    2,
  );
  assert.ok(
    !(await fs.readdir(path.join(root, id))).some((n) => n.endsWith('.tmp')),
  );
});
test('the exact aggregate boundary permits rotation and identical retries require no extra allocation', async (t) => {
  const bytes = size(data()),
    { store, id } = await fixture(t, {
      maxTotalBytes: L.controlReserveBytes + bytes * 3,
    });
  for (let n = 1; n <= 3; n++)
    assert.equal(await store.write(1, id, data(n)), true);
  assert.equal(await store.write(1, id, data(3)), true);
  const usage = (await store.list()).usage;
  assert.equal(usage.dataBytes, bytes * 2);
  assert.ok(usage.totalBytes <= usage.limitBytes);
});
test('session admission is idempotent, bounded, and allows explicit discard at capacity', async (t) => {
  const { store, id } = await fixture(t, { maxSessions: 1 });
  await store.write(1, id, data());
  assert.equal(await store.start(1), id);
  await assert.rejects(store.start(2), { code: 'RECOVERY_SESSION_LIMIT' });
  await store.releaseRenderer(1);
  assert.equal((await store.list()).sessions.length, 1);
  await store.claim(2, id);
  assert.equal((await store.read(2, id)).revision, 1);
  await store.discard(2, id);
  assert.ok(await store.start(2));
});
test('claimed backups consume ownership slots and release preserves their data', async (t) => {
  const { root, store } = await fixture(t);
  const a = await seed(root),
    b = await seed(root);
  await store.claim(1, a.id);
  await assert.rejects(store.claim(1, b.id), {
    code: 'RECOVERY_SESSION_LIMIT',
  });
  await store.release(1, a.id);
  await store.claim(1, b.id);
  assert.ok((await store.list()).sessions.some((s) => s.id === a.id));
  await store.release(1, b.id);
});
test('oversized legacy snapshots fall back; unknown fields are stripped from reads', async (t) => {
  const { root, store } = await fixture(t, { maxSnapshotBytes: 500 });
  const item = await seed(root, data(), { legacyExtra: 'ignored' });
  await fs.writeFile(
    path.join(item.dir, 'snapshot-0-2.json'),
    JSON.stringify({
      ...data(2),
      version: 1,
      timestamp: new Date().toISOString(),
      extra: 'x'.repeat(1000),
    }),
  );
  await store.claim(1, item.id);
  const restored = await store.read(1, item.id);
  assert.equal(restored.revision, 1);
  assert.equal(restored.legacyExtra, undefined);
  assert.ok(
    (await fs.stat(path.join(item.dir, 'snapshot-0-2.json'))).size > 500,
  );
});
test('legacy over-quota profiles remain listable, claimable, readable, and discardable', async (t) => {
  const { root, store } = await fixture(t, {
    maxTotalBytes: L.controlReserveBytes + 50,
  });
  const item = await seed(root);
  const listing = await store.list();
  assert.equal(listing.sessions[0].id, item.id);
  await assert.rejects(store.start(2), { code: 'RECOVERY_STORAGE_LIMIT' });
  await store.claim(1, item.id);
  assert.equal((await store.read(1, item.id)).revision, 1);
  await assert.rejects(store.write(1, item.id, data(2)), {
    code: 'RECOVERY_STORAGE_LIMIT',
  });
  await store.discard(1, item.id);
  assert.equal((await store.list()).sessions.length, 0);
});
test('paginated listings include damaged copies and never delete them automatically', async (t) => {
  const { root, store } = await fixture(t);
  const ids = [];
  for (let n = 0; n < 35; n++) {
    const item = await seed(root);
    ids.push(item.id);
    if (n === 0)
      await fs.writeFile(path.join(item.dir, 'snapshot-0-1.json'), 'broken');
  }
  const first = await store.list(),
    second = await store.list({ cursor: first.nextCursor });
  assert.equal(first.sessions.length, 32);
  assert.equal(second.sessions.length, 3);
  assert.equal(second.nextCursor, null);
  const rows = [...first.sessions, ...second.sessions];
  assert.equal(new Set(rows.map((s) => s.id)).size, 35);
  const damaged = rows.find((s) => !s.recoverable);
  assert.equal(damaged.id, ids[0]);
  await store.discard(1, damaged.id);
  await assert.rejects(fs.stat(path.join(root, damaged.id)), {
    code: 'ENOENT',
  });
});
test('bounded reads reject a file that grows after its initial size check', async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, 'growth');
  await fs.writeFile(file, 'a');
  const io = {
    ...fs,
    open: async (...args) => {
      await fs.writeFile(file, 'x'.repeat(200));
      return fs.open(...args);
    },
  };
  await assert.rejects(boundedRead(io, file, 100), {
    code: 'RECOVERY_SIZE_LIMIT',
  });
});
test(
  'storage links are not followed by accounting, snapshot reads, or explicit discard',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { root, store, id } = await fixture(t);
    const outside = path.join(root, 'outside');
    await fs.writeFile(outside, 'original');
    await fs.symlink(outside, path.join(root, id, 'snapshot-0-1.json'));
    await assert.rejects(store.write(1, id, data(2)), {
      code: 'RECOVERY_UNSAFE',
    });
    await assert.rejects(store.read(1, id));
    await store.discard(1, id);
    assert.equal(await fs.readFile(outside, 'utf8'), 'original');
  },
);
test('a concurrent write is rejected before its project is accessed and cleanup drains the admitted write', async (t) => {
  let unblock, entered;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let block = false;
  const io = {
    ...fs,
    rename: async (...args) => {
      if (block && args[1].includes('snapshot-')) {
        entered();
        await gate;
      }
      return fs.rename(...args);
    },
  };
  const { root, store, id } = await fixture(t, { fs: io });
  block = true;
  const writing = store.write(1, id, data());
  await started;
  const forbidden = { ...data(2) };
  Object.defineProperty(forbidden, 'project', {
    get() {
      throw new Error('payload touched');
    },
  });
  await assert.rejects(store.write(1, id, forbidden), {
    code: 'RECOVERY_BUSY',
  });
  let disposed = false;
  const closing = store.dispose().then(() => {
    disposed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed, false);
  unblock();
  await writing;
  await closing;
  const next = createRecoveryStore(root);
  const listing = await next.list();
  assert.ok(listing.sessions.some((s) => s.id === id));
  await next.dispose();
});
test('failed sync and rename release coordination and retain the previous durable snapshot', async (t) => {
  for (const method of ['sync', 'rename']) {
    let fail = false;
    const io = {
      ...fs,
      rename: async (...args) => {
        if (fail && method === 'rename')
          throw new Error('injected rename failure');
        return fs.rename(...args);
      },
      open: async (...args) => {
        const handle = await fs.open(...args);
        if (
          fail &&
          method === 'sync' &&
          String(args[0]).includes('snapshot-') &&
          String(args[0]).endsWith('.tmp')
        )
          handle.sync = async () => {
            throw new Error('injected sync failure');
          };
        return handle;
      },
    };
    const { store, id } = await fixture(t, { fs: io });
    await store.write(1, id, data());
    fail = true;
    await assert.rejects(store.write(1, id, data(2)), /injected/);
    fail = false;
    assert.equal((await store.read(1, id)).revision, 1);
    await store.write(1, id, data(2));
  }
});
test('coordinator contention is fail-closed without a filesystem lease takeover', async (t) => {
  const { root, store, id } = await fixture(t);
  const gate = createRecoveryCoordinator(root);
  await gate.run(async () => {
    await assert.rejects(store.write(1, id, data()), { code: 'RECOVERY_BUSY' });
  });
  assert.equal(await store.write(1, id, data()), true);
});

test('legacy ownership chains compact without losing data and ambiguous owners remain protected', async (t) => {
  const { root, store } = await fixture(t),
    item = await seed(root);
  const next = randomUUID();
  await fs.writeFile(
    path.join(item.dir, `claim-${item.token}.json`),
    JSON.stringify({ token: next, pid: process.pid }),
  );
  await fs.writeFile(path.join(item.dir, `released-${next}`), '{}');
  await store.list();
  assert.equal(
    JSON.parse(await fs.readFile(path.join(item.dir, 'owner.json'))).token,
    next,
  );
  assert.ok(!(await fs.readdir(item.dir)).some((n) => n.startsWith('claim-')));
  const protectedCopy = await seed(root);
  await fs.unlink(
    path.join(protectedCopy.dir, `released-${protectedCopy.token}`),
  );
  const uncertain = createRecoveryStore(root, { isAlive: () => undefined });
  await assert.rejects(uncertain.claim(9, protectedCopy.id), {
    code: 'RECOVERY_ACTIVE',
  });
  await assert.rejects(uncertain.discard(9, protectedCopy.id), {
    code: 'RECOVERY_ACTIVE',
  });
  await uncertain.dispose();
});
test('deletion failure keeps bytes charged and the existing recovery copy readable', async (t) => {
  let fail = false;
  const io = {
    ...fs,
    unlink: async (file) => {
      if (fail && /snapshot-.*\.json$/.test(file))
        throw Object.assign(new Error('cannot delete'), { code: 'EACCES' });
      return fs.unlink(file);
    },
  };
  const { store, id } = await fixture(t, { fs: io });
  await store.write(1, id, data());
  fail = true;
  await assert.rejects(store.discard(1, id), /cannot delete/);
  fail = false;
  assert.equal((await store.read(1, id)).revision, 1);
  assert.equal((await store.list()).usage.dataBytes, size(data()));
});

test('legacy metadata beyond its reserved allowance remains charged until safe compaction', async (t) => {
  const { root, store, id } = await fixture(t, {
    maxTotalBytes: L.controlReserveBytes + 100,
  });
  // Preserve a live legacy owner: its chain cannot be compacted by another instance.
  await fs.writeFile(
    path.join(root, id, `claim-${randomUUID()}.json`),
    ' '.repeat(L.sessionMetadataBytes + 101),
  );
  const used = (await store.list()).usage;
  assert.ok(used.dataBytes >= 101);
  await assert.rejects(store.write(1, id, data()), {
    code: 'RECOVERY_STORAGE_LIMIT',
  });
});
test('renderer teardown cancels pending initialization and removes its partial session', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-recovery-init-'));
  let unblock, entered;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  const seen = new Promise((resolve) => {
    entered = resolve;
  });
  const io = {
    ...fs,
    rename: async (...args) => {
      if (args[1].endsWith('owner.json')) {
        entered();
        await gate;
      }
      return fs.rename(...args);
    },
  };
  const store = createRecoveryStore(root, { fs: io });
  t.after(async () => {
    unblock();
    await store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });
  const starting = store.start(1);
  const rejected = assert.rejects(starting, { code: 'RECOVERY_CANCELED' });
  await seen;
  const releasing = store.releaseRenderer(1);
  unblock();
  await rejected;
  await releasing;
  assert.equal((await store.list()).usage.sessions, 0);
  assert.ok(await store.start(2));
});
test('partial owner publication can be released after directory-sync failure', async (t) => {
  let fail = false;
  const io = {
    ...fs,
    open: async (...args) => {
      const handle = await fs.open(...args);
      if (fail && args[1] === 'r')
        handle.sync = async () => {
          throw new Error('directory sync failed');
        };
      return handle;
    },
  };
  const { root, store } = await fixture(t, { fs: io });
  const item = await seed(root);
  fail = true;
  await assert.rejects(store.claim(1, item.id), /directory sync failed/);
  fail = false;
  await store.release(1, item.id);
  assert.ok(
    (await store.list()).sessions.some((entry) => entry.id === item.id),
  );
  await store.claim(2, item.id);
  assert.equal((await store.read(2, item.id)).revision, 1);
});
test('unavailable coordinator fails closed without creating a recovery session', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'soapy-recovery-unavailable-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.control'));
  await fs.writeFile(path.join(root, '.control', 'quota.sqlite'), 'not sqlite');
  const store = createRecoveryStore(root);
  await assert.rejects(store.start(1), { code: 'RECOVERY_IO' });
  assert.deepEqual(await fs.readdir(root), ['.control']);
  await store.dispose();
});
