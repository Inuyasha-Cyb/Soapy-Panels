const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require.resolve('../../app/renderer/src/images/effects-runtime'), 'utf8');
function setup() {
  const workers = [];
  const bitmaps = [];
  const root = {
    createImageBitmap: async () => {
      const bitmap = { width: 32, height: 32, closed: 0, close() { this.closed++; } };
      bitmaps.push(bitmap);
      return bitmap;
    },
    Worker: class {
      constructor() { this.events = {}; this.messages = []; workers.push(this); }
      addEventListener(name, callback) { this.events[name] = callback; }
      postMessage(message) { this.messages.push(message); }
      terminate() {}
      reply(index, bitmap) { this.events.message({ data: { id: this.messages[index].id, ok: true, bitmap } }); }
    },
  };
  const context = { self: root, performance, module: { exports: {} } };
  vm.runInNewContext(script, context);
  return { processor: context.module.exports.createProcessor(), workers, bitmaps };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = () => ({ closed: 0, close() { this.closed++; } });

test('cancelled and superseded results close their bitmaps without replacing the latest result', async () => {
  const { processor, workers } = setup();
  const first = processor.process({}, {}, { key: 'entry' });
  await tick();
  processor.cancel('entry');
  const second = processor.process({}, {}, { key: 'entry' });
  await tick();
  const stale = result();
  const latest = result();
  workers[0].reply(0, stale);
  workers[0].reply(1, latest);
  assert.equal(await first, null);
  assert.equal(await second, latest);
  assert.equal(stale.closed, 1);
  assert.equal(latest.closed, 0);
  processor.destroy();
});

test('cancellation during capture never posts obsolete work', async () => {
  const { processor, workers, bitmaps } = setup();
  const promise = processor.process({}, {}, { key: 'entry' });
  processor.cancel('entry');
  assert.equal(await promise, null);
  assert.equal(workers.length, 0);
  assert.equal(bitmaps[0].closed, 1);
});

test('worker failures settle pending jobs and destroy closes late results', async () => {
  const { processor, workers } = setup();
  const promise = processor.process({}, {}, { key: 'entry' });
  const rejection = assert.rejects(promise, /failed/);
  await tick();
  workers[0].events.error({ message: 'worker failed' });
  await rejection;
  const late = result();
  workers[0].reply(0, late);
  assert.equal(late.closed, 1);
  processor.destroy();
});
