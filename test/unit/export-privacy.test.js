const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const io = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Writable } = require('node:stream');
const { createExportStaging } = require('../../app/main/export-staging');
const {
  createExportStreamSessionRegistry,
} = require('../../app/main/export-stream-sessions');
const {
  createWindowsExportPermissions,
} = require('../../app/main/export-private-windows');
async function fixture(t, options = {}) {
  const profile = await io.mkdtemp(
    path.join(os.tmpdir(), 'soapy-export-private-'),
  );
  const stagingRoot = path.join(profile, 'export-staging');
  const registry = createExportStreamSessionRegistry({
    stagingRoot,
    minFreeBytes: 0,
    ...options,
  });
  t.after(async () => {
    await registry.dispose().catch(() => {});
    await io.rm(profile, { recursive: true, force: true });
  });
  return {
    profile,
    stagingRoot,
    registry,
    destination: path.join(profile, 'result.mp4'),
  };
}
async function entries(root) {
  const result = [];
  for (const name of await io.readdir(root)) {
    const dir = path.join(root, name);
    for (const file of await io.readdir(dir)) result.push(path.join(dir, file));
  }
  return result;
}

for (const mask of [0, 0o022]) {
  test(
    `private permissions exist at creation with umask ${mask.toString(8)}`,
    { skip: process.platform === 'win32' },
    () => {
      const script = `
      const fs=require('fs'), path=require('path'), os=require('os');
      const {createExportStreamSessionRegistry}=require('./app/main/export-stream-sessions');
      process.umask(${mask});
      (async()=>{const profile=fs.mkdtempSync(path.join(os.tmpdir(),'soapy-export-umask-'));
        const seen=[];
        const wrapped={...fs,promises:{...fs.promises,
          mkdir:async(p,o)=>{await fs.promises.mkdir(p,o);seen.push(['dir',fs.statSync(p).mode&511]);},
          open:async(p,flags,mode)=>{const h=await fs.promises.open(p,flags,mode);if(flags==='wx'||flags==='wx+')seen.push(['file',fs.statSync(p).mode&511]);return h;}
        }};
        const r=createExportStreamSessionRegistry({stagingRoot:path.join(profile,'export-staging'),fs:wrapped,minFreeBytes:0});
        try{const s=await r.begin({filePath:path.join(profile,'final.mp4')},1);await r.write(s.sessionId,1,0,Buffer.from('private'));
          await r.finish(s.sessionId,1);
          if((fs.statSync(path.join(profile,'final.mp4')).mode&511)!==384)throw Error('Output not private');
          console.log(JSON.stringify(seen));await r.dispose();}
        finally{await fs.promises.rm(profile,{recursive:true,force:true});}
      })().catch(e=>{console.error(e);process.exitCode=1});`;
      const result = spawnSync(process.execPath, ['-e', script], {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const seen = JSON.parse(result.stdout);
      assert.ok(seen.filter(([kind]) => kind === 'dir').length >= 2);
      assert.ok(seen.filter(([kind]) => kind === 'file').length >= 3);
      for (const [kind, mode] of seen)
        assert.equal(mode, kind === 'dir' ? 0o700 : 0o600);
    },
  );
}

test('seek writes, private new destinations, preserved existing permissions and automatic collisions', async (t) => {
  const { registry, destination } = await fixture(t);
  const begin = () => registry.begin({ filePath: destination }, 1);
  let session = await begin();
  await registry.write(session.sessionId, 1, 4, Buffer.from('EF'));
  await registry.write(session.sessionId, 1, 0, Buffer.from('ABCD'));
  await registry.finish(session.sessionId, 1);
  assert.equal(await io.readFile(destination, 'utf8'), 'ABCDEF');
  if (process.platform !== 'win32')
    assert.equal((await io.stat(destination)).mode & 0o777, 0o600);
  await io.chmod(destination, 0o640);
  session = await begin();
  await registry.write(session.sessionId, 1, 0, Buffer.from('X'));
  await registry.finish(session.sessionId, 1);
  assert.equal(await io.readFile(destination, 'utf8'), 'X');
  if (process.platform !== 'win32')
    assert.equal((await io.stat(destination)).mode & 0o777, 0o640);
  session = await registry.begin({ filePath: destination, automatic: true }, 1);
  await registry.write(session.sessionId, 1, 0, Buffer.from('new'));
  assert.equal(
    (await registry.finish(session.sessionId, 1)).fileName,
    'result1.mp4',
  );
  assert.equal(await io.readFile(destination, 'utf8'), 'X');
});

test('no default temp fallback; existing staging file collisions are never truncated', async (t) => {
  assert.throws(() => createExportStreamSessionRegistry(), {
    code: 'EXPORT_PRIVATE_STORAGE',
  });
  const { stagingRoot } = await fixture(t);
  const staging = createExportStaging(stagingRoot);
  await staging.initialize();
  const id = randomUUID(),
    file = path.join(staging.runPath, id + '.tmp');
  await io.writeFile(file, 'keep', { mode: 0o600 });
  await assert.rejects(staging.open(id), { code: 'EEXIST' });
  assert.equal(await io.readFile(file, 'utf8'), 'keep');
  await io.unlink(file);
  await staging.dispose();
});

test(
  'root/run substitution and staging symlinks fail without touching outside files',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { profile, stagingRoot } = await fixture(t);
    const outside = path.join(profile, 'outside');
    await io.mkdir(outside, { mode: 0o700 });
    await io.symlink(outside, stagingRoot);
    const bad = createExportStaging(stagingRoot);
    await assert.rejects(bad.initialize(), { code: 'EXPORT_PRIVATE_STORAGE' });
    await io.unlink(stagingRoot);
    const staging = createExportStaging(stagingRoot);
    await staging.initialize();
    const id = randomUUID(),
      victim = path.join(outside, 'victim');
    await io.writeFile(victim, 'untouched');
    await io.symlink(victim, path.join(staging.runPath, id + '.tmp'));
    await assert.rejects(staging.open(id), { code: 'EEXIST' });
    assert.equal(await io.readFile(victim, 'utf8'), 'untouched');
    const moved = staging.runPath + '-moved';
    await io.rename(staging.runPath, moved);
    await io.mkdir(staging.runPath, { mode: 0o700 });
    await assert.rejects(staging.open(randomUUID()), {
      code: 'EXPORT_PRIVATE_STORAGE',
    });
    assert.deepEqual(await io.readdir(staging.runPath), []);
  },
);

test('incorrect ownership, shared-writable profile, and unavailable Windows enforcement fail closed', async (t) => {
  const { profile, stagingRoot } = await fixture(t);
  if (process.getuid) {
    await assert.rejects(
      createExportStaging(stagingRoot, {
        uid: process.getuid() + 1,
      }).initialize(),
      { code: 'EXPORT_PRIVATE_STORAGE' },
    );
    await io.chmod(profile, 0o777);
    await assert.rejects(createExportStaging(stagingRoot).initialize(), {
      code: 'EXPORT_PRIVATE_STORAGE',
    });
    await io.chmod(profile, 0o700);
  }
  let calls = 0;
  await assert.rejects(
    createExportStaging(stagingRoot, {
      platform: 'win32',
      windowsPermissions: {
        directory: async () => {
          calls++;
          throw new Error('ACL unavailable');
        },
      },
    }).initialize(),
    { code: 'EXPORT_PRIVATE_STORAGE' },
  );
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(stagingRoot), false);
});

