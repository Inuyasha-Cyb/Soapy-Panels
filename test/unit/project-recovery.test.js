const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecovery } = require('../../app/renderer/src/project/recovery');
const { createLifecycle } = require('../../app/renderer/src/project/lifecycle');
function fixture(overrides = {}) {
  let value = 'initial';
  let time = 0;
  let next = 1;
  let busy = false;
  const timers = new Map(),
    writes = [],
    statuses = [],
    clears = [],
    discarded = [];
  const snapshots = {
    takeProjectSnapshot: () => value,
    capture: () => ({ snapshot: value, data: value }),
    toBlob: async (capture) =>
      new Blob([JSON.stringify({ text: capture.data })]),
    ...overrides.snapshots,
  };
  const lifecycle = createLifecycle({ snapshots });
  lifecycle.initialize();
  const api = {
    recoveryStart: async () => 'session',
    recoveryWrite: async (id, value) => {
      writes.push(value);
      return true;
    },
    recoveryClear: async (_, value) => clears.push(value),
    recoveryDiscard: async (id) => discarded.push(id),
    ...overrides.api,
  };
  const recovery = createRecovery({
    api,
    lifecycle,
    snapshots,
    isBusy: () => busy,
    status: (key) => statuses.push(key),
    now: () => time,
    setTimer: (fn, delay) => {
      const id = next++;
      timers.set(id, { fn, at: time + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  lifecycle.setRecovery(recovery);
  async function advance(ms) {
    time += ms;
    for (const [id, item] of [...timers])
      if (item.at <= time) {
        timers.delete(id);
        item.fn();
      }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return {
    recovery,
    lifecycle,
    writes,
    statuses,
    clears,
    discarded,
    advance,
    timers,
    edit(text) {
      value = text;
      lifecycle.observe();
    },
    busy(value) {
      busy = value;
    },
  };
}
test('debounces edits, suppresses unchanged state and saves by the maximum delay', async () => {
  const f = fixture();
  f.edit('one');
  await f.advance(4999);
  assert.equal(f.writes.length, 0);
  await f.advance(1);
  assert.equal(f.writes.length, 1);
  f.lifecycle.observe();
  await f.advance(30000);
  assert.equal(f.writes.length, 1);
  for (let i = 0; i < 8; i++) {
    f.edit('continuous' + i);
    await f.advance(4000);
  }
  assert.equal(f.writes.length, 2);
});
test('defers capture during gestures and restoration', async () => {
  const f = fixture();
  f.busy(true);
  f.edit('one');
  await f.advance(5000);
  assert.equal(f.writes.length, 0);
  f.busy(false);
  f.lifecycle.setTransitioning(true);
  await f.advance(250);
  assert.equal(f.writes.length, 0);
  f.lifecycle.setTransitioning(false);
  await f.advance(250);
  assert.equal(f.writes.length, 1);
});
test('failed writes preserve status and retry after thirty seconds', async () => {
  let attempts = 0;
  const f = fixture({
    api: {
      recoveryWrite: async () => {
        if (++attempts === 1) throw new Error('disk full');
        return true;
      },
    },
  });
  f.edit('one');
  await f.advance(5000);
  assert.equal(f.statuses.at(-1), 'unavailable');
  f.edit('two');
  await f.advance(29999);
  assert.equal(attempts, 1);
  await f.advance(1);
  assert.equal(attempts, 2);
  assert.equal(f.statuses.at(-1), 'updated');
});
test('single capture in flight, detached content, coalesced edits', async () => {
  let finish;
  const f = fixture({
    snapshots: {
      toBlob: (capture) =>
        new Promise((resolve) => {
          finish = () =>
            resolve(new Blob([JSON.stringify({ text: capture.data })]));
        }),
    },
  });
  f.edit('one');
  const pending = f.recovery.flush();
  await new Promise((resolve) => setImmediate(resolve));
  f.edit('two');
  f.recovery.flush();
  finish();
  await pending;
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].project.text, 'one');
  const second = f.recovery.flush();
  await new Promise((resolve) => setImmediate(resolve));
  finish();
  await second;
  assert.equal(f.writes[1].project.text, 'two');
});
test('document replacement fences an unfinished conversion and late writes', async () => {
  let finish;
  const f = fixture({
    snapshots: {
      toBlob: () =>
        new Promise((resolve) => {
          finish = () => resolve(new Blob(['{}']));
        }),
    },
  });
  f.edit('one');
  const pending = f.recovery.flush();
  await new Promise((resolve) => setImmediate(resolve));
  const replacement = f.lifecycle.replace('new');
  finish();
  await Promise.all([pending, replacement]);
  assert.equal(f.writes.length, 0);
  assert.equal(f.discarded.length, 1);
});
test('save clears only its revision and schedules edits made while saving', async () => {
  const f = fixture();
  f.edit('one');
  const capture = f.lifecycle.capture();
  f.edit('two');
  await f.lifecycle.saved(capture);
  assert.equal(f.clears[0].revision, 1);
  await f.advance(5000);
  assert.equal(f.writes[0].revision, 2);
});
test('undo back to the actual saved baseline clears an obsolete recovery', async () => {
  const f = fixture();
  f.edit('changed');
  await f.recovery.flush();
  assert.equal(f.writes.length, 1);
  f.edit('initial');
  await f.advance(5000);
  assert.equal(f.clears.length, 1);
  assert.equal(f.recovery.state().written, '');
});

test('cleanup retry from an outgoing document cannot stall recovery in a new one', async () => {
  let rejectClear;
  const f = fixture({
    api: {
      recoveryClear: () =>
        new Promise((_, reject) => {
          rejectClear = reject;
        }),
    },
  });
  f.edit('old');
  const capture = f.lifecycle.capture();
  const clearing = f.lifecycle.saved(capture);
  await new Promise((resolve) => setImmediate(resolve));
  await f.lifecycle.replace('new');
  rejectClear(new Error('old cleanup failed'));
  await clearing;
  f.edit('new edit');
  await f.advance(5000);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].project.text, 'new edit');
});

for (const code of [
  'RECOVERY_SIZE_LIMIT',
  'RECOVERY_STORAGE_LIMIT',
  'RECOVERY_SESSION_LIMIT',
]) {
  test(`${code} pauses automatic attempts until explicit retry`, async () => {
    let attempts = 0;
    const f = fixture({
      api: {
        recoveryWrite: async () => {
          if (++attempts === 1) throw new Error(`[${code}] quota`);
          return true;
        },
      },
    });
    f.edit('one');
    await f.advance(5000);
    assert.equal(f.recovery.state().pausedCode, code);
    f.edit('two');
    await f.advance(120000);
    assert.equal(attempts, 1);
    assert.equal(f.timers.size, 0);
    await f.recovery.retry();
    assert.equal(attempts, 2);
    assert.equal(f.recovery.state().pausedCode, '');
    assert.equal(f.statuses.at(-1), 'updated');
  });
}
test('saving after session-capacity failure clears a retained backup without allocating another session', async () => {
  let starts = 0;
  const f = fixture({
    api: {
      recoveryStart: async () => {
        starts++;
        throw Object.assign(new Error('full'), {
          code: 'RECOVERY_SESSION_LIMIT',
        });
      },
    },
  });
  f.recovery.retainClaim('backup');
  f.edit('recovered');
  await f.recovery.flush();
  assert.equal(starts, 1);
  await f.lifecycle.saved(f.lifecycle.capture());
  assert.deepEqual(f.discarded, ['backup']);
  assert.equal(starts, 1);
  await f.recovery.close();
});

test('explicit retry reestablishes recovery for an unchanged document after capacity is freed', async () => {
  let attempts = 0;
  const f = fixture({
    api: {
      recoveryStart: async () => {
        if (++attempts === 1) throw new Error('[RECOVERY_SESSION_LIMIT] full');
        return 'new-session';
      },
    },
  });
  await assert.rejects(f.recovery.start());
  await f.advance(120000);
  assert.equal(attempts, 1);
  await f.recovery.retry();
  assert.equal(attempts, 2);
  assert.equal(f.recovery.state().session, 'new-session');
  assert.equal(f.statuses.at(-1), '');
  assert.equal(f.writes.length, 0);
});
test('capacity failure during save cleanup pauses instead of scheduling a retry loop', async () => {
  let attempts = 0;
  const f = fixture({
    api: {
      recoveryStart: async () => {
        attempts++;
        throw new Error('[RECOVERY_SESSION_LIMIT] full');
      },
    },
  });
  f.edit('saved');
  await f.lifecycle.saved(f.lifecycle.capture());
  assert.equal(f.recovery.state().pausedCode, 'RECOVERY_SESSION_LIMIT');
  await f.advance(120000);
  assert.equal(attempts, 1);
  assert.equal(f.timers.size, 0);
});
