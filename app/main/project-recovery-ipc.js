const { IPC_CHANNELS } = require('../shared/ipc-channels');
function registerRecoveryIpc(trustedIpc, store) {
  const observed = new WeakSet();
  function renderer(event) {
    if (!observed.has(event.sender)) {
      observed.add(event.sender);
      const id = event.sender.id;
      event.sender.once('destroyed', () => {
        void store.releaseRenderer(id).catch(() => {});
      });
      event.sender.on('render-process-gone', () => {
        void store.releaseRenderer(id).catch(() => {});
      });
      event.sender.on(
        'did-start-navigation',
        (_event, _url, inPlace, mainFrame) => {
          if (mainFrame && !inPlace)
            void store.releaseRenderer(id).catch(() => {});
        },
      );
    }
    return event.sender.id;
  }
  const handlers = {
    RECOVERY_START: (event) => store.start(renderer(event)),
    RECOVERY_LIST: (event, query) => store.list(query, renderer(event)),
    RECOVERY_CLAIM: (event, id) => store.claim(renderer(event), id),
    RECOVERY_READ: (event, id) => store.read(renderer(event), id),
    RECOVERY_WRITE: (event, id, value) =>
      store.write(renderer(event), id, value),
    RECOVERY_CLEAR: (event, id, value) =>
      store.clearThrough(renderer(event), id, value),
    RECOVERY_DISCARD: (event, id) => store.discard(renderer(event), id),
    RECOVERY_RELEASE: (event, id) => store.release(renderer(event), id),
  };
  for (const [key, handler] of Object.entries(handlers)) {
    trustedIpc.handle(IPC_CHANNELS[key], async (...args) => {
      try {
        return { ok: true, value: await handler(...args) };
      } catch (error) {
        return {
          ok: false,
          error: {
            code:
              typeof error.code === 'string' &&
              error.code.startsWith('RECOVERY_')
                ? error.code
                : 'RECOVERY_IO',
            message: error.message || 'Recovery unavailable',
          },
        };
      }
    });
  }
}
module.exports = { registerRecoveryIpc };
