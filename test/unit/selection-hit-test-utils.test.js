const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSelectionFallbackHit } = require('../../app/renderer/src/selection-hit-test-utils');

test('resolveSelectionFallbackHit prefers a bubble fallback when the primary hit is missing', () => {
  const bubbleHit = { b: { id: 'bubble-1' }, part: 'move' };
  const stickerHit = { bgImage: { id: 'sticker-1' }, part: 'bg-image' };

  const hit = resolveSelectionFallbackHit(null, 10, 20, {
    getBubbleHit: () => bubbleHit,
    getStickerHit: () => stickerHit,
  });

  assert.equal(hit, bubbleHit);
});

test('resolveSelectionFallbackHit falls back to a sticker hit when no bubble hit is available', () => {
  const stickerHit = { bgImage: { id: 'sticker-2' }, part: 'bg-image' };

  const hit = resolveSelectionFallbackHit(null, 10, 20, {
    getBubbleHit: () => null,
    getStickerHit: () => stickerHit,
  });

  assert.equal(hit, stickerHit);
});