test('partial initialization failure never creates an artwork file', async (t) => {
  const { stagingRoot } = await fixture(t);
  const wrapped = {
    ...fs,
    promises: {
      ...io,
      open: async (file, ...args) => {
        if (file.endsWith('owner.json')) {
          const error = new Error('disk');
          error.code = 'ENOSPC';
          throw error;
        }
        return io.open(file, ...args);
      },
    },
  };
  const registry = createExportStreamSessionRegistry({
    stagingRoot,
    fs: wrapped,
    minFreeBytes: 0,
  });
  await assert.rejects(registry.begin({ filePath: '/unused' }, 1), {
    code: 'EXPORT_PRIVATE_STORAGE',
  });
  assert.equal((await entries(stagingRoot)).length, 0);
  await registry.dispose();
});

async function staleRun(root, pid, contents = 'valid') {
  await io.mkdir(root, { recursive: true, mode: 0o700 });
  const identifier = randomUUID(),
    dir = path.join(root, `${pid}-${identifier}`);
  await io.mkdir(dir, { mode: 0o700 });
  if (contents !== 'missing')
    await io.writeFile(
      path.join(dir, 'owner.json'),
      contents === 'valid'
        ? JSON.stringify({ version: 1, pid, identifier })
        : '{broken',
      { mode: 0o600 },
    );
  const file = path.join(dir, `${randomUUID()}.tmp`);
  await io.writeFile(file, 'private', { mode: 0o600 });
  return { dir, file };
}

