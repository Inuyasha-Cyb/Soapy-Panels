const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const {
  createWindowsStoreBridge,
  STORE_QUERY_TIMEOUT_MS,
  STORE_PURCHASE_TIMEOUT_MS,
} = require('../../app/main/windows-store-bridge');
const EXE = 'SoapyStoreBridge.exe';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soapy-helper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resourcesPath = path.join(root, 'installed space 例', 'resources');
  const mainDirectory = path.join(root, 'source space 例', 'app', 'main');
  const currentDirectory = path.join(root, 'untrusted launch');
  const bundled = path.join(resourcesPath, 'store-bridge', EXE);
  const development = path.join(
    mainDirectory,
    '..',
    '..',
    'out',
    'store-bridge',
    EXE,
  );
  const decoy = path.join(currentDirectory, 'out', 'store-bridge', EXE);
  for (const dir of [
    resourcesPath,
    mainDirectory,
    path.dirname(development),
    path.dirname(decoy),
  ])
    fs.mkdirSync(dir, { recursive: true });
  const put = (file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'inert test fixture; never execute');
  };
  function bridge(options = {}) {
    const result = createWindowsStoreBridge({
      isPackaged: true,
      resourcesPath,
      mainDirectory,
      currentDirectory,
      logMainImpl() {},
      processObject: new EventEmitter(),
      ...options,
    });
    t.after(() => result.dispose());
    return result;
  }
  return {
    root,
    resourcesPath,
    mainDirectory,
    currentDirectory,
    bundled,
    development,
    decoy,
    put,
    bridge,
  };
}
test('packaged lookup uses only the bundled regular file despite both fallback decoys', (t) => {
  const f = fixture(t);
  [f.bundled, f.development, f.decoy].forEach(f.put);
  assert.equal(f.bridge().resolveHelperPath(), fs.realpathSync(f.bundled));
});
test('a missing bundled helper rejects query and purchase without spawning either decoy', async (t) => {
  const f = fixture(t);
  [f.development, f.decoy].forEach(f.put);
  let spawns = 0;
  const bridge = f.bridge({
    execFileImpl() {
      spawns++;
      throw new Error('must not execute');
    },
  });
  assert.equal(bridge.resolveHelperPath(), '');
  await assert.rejects(
    bridge.queryEntitlements(),
    /not available in this build/,
  );
  await assert.rejects(
    bridge.purchaseProduct({ productId: 'known' }),
    /not available in this build/,
  );
  assert.equal(spawns, 0);
});
test('unknown packaging state always uses packaged restrictions', (t) => {
  const f = fixture(t);
  [f.development, f.decoy].forEach(f.put);
  for (const isPackaged of [undefined, null, 0, '', 'false', {}, true]) {
    assert.equal(
      f.bridge({ isPackaged }).resolveHelperPath(),
      '',
      String(isPackaged),
    );
  }
  f.put(f.bundled);
  for (const isPackaged of [undefined, null, 'false'])
    assert.equal(
      f.bridge({ isPackaged }).resolveHelperPath(),
      fs.realpathSync(f.bundled),
    );
});
test('missing or relative resources never become CWD-relative candidates', (t) => {
  const f = fixture(t);
  [f.development, f.decoy].forEach(f.put);
  for (const resourcesPath of [undefined, null, '', 'resources', '.', 123])
    assert.equal(f.bridge({ resourcesPath }).resolveHelperPath(), '');
});
test('development uses only the source-anchored helper, even with a bundled helper present', (t) => {
  const f = fixture(t);
  [f.bundled, f.decoy].forEach(f.put);
  assert.equal(f.bridge({ isPackaged: false }).resolveHelperPath(), '');
  f.put(f.development);
  assert.equal(
    f.bridge({ isPackaged: false }).resolveHelperPath(),
    fs.realpathSync(f.development),
  );
  assert.equal(
    f
      .bridge({ isPackaged: false, mainDirectory: 'relative/app/main' })
      .resolveHelperPath(),
    '',
  );
});
test('real launch-directory changes and development environment variables cannot alter selection', (t) => {
  const f = fixture(t);
  [f.bundled, f.development, f.decoy].forEach(f.put);
  const script = `const {createWindowsStoreBridge}=require(process.argv[1]); console.log(createWindowsStoreBridge(JSON.parse(process.argv[2])).resolveHelperPath());`;
  for (const cwd of [f.currentDirectory, f.mainDirectory])
    for (const isPackaged of [true, false]) {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          script,
          require.resolve('../../app/main/windows-store-bridge'),
          JSON.stringify({
            isPackaged,
            resourcesPath: f.resourcesPath,
            mainDirectory: f.mainDirectory,
          }),
        ],
        {
          cwd,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'development',
            SOAPY_DEV_EDITION: 'windows-store',
            SOAPY_DEV_ENTITLEMENT: 'monthly',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout.trim(),
        fs.realpathSync(isPackaged ? f.bundled : f.development),
      );
    }
});
test('directories masquerading as executables and filesystem failures are unavailable', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.bundled, { recursive: true });
  assert.equal(f.bridge().resolveHelperPath(), '');
  fs.rmdirSync(f.bundled);
  f.put(f.bundled);
  for (const method of ['lstatSync', 'realpathSync']) {
    const fsImpl = {
      ...fs,
      [method]() {
        throw Object.assign(new Error('permission'), { code: 'EACCES' });
      },
    };
    assert.equal(f.bridge({ fsImpl }).resolveHelperPath(), '');
  }
});
test('helper directory symlinks and Windows junctions cannot redirect to another executable', (t) => {
  const f = fixture(t);
  const outside = path.join(f.root, 'outside');
  f.put(path.join(outside, EXE));
  fs.symlinkSync(
    outside,
    path.dirname(f.bundled),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.equal(f.bridge().resolveHelperPath(), '');
});
test(
  'an executable symlink is unavailable',
  {
    skip:
      process.platform === 'win32'
        ? 'File symlinks require additional Windows privileges; directory junctions are tested separately'
        : false,
  },
  (t) => {
    const f = fixture(t);
    f.put(f.decoy);
    fs.mkdirSync(path.dirname(f.bundled));
    fs.symlinkSync(f.decoy, f.bundled);
    assert.equal(f.bridge().resolveHelperPath(), '');
  },
);
test('canonical containment rejects redirected paths even if type checks appear regular', (t) => {
  const f = fixture(t);
  f.put(f.bundled);
  for (const redirected of [path.dirname(f.bundled), f.bundled]) {
    const fsImpl = {
      ...fs,
      realpathSync(file) {
        return file === redirected
          ? path.join(f.resourcesPath + '-outside', path.basename(file))
          : fs.realpathSync(file);
      },
    };
    assert.equal(f.bridge({ fsImpl }).resolveHelperPath(), '');
  }
});
test('successful queries and purchases retain wire shapes, handles, and timeouts with a fixed child CWD', async (t) => {
  const f = fixture(t);
  f.put(f.bundled);
  const calls = [];
  const bridge = f.bridge({
    execFileImpl(file, args, options, done) {
      calls.push({ file, args, options });
      done(
        null,
        JSON.stringify(
          args[0] === 'query'
            ? { ok: true, products: { item: { owned: true } } }
            : { ok: true, status: 'Succeeded' },
        ),
      );
      return { kill() {} };
    },
  });
  assert.deepEqual(await bridge.queryEntitlements({ productIds: ['item'] }), {
    ok: true,
    products: { item: { owned: true } },
  });
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(12345n);
  assert.deepEqual(
    await bridge.purchaseProduct({ productId: 'item', windowHandle: handle }),
    { ok: true, status: 'Succeeded', error: '', errorCode: '' },
  );
  assert.deepEqual(
    calls.map((c) => JSON.parse(Buffer.from(c.args[1], 'base64'))),
    [{ productIds: ['item'] }, { productId: 'item', windowHandle: 12345 }],
  );
  assert.deepEqual(
    calls.map((c) => c.options.timeout),
    [STORE_QUERY_TIMEOUT_MS, STORE_PURCHASE_TIMEOUT_MS],
  );
  for (const call of calls) {
    assert.equal(call.file, fs.realpathSync(f.bundled));
    assert.equal(call.options.cwd, path.dirname(call.file));
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
  }
});
test('spawn failures and invalid responses never retry a different executable', async (t) => {
  const f = fixture(t);
  [f.bundled, f.development, f.decoy].forEach(f.put);
  for (const behavior of ['throw', 'ENOENT', 'EACCES', 'timeout', 'invalid']) {
    const calls = [];
    const bridge = f.bridge({
      execFileImpl(file, _args, _options, done) {
        calls.push(file);
        if (behavior === 'throw') throw new Error('spawn failed');
        if (behavior === 'invalid') done(null, 'not json');
        else
          done(
            Object.assign(new Error(behavior), {
              code: behavior,
              killed: behavior === 'timeout',
            }),
            '',
          );
        return { kill() {} };
      },
    });
    await assert.rejects(
      bridge.queryEntitlements(),
      behavior === 'timeout'
        ? /did not respond in time/
        : behavior === 'invalid'
          ? /invalid response/
          : /could not complete/,
    );
    assert.deepEqual(calls, [fs.realpathSync(f.bundled)]);
  }
});
test('purchase concurrency, error details, and shutdown child cleanup remain intact', async (t) => {
  const f = fixture(t);
  f.put(f.bundled);
  let done,
    killed = 0;
  const proc = new EventEmitter();
  const bridge = f.bridge({
    processObject: proc,
    execFileImpl(_file, _args, _opts, callback) {
      done = callback;
      return {
        kill() {
          killed++;
        },
      };
    },
  });
  const first = bridge.purchaseProduct({ productId: 'item' });
  assert.equal(
    (await bridge.purchaseProduct({ productId: 'item' })).status,
    'InProgress',
  );
  const rejected = assert.rejects(first, {
    name: 'StoreBridgeError',
    storeStatus: 'NotPurchased',
    storeErrorCode: 'Canceled',
  });
  done(
    null,
    JSON.stringify({
      ok: false,
      status: 'NotPurchased',
      errorCode: 'Canceled',
    }),
  );
  await rejected;
  const second = bridge.queryEntitlements();
  proc.emit('exit');
  assert.equal(killed, 1);
  done(null, '{"ok":true}');
  await second;
  const third = bridge.queryEntitlements();
  bridge.dispose();
  assert.equal(killed, 2);
  assert.equal(proc.listenerCount('exit'), 0);
  done(null, '{"ok":true}');
  await third;
});
