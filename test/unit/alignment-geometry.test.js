const test = require('node:test');
const assert = require('node:assert/strict');
const { performance: perf } = require('node:perf_hooks');
const g = require('../../app/renderer/src/selection/alignment-geometry');
const bubble = (id, x, y, w = 100, h = 60, extra = {}) => ({
  id,
  x,
  y,
  w,
  h,
  ...extra,
});
function scene(bubbles, canvas = null, movingIds = ['m']) {
  const prepared = g.prepareTargets(bubbles, movingIds, canvas);
  return (dx, dy = 0, options = {}) =>
    g.resolve({
      movingBounds: prepared.movingBounds,
      translation: { dx, dy },
      prepared,
      ...options,
    });
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('body bounds rotate around the body center and ignore tails, shadows, and strokes', () => {
  const bounds = g.bodyBounds(
    bubble('a', 10, 20, 100, 40, {
      rot: 90,
      tail: { lx: 1000 },
      strokeWidth: 99,
      shadowBlur: 99,
    }),
  );
  near(bounds.l, 40);
  near(bounds.r, 80);
  near(bounds.t, -10);
  near(bounds.b, 90);
  assert.equal(
    g.bodyBounds(bubble('tail', 0, 0, 2000, 2000, { tailOnly: true })),
    null,
  );
});
test('edge/center alignment, canvas anchors, and independent axes', () => {
  const solve = scene([bubble('m', 300, 300), bubble('a', 100, 100)], {
    w: 1000,
    h: 800,
  });
  let result = solve(-196, -196);
  near(result.translation.dx, -200);
  near(result.translation.dy, -200);
  assert.equal(result.guides.length, 2);
  result = solve(146, 66);
  near(result.translation.dx, 150);
  near(result.translation.dy, 70);
  assert.equal(result.guides[0].priority, 0);
  result = solve(-296, 0);
  near(result.translation.dx, -300);
});
test('6px entry and 9px release thresholds use actual scale on each axis', () => {
  const solve = scene([bubble('m', 200, 200), bubble('a', 100, 100)]);
  const first = solve(-98, -98, { scale: { sx: 2, sy: 3 } });
  near(first.translation.dx, -100);
  near(first.translation.dy, -100);
  const held = solve(-96, -98, {
    scale: { sx: 2, sy: 3 },
    previous: first.state,
  });
  near(held.translation.dx, -100);
  const released = solve(-95, -96, {
    scale: { sx: 2, sy: 3 },
    previous: held.state,
  });
  near(released.translation.dx, -95);
  near(released.translation.dy, -96);
});
test('connected components use body unions and exclude all moving members including attached tails', () => {
  const prepared = g.prepareTargets(
    [
      bubble('m', 0, 0, 100, 60, { mergedWith: ['n'] }),
      bubble('n', 120, 0),
      bubble('tail', -500, -500, 2000, 2000, {
        tailOnly: true,
        extraTailAutoTargetId: 'm',
      }),
      bubble('a', 500, 0, 100, 60, { mergedWith: ['b'] }),
      bubble('b', 620, 0),
    ],
    ['m', 'n', 'tail'],
    null,
  );
  assert.deepEqual(prepared.movingBounds, { l: 0, t: 0, r: 220, b: 60 });
  assert.equal(prepared.targets.length, 1);
  assert.deepEqual(prepared.targets[0].bounds, { l: 500, t: 0, r: 720, b: 60 });
});
test('equal spacing centers between neighbors and repeats their gap before/after', () => {
  const solve = scene([
    bubble('m', 0, 10, 80, 40),
    bubble('a', 200, 0),
    bubble('b', 500, 0),
  ]);
  for (const [proposed, expected, placement, gap] of [
    [356, 360, 'between', 60],
    [-84, -80, 'before', 200],
    [796, 800, 'after', 200],
  ]) {
    const result = solve(proposed);
    near(result.translation.dx, expected);
    const guide = result.guides.find((item) => item.axis === 'x');
    assert.equal(guide.kind, 'spacing');
    assert.equal(guide.placement, placement);
    near(guide.gap, gap);
  }
  const vertical = scene([
    bubble('m', 10, 0, 40, 80),
    bubble('a', 0, 200, 60, 100),
    bubble('b', 0, 500, 60, 100),
  ]);
  near(vertical(0, 356).translation.dy, 360);
});
test('overlapping targets, disconnected rows, and insufficient room do not create midpoint spacing', () => {
  for (const [x, y] of [
    [250, 0],
    [500, 200],
    [350, 0],
  ]) {
    const solve = scene([
      bubble('m', 0, 10, 80, 40),
      bubble('a', 200, 0),
      bubble('b', x, y),
    ]);
    const result = solve((300 + x - 80) / 2);
    assert.equal(
      result.guides.some(
        (item) =>
          item.axis === 'x' &&
          item.kind === 'spacing' &&
          item.placement === 'between',
      ),
      false,
    );
  }
});
test('guides-only and bypass preserve raw translation and stable target selection', () => {
  const solve = scene([
    bubble('m', 200, 200),
    bubble('z', 100, 100),
    bubble('a', 100, 100),
  ]);
  for (const options of [{ snap: false }, { bypass: true }]) {
    const result = solve(-96, -96, options);
    assert.deepEqual(result.translation, { dx: -96, dy: -96 });
    assert.equal(result.guides.length, 2);
    assert.match(result.state.x, /:a:/);
  }
});
test('2,000-bubble scenes use linear candidate evaluation after one preparation', () => {
  const bubbles = Array.from({ length: 2000 }, (_, i) =>
    bubble(String(i), (i % 100) * 130, Math.floor(i / 100) * 90),
  );
  const t0 = perf.now();
  const prepared = g.prepareTargets(bubbles, ['0'], { w: 14000, h: 2000 });
  const prepareMs = perf.now() - t0;
  const t1 = perf.now();
  let maxEvaluations = 0;
  for (let i = 0; i < 200; i++) {
    const result = g.resolve({
      movingBounds: prepared.movingBounds,
      prepared,
      translation: { dx: i * 3, dy: i },
      scale: { sx: 0.5, sy: 0.5 },
    });
    maxEvaluations = Math.max(maxEvaluations, result.evaluations);
  }
  assert.ok(
    maxEvaluations < 2000 * 12,
    `unexpected pair scan: ${maxEvaluations}`,
  );
  console.log(
    `Alignment benchmark: prepare ${prepareMs.toFixed(1)}ms; 200 resolves ${(perf.now() - t1).toFixed(1)}ms; max ${maxEvaluations} candidates`,
  );
});

test('equal-distance ties favor canvas center, then canvas edges over bubble anchors', () => {
  let solve = scene([bubble('m', 0, 300), bubble('a', 300, 100)], {
    w: 1000,
    h: 800,
  });
  let result = solve(400);
  assert.equal(result.guides.find((g) => g.axis === 'x').priority, 0);
  solve = scene([bubble('m', 200, 300), bubble('a', 0, 100)], {
    w: 1000,
    h: 800,
  });
  result = solve(-196);
  assert.equal(result.guides.find((g) => g.axis === 'x').priority, 1);
});

test('repeated spacing cannot place a body into another neighboring target', () => {
  const solve = scene([
    bubble('m', 0, 10, 80, 40),
    bubble('a', 200, 0),
    bubble('b', 500, 0),
    bubble('c', 780, 0),
  ]);
  const result = solve(796);
  assert.equal(
    result.guides.some(
      (g) =>
        g.axis === 'x' &&
        g.kind === 'spacing' &&
        g.placement === 'after' &&
        g.key.includes(':a:b:'),
    ),
    false,
  );
});
