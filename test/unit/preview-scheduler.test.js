const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler, createQuality, createMetrics, frameDue } = require('../../app/renderer/src/images/preview-scheduler');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('dispatcher bounds work, replaces pending requests and fairly dispatches layers', async () => {
  const scheduler = createScheduler();
  const order = [];
  let release;
  const a = scheduler.schedule('a', () => new Promise(resolve => { release = resolve; order.push('a1'); }));
  await tick();
  const obsolete = scheduler.schedule('a', () => order.push('obsolete'));
  const b = scheduler.schedule('b', () => order.push('b'));
  const latest = scheduler.schedule('a', () => order.push('a2'));
  assert.equal(await obsolete, null);
  assert.deepEqual(scheduler.snapshot(), { active: 1, pending: 2, paused: false });
  release();
  await Promise.all([a, b, latest]);
  await tick();
  assert.deepEqual(order, ['a1', 'a2', 'b']);
  assert.equal(scheduler.snapshot().pending, 0);
});

test('hidden scheduling pauses captures; cancellation settles waiters; errors release dispatcher', async () => {
  const scheduler = createScheduler();
  scheduler.setPaused(true);
  let ran = false;
  const cancelled = scheduler.schedule('gone', () => { ran = true; });
  scheduler.cancel('gone');
  assert.equal(await cancelled, null);
  const failure = scheduler.schedule('bad', () => { throw new Error('worker failed'); });
  const rejected = assert.rejects(failure, /worker failed/);
  const next = scheduler.schedule('live', () => 42);
  await tick();
  assert.equal(ran, false);
  assert.equal(scheduler.snapshot().active, 0);
  scheduler.setPaused(false);
  await rejected;
  assert.equal(await next, 42);
});

test('adaptive quality has hysteresis, bounded steps and sharp paused frames', () => {
  const quality = createQuality(960);
  assert.equal(quality.dimension(4000, 2000, false), 960);
  for (let i = 0; i < 4; i++) quality.observe(45);
  assert.equal(quality.current(), 960);
  quality.observe(45);
  assert.equal(quality.current(), 720);
  assert.equal(quality.dimension(4000, 2000, true), 960);
  assert.equal(quality.dimension(200, 2000, true), 200);
  assert.equal(quality.dimension(4000, 150, false), 150);
  for (let i = 0; i < 89; i++) quality.observe(10);
  assert.equal(quality.current(), 720);
  quality.observe(10);
  assert.equal(quality.current(), 960);
  for (let i = 0; i < 100; i++) quality.observe(50);
  assert.equal(quality.current(), 360);
});

test('metrics are opt-in and bounded', () => {
  const metrics = createMetrics(2);
  metrics.record('drawMs', 100);
  assert.deepEqual(metrics.snapshot(), {});
  metrics.enable();
  [100, 10, 20].forEach(value => metrics.record('drawMs', value));
  assert.deepEqual(metrics.snapshot().drawMs, { count: 2, mean: 15, p95: 20, max: 20 });
  metrics.reset();
  assert.deepEqual(metrics.snapshot(), {});
});


test('media-time limiting preserves 30 FPS despite callback jitter and skips alternate 60 FPS frames', () => {
  assert.equal(frameDue(undefined, 0, true, false), true);
  assert.equal(frameDue(0, 33.333, true, false), true);
  assert.equal(frameDue(33.333, 66.667, true, false), true);
  assert.equal(frameDue(0, 16.667, true, false), false);
  assert.equal(frameDue(0, 0, true, false), false);
  assert.equal(frameDue(1900, 0, true, false), true);
  assert.equal(frameDue(0, 0, false, false), true);
  assert.equal(frameDue(0, 0, true, true), true);
});
