const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createController,
  STORAGE_KEY,
} = require('../../app/renderer/src/selection/alignment-controller');
const bubbles = [
  { id: 'm', x: 200, y: 200, w: 80, h: 60 },
  { id: 'a', x: 100, y: 100, w: 80, h: 60 },
];
const initial = {
  bubbles,
  movingIds: ['m'],
  canvas: { w: 1000, h: 800 },
  pointerId: 5,
  selectionId: 'm',
};
const move = {
  dx: -96,
  dy: -96,
  scale: { sx: 1, sy: 1 },
  pointerId: 5,
  selectionId: 'm',
};
test('defaults, persisted modes and storage failures', () => {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
  };
  const controller = createController({ storage });
  assert.equal(controller.getMode(), 'guides');
  controller.begin(initial);
  assert.deepEqual(controller.update(move), { dx: -96, dy: -96 });
  assert.equal(controller.inspect().guides.length, 2);
  for (const mode of ['off', 'snap', 'guides']) {
    controller.setMode(mode);
    assert.equal(saved.get(STORAGE_KEY), mode);
    assert.equal(createController({ storage }).getMode(), mode);
  }
  assert.equal(
    createController({
      storage: {
        getItem() {
          throw new Error();
        },
      },
    }).getMode(),
    'guides',
  );
  saved.set(STORAGE_KEY, 'invalid');
  assert.equal(createController({ storage }).getMode(), 'guides');
});
test('targets prepare once, all modes use raw translation, modifier toggles have no accumulated drift', () => {
  const before = JSON.stringify(bubbles);
  const controller = createController();
  controller.setMode('snap');
  controller.begin(initial);
  assert.deepEqual(controller.update(move), { dx: -100, dy: -100 });
  assert.deepEqual(controller.update({ ...move, bypass: true }), {
    dx: -96,
    dy: -96,
  });
  assert.equal(controller.inspect().guides.length, 2);
  assert.deepEqual(controller.update(move), { dx: -100, dy: -100 });
  controller.setMode('guides');
  assert.deepEqual(controller.update(move), { dx: -96, dy: -96 });
  assert.equal(controller.inspect().guides.length, 2);
  controller.setMode('off');
  assert.deepEqual(controller.update(move), { dx: -96, dy: -96 });
  assert.equal(controller.inspect().guides.length, 0);
  assert.equal(controller.inspect().preparations, 1);
  assert.equal(JSON.stringify(bubbles), before);
});
test('release, cancellation, lost capture and document resets clear transient guides', () => {
  const controller = createController();
  for (const end of [
    () => controller.end(5),
    () => controller.clear(),
    () => controller.selectionChanged('a'),
  ]) {
    controller.begin(initial);
    controller.update(move);
    end();
    assert.equal(controller.inspect().active, false);
    assert.equal(controller.inspect().guides.length, 0);
  }
  controller.begin(initial);
  controller.end(99);
  assert.equal(controller.inspect().active, true);
  controller.update({ ...move, selectionId: 'a' });
  assert.equal(controller.inspect().active, false);
});
