const test = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshots } = require('../../app/renderer/src/project/snapshots');
test('snapshot detaches fields before asynchronous conversion and caches immutable source bytes', async () => {
  const blob = new Blob(['pixels']);
  let conversions = 0;
  const state = {
    bg: { w: 1280, h: 720 },
    bubbles: [{ text: 'before' }],
    savedStyles: [],
  };
  const images = [{ id: 'image', src: 'blob:test', x: 1 }];
  const snapshots = createSnapshots({
    getState: () => state,
    normalizePaintMask: (x) => x,
    serializeBackgroundImages: () => images,
    getBlob: () => blob,
    blobToDataUrl: async () => {
      conversions++;
      return 'data:image/png;base64,YQ==';
    },
    mimeType: 'application/json',
  });
  const capture = snapshots.capture();
  state.bubbles[0].text = 'after';
  images[0].x = 2;
  const output = JSON.parse(await (await snapshots.toBlob(capture)).text());
  assert.equal(output.bubbles[0].text, 'before');
  assert.equal(output.bg.images[0].x, 1);
  assert.ok(output.bg.images[0].src.startsWith('data:'));
  await snapshots.toBlob(snapshots.capture());
  assert.equal(conversions, 1);
});

test('lazy render defaults and object key order do not create false unsaved edits', () => {
  const state = { bg: {}, bubbles: [{ text: 'same' }], savedStyles: [] };
  const snapshots = createSnapshots({
    getState: () => state,
    normalizePaintMask: (x) => x,
    serializeBackgroundImages: () => [],
  });
  const before = snapshots.takeProjectSnapshot();
  state.bubbles[0].strokeGradient = null;
  state.bubbles[0].textVertical = false;
  assert.equal(snapshots.takeProjectSnapshot(), before);
  state.bubbles[0].text = 'real edit';
  assert.notEqual(snapshots.takeProjectSnapshot(), before);
});
