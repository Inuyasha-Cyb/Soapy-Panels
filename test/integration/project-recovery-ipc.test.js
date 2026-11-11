const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrustedIpcRegistrar } = require('../../app/main/trusted-ipc');
const { registerRecoveryIpc } = require('../../app/main/project-recovery-ipc');
const { IPC_CHANNELS } = require('../../app/shared/ipc-channels');
const {
  readPreloadIpcChannels,
} = require('../../tools/checks/preload-ipc-contract');
test('recovery channels reject untrusted IPC before reaching disk', () => {
  const handlers = new Map();
  let calls = 0;
  const ipc = {
    handle: (name, handler) => handlers.set(name, handler),
    on() {},
  };
  const registrar = createTrustedIpcRegistrar(ipc, {
    isTrustedEvent: (event) => event.trusted,
  });
  const store = new Proxy(
    {},
    {
      get: () => () => {
        calls++;
      },
    },
  );
  registerRecoveryIpc(registrar, store);
  for (const handler of handlers.values())
    assert.throws(() => handler({ trusted: false }), /Unauthorized/);
  assert.equal(calls, 0);
  const sender = { id: 1, once() {}, on() {} };
  handlers.get(IPC_CHANNELS.RECOVERY_START)({ trusted: true, sender });
  assert.equal(calls, 1);
  assert.deepEqual(readPreloadIpcChannels(), IPC_CHANNELS);
});

test('recovery IPC returns stable quota errors and releases ownership on lifecycle events', async () => {
  const { EventEmitter } = require('node:events');
  const handlers = new Map(),
    released = [];
  const sender = Object.assign(new EventEmitter(), { id: 17 });
  registerRecoveryIpc(
    { handle: (name, handler) => handlers.set(name, handler) },
    {
      start: async () => {
        throw Object.assign(new Error('Full'), {
          code: 'RECOVERY_SESSION_LIMIT',
        });
      },
      release: async (renderer, id) => ({ renderer, id }),
      releaseRenderer: async (renderer) => {
        released.push(renderer);
      },
    },
  );
  const result = await handlers.get(IPC_CHANNELS.RECOVERY_START)({ sender });
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'RECOVERY_SESSION_LIMIT', message: 'Full' },
  });
  assert.deepEqual(
    await handlers.get(IPC_CHANNELS.RECOVERY_RELEASE)({ sender }, 'session'),
    { ok: true, value: { renderer: 17, id: 'session' } },
  );
  sender.emit('did-start-navigation', {}, 'about:blank', true, true);
  sender.emit('did-start-navigation', {}, 'about:blank', false, false);
  assert.deepEqual(released, []);
  sender.emit('did-start-navigation', {}, 'about:blank', false, true);
  sender.emit('render-process-gone');
  sender.emit('destroyed');
  assert.deepEqual(released, [17, 17, 17]);
});