test(
  'startup cleans only provably dead, recognized owners; concurrent sweeps are safe',
  {
    skip:
      process.platform === 'win32'
        ? 'POSIX permissions and symlink fixtures; Windows crash cleanup has an integration test'
        : false,
  },
  async (t) => {
    const { profile, stagingRoot } = await fixture(t);
    const dead = await staleRun(stagingRoot, 10001);
    const incomplete = await staleRun(stagingRoot, 10002, 'missing');
    const malformed = await staleRun(stagingRoot, 10003, 'broken');
    const live = await staleRun(stagingRoot, 10004);
    const ambiguous = await staleRun(stagingRoot, 10005);
    const foreign = await staleRun(stagingRoot, 10006);
    await io.writeFile(path.join(foreign.dir, 'user-art.png'), 'keep');
    const linked = await staleRun(stagingRoot, 10007);
    const victim = path.join(profile, 'outside');
    await io.writeFile(victim, 'keep');
    await io.unlink(linked.file);
    await io.symlink(victim, linked.file);
    const options = {
      isAlive: (pid) =>
        pid === 10004 ? true : pid === 10005 ? undefined : false,
    };
    const a = createExportStaging(stagingRoot, { ...options, pid: 20001 });
    const b = createExportStaging(stagingRoot, { ...options, pid: 20002 });
    // The injected probe must also consider both new instances alive.
    options.isAlive = (pid) =>
      [10004, 20001, 20002].includes(pid)
        ? true
        : pid === 10005
          ? undefined
          : false;
    const c = createExportStaging(stagingRoot, { ...options, pid: 20003 });
    await a.initialize();
    await a.dispose();
    await b.initialize();
    await b.dispose();
    await c.initialize();
    assert.equal(fs.existsSync(dead.dir), false);
    assert.equal(fs.existsSync(incomplete.dir), false);
    for (const run of [malformed, live, ambiguous, foreign, linked])
      assert.equal(fs.existsSync(run.dir), true);
    assert.equal(await io.readFile(victim, 'utf8'), 'keep');
    await c.dispose();
    const shared = { isAlive: (pid) => [30001, 30002].includes(pid) };
    await staleRun(stagingRoot, 11000);
    const one = createExportStaging(stagingRoot, { ...shared, pid: 30001 });
    const two = createExportStaging(stagingRoot, { ...shared, pid: 30002 });
    await Promise.all([one.initialize(), two.initialize()]);
    assert.ok(fs.existsSync(one.runPath));
    assert.ok(fs.existsSync(two.runPath));
    await one.dispose();
    await two.dispose();
  },
);

test('short writes and low space invalidate streams and remove staging data', async (t) => {
  let short = false;
  const wrapped = {
    ...fs,
    promises: {
      ...io,
      open: async (...args) => {
        const handle = await io.open(...args);
        if (args[1] === 'wx+') {
          const original = handle.write.bind(handle);
          handle.write = (...writeArgs) =>
            short
              ? Promise.resolve({ bytesWritten: 0 })
              : original(...writeArgs);
        }
        return handle;
      },
    },
  };
  const { registry, destination, stagingRoot } = await fixture(t, {
    fs: wrapped,
  });
  const session = await registry.begin({ filePath: destination }, 1);
  short = true;
  await assert.rejects(
    registry.write(session.sessionId, 1, 0, Buffer.from('secret')),
    /complete/,
  );
  assert.equal(registry.size(), 0);
  assert.ok(
    (await entries(stagingRoot)).every((file) => file.endsWith('owner.json')),
  );
  const low = createExportStreamSessionRegistry({
    stagingRoot,
    statfs: async () => ({ bavail: 0, bsize: 4096 }),
  });
  await assert.rejects(low.begin({ filePath: destination }, 1), {
    code: 'EXPORT_STREAM_RESOURCE_LIMIT',
  });
  await low.dispose();
});

