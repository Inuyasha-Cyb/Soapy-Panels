const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bridgeModule = require('../../app/main/windows-store-bridge');
const {
  createMonetizationStore,
} = require('../../app/main/monetization-store');
const {
  MONETIZATION_PRODUCTS: PRODUCTS,
} = require('../../app/shared/monetization-products');
function fixture(t, cached) {
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'soapy-store-unavailable-'),
  );
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const cachePath = path.join(profile, 'monetization-cache.json');
  if (cached) fs.writeFileSync(cachePath, JSON.stringify(cached));
  let spawns = 0;
  const bridge = bridgeModule.createWindowsStoreBridge({
    isPackaged: true,
    resourcesPath: path.join(profile, 'missing-resources'),
    logMainImpl() {},
    execFileImpl() {
      spawns++;
      throw new Error('unexpected spawn');
    },
  });
  t.after(() => bridge.dispose());
  return {
    store: createMonetizationStore({ userDataPath: profile, bridge }),
    cachePath,
    spawns: () => spawns,
  };
}
test('missing helper reports Store unavailability and failed purchases without creating entitlements', async (t) => {
  const f = fixture(t);
  assert.deepEqual(f.store.getStartupState(), {
    source: 'none',
    monetizationStatus: null,
  });
  const status = await f.store.queryStatus();
  assert.equal(status.source, 'unavailable');
  assert.equal(status.available, false);
  assert.equal(status.hasActivePlus, false);
  assert.equal(status.ownsRemoveAds, false);
  assert.match(status.error, /not available in this build/);
  const purchase = await f.store.purchase(
    PRODUCTS.REMOVE_ADS_LIFETIME,
    Buffer.alloc(8),
  );
  assert.equal(purchase.ok, false);
  assert.equal(purchase.status.available, false);
  assert.equal(f.spawns(), 0);
  assert.equal(fs.existsSync(f.cachePath), false);
});
test('helper failure preserves durable and unexpired cached entitlements without rewriting the cache', async (t) => {
  const cached = {
    checkedAt: '2026-01-01T00:00:00.000Z',
    products: {
      [PRODUCTS.REMOVE_ADS_LIFETIME]: { owned: true, active: true },
      [PRODUCTS.SOAPY_PLUS_MONTHLY]: {
        owned: true,
        active: true,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    },
  };
  const f = fixture(t, cached),
    before = fs.readFileSync(f.cachePath, 'utf8');
  for (const status of [
    f.store.getStartupState().monetizationStatus,
    await f.store.queryStatus(),
    (await f.store.purchase(PRODUCTS.SOAPY_PLUS_MONTHLY, Buffer.alloc(8)))
      .status,
  ]) {
    assert.equal(status.source, 'cache');
    assert.equal(status.available, false);
    assert.equal(status.ownsRemoveAds, true);
    assert.equal(status.hasActivePlus, true);
    assert.equal(status.checkedAt, cached.checkedAt);
  }
  assert.equal(fs.readFileSync(f.cachePath, 'utf8'), before);
  assert.equal(f.spawns(), 0);
  cached.products[PRODUCTS.SOAPY_PLUS_MONTHLY].expiresAt =
    '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(f.cachePath, JSON.stringify(cached));
  const expired = await f.store.queryStatus();
  assert.equal(expired.hasActivePlus, false);
  assert.equal(expired.ownsRemoveAds, true);
});
test('monetization construction forwards main-process packaging context to the bridge factory', (t) => {
  const received = [];
  t.mock.method(bridgeModule, 'createWindowsStoreBridge', (options) => {
    received.push(options);
    return { queryEntitlements() {} };
  });
  for (const isPackaged of [true, false, undefined, null]) {
    const resourcesPath = path.join(os.tmpdir(), 'trusted resources');
    createMonetizationStore({ isPackaged, resourcesPath });
    assert.deepEqual(received.at(-1), { isPackaged, resourcesPath });
  }
});