test('ownership, abort, idle expiry, and copy failure use the same cleanup', async (t) => {
  let expire;
  const { registry, destination, stagingRoot } = await fixture(t, {
    setTimeout: (fn) => {
      expire = fn;
      return {};
    },
    clearTimeout: () => {},
  });
  let session = await registry.begin({ filePath: destination }, 1);
  await assert.rejects(
    registry.write(session.sessionId, 2, 0, Buffer.from('x')),
    /belong/,
  );
  await assert.rejects(registry.abort(session.sessionId, 2), /belong/);
  assert.equal(await registry.abort(session.sessionId, 1), true);
  assert.equal(await registry.abort(session.sessionId, 1), false);
  session = await registry.begin({ filePath: destination }, 1);
  expire();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(registry.size(), 0);
  session = await registry.begin(
    { filePath: path.join(destination, 'absent', 'out.mp4') },
    1,
  );
  await registry.write(session.sessionId, 1, 0, Buffer.from('x'));
  await assert.rejects(registry.finish(session.sessionId, 1));
  assert.ok(
    (await entries(stagingRoot)).every((file) => file.endsWith('owner.json')),
  );
});

test('disposal fences a pending begin, waits for final copies, and is idempotent', async (t) => {
  const { stagingRoot, destination } = await fixture(t);
  const storage = createExportStaging(stagingRoot);
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  const realOpen = storage.open;
  storage.open = async (id) => {
    const file = await realOpen(id);
    await gate;
    return file;
  };
  const registry = createExportStreamSessionRegistry({
    staging: storage,
    minFreeBytes: 0,
  });
  const begun = registry.begin({ filePath: destination }, 1);
  const rejected = assert.rejects(begun, /canceled/);
  while (
    !(await entries(stagingRoot).catch(() => [])).some((file) =>
      file.endsWith('.tmp'),
    )
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  const disposed = registry.dispose();
  unblock();
  await rejected;
  await disposed;
  await assert.rejects(
    registry.begin({ filePath: destination }, 1),
    /shutting down/,
  );
  assert.equal(registry.dispose(), disposed);
  const nextStorage = createExportStaging(stagingRoot);
  let finishCopy;
  const copyGate = new Promise((resolve) => {
    finishCopy = resolve;
  });
  const originalCopy = nextStorage.copy;
  let copying = false;
  nextStorage.copy = async (...args) => {
    copying = true;
    await copyGate;
    return originalCopy(...args);
  };
  const next = createExportStreamSessionRegistry({
    staging: nextStorage,
    minFreeBytes: 0,
  });
  const session = await next.begin({ filePath: destination }, 1);
  await next.write(session.sessionId, 1, 0, Buffer.from('complete'));
  const finished = next.finish(session.sessionId, 1);
  while (!copying) await new Promise((resolve) => setTimeout(resolve, 5));
  let drained = false;
  const closing = next.dispose().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(drained, false);
  finishCopy();
  await finished;
  await closing;
  assert.equal(await io.readFile(destination, 'utf8'), 'complete');
  assert.deepEqual(await io.readdir(stagingRoot), []);
});

test('Windows helper uses a fixed absolute program and JSON stdin for hostile/unicode paths', async () => {
  let invocation,
    input = '';
  const fake = (executable, args, options, callback) => {
    invocation = { executable, args, options };
    const child = {
      stdin: new Writable({
        write(chunk, _encoding, done) {
          input += chunk;
          done();
        },
      }),
      kill() {},
    };
    child.stdin.on('finish', () => callback(null, '{"ok":true}'));
    return child;
  };
  const adapter = createWindowsExportPermissions({
    systemRoot: 'C:\\Windows',
    execFile: fake,
  });
  const directory = 'C:\\Users\\例\\art;$(echo injected)';
  await adapter.directory(directory, true);
  assert.equal(
    invocation.executable,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.ok(!invocation.args.join(' ').includes(directory));
  assert.equal(JSON.parse(input).path, directory);
  assert.equal(invocation.options.shell, undefined);
  assert.throws(() =>
    createWindowsExportPermissions({ systemRoot: 'relative' }),
  );
});

test('finalization drains previously queued writes before copying', async (t) => {
  const { registry, destination } = await fixture(t);
  const session = await registry.begin({ filePath: destination }, 1);
  const write = registry.write(session.sessionId, 1, 0, Buffer.from('queued'));
  const finish = registry.finish(session.sessionId, 1);
  await Promise.all([write, finish]);
  assert.equal(await io.readFile(destination, 'utf8'), 'queued');
});

test('disk checks cover the staging volume and the selected destination volume', async (t) => {
  const checked = [];
  const { registry, destination, stagingRoot } = await fixture(t, {
    statfs: async (target) => {
      checked.push(target);
      return {
        bavail: target === destinationDirectory ? 0 : 1024 * 1024,
        bsize: 4096,
      };
    },
  });
  const destinationDirectory = path.dirname(destination);
  const session = await registry.begin({ filePath: destination }, 1);
  await registry.write(session.sessionId, 1, 0, Buffer.from('private'));
  await assert.rejects(registry.finish(session.sessionId, 1), {
    code: 'EXPORT_STREAM_RESOURCE_LIMIT',
  });
  assert.ok(checked.some((p) => path.dirname(p) === stagingRoot));
  assert.ok(checked.includes(destinationDirectory));
  assert.ok(
    (await entries(stagingRoot)).every((file) => file.endsWith('owner.json')),
  );
  await assert.rejects(io.stat(destination), { code: 'ENOENT' });
});

test(
  'destination symlinks are rejected without modifying their target',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { registry, destination, profile } = await fixture(t);
    const victim = path.join(profile, 'untouched');
    await io.writeFile(victim, 'original');
    await io.symlink(victim, destination);
    const session = await registry.begin({ filePath: destination }, 1);
    await registry.write(session.sessionId, 1, 0, Buffer.from('secret'));
    await assert.rejects(registry.finish(session.sessionId, 1));
    assert.equal(await io.readFile(victim, 'utf8'), 'original');
    assert.equal(registry.size(), 0);
  },
);

test(
  'copy retries short writes and keeps failed new output private while releasing staging',
  {
    skip:
      process.platform === 'win32'
        ? 'Injects POSIX FileHandle writes; Windows copying uses the ACL adapter'
        : false,
  },
  async (t) => {
    let fail = false;
    const wrapped = {
      ...fs,
      promises: {
        ...io,
        open: async (...args) => {
          const handle = await io.open(...args);
          if (String(args[0]).endsWith('result.mp4')) {
            const write = handle.write.bind(handle);
            handle.write = (buffer, offset, length, position) =>
              fail
                ? Promise.reject(
                    Object.assign(new Error('disk failure'), { code: 'EIO' }),
                  )
                : write(buffer, offset, Math.min(2, length), position);
          }
          return handle;
        },
      },
    };
    const { registry, destination, stagingRoot } = await fixture(t, {
      fs: wrapped,
    });
    let session = await registry.begin({ filePath: destination }, 1);
    await registry.write(
      session.sessionId,
      1,
      0,
      Buffer.from('complete short writes'),
    );
    await registry.finish(session.sessionId, 1);
    assert.equal(
      await io.readFile(destination, 'utf8'),
      'complete short writes',
    );
    await io.unlink(destination);
    fail = true;
    session = await registry.begin({ filePath: destination }, 1);
    await registry.write(session.sessionId, 1, 0, Buffer.from('secret'));
    await assert.rejects(registry.finish(session.sessionId, 1), {
      code: 'EIO',
    });
    if (process.platform !== 'win32')
      assert.equal((await io.stat(destination)).mode & 0o777, 0o600);
    assert.ok(
      (await entries(stagingRoot)).every((file) => file.endsWith('owner.json')),
    );
  },
);

test('shutdown during initialization drains startup and never opens artwork storage', async (t) => {
  const { stagingRoot, destination } = await fixture(t);
  const storage = createExportStaging(stagingRoot);
  const initialize = storage.initialize;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  storage.initialize = async () => {
    await gate;
    return initialize();
  };
  const registry = createExportStreamSessionRegistry({
    staging: storage,
    minFreeBytes: 0,
  });
  const beginning = registry.begin({ filePath: destination }, 1);
  const rejected = assert.rejects(beginning, /canceled/);
  const disposing = registry.dispose();
  release();
  await rejected;
  await disposing;
  assert.deepEqual(await io.readdir(stagingRoot), []);
});

test(
  'Windows junctions cannot substitute the staging root',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { profile, stagingRoot } = await fixture(t);
    const outside = path.join(profile, 'outside');
    await io.mkdir(outside);
    await io.writeFile(path.join(outside, 'keep'), 'original');
    await io.symlink(outside, stagingRoot, 'junction');
    await assert.rejects(createExportStaging(stagingRoot).initialize(), {
      code: 'EXPORT_PRIVATE_STORAGE',
    });
    assert.equal(
      await io.readFile(path.join(outside, 'keep'), 'utf8'),
      'original',
    );
  },
);
