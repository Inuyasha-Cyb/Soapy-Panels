const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const effects = require('../../app/renderer/src/images/effects');
const references = require('../fixtures/effects-reference.json');

test('all filters retain pre-optimization pixels, including partial alpha and repeated palettes', () => {
  for (let pass = 0; pass < 3; pass++) {
    for (const { effect, sha256 } of references) {
      const data = Uint8ClampedArray.from({ length: 32 * 32 * 4 }, (_, i) => (i * 73 + Math.floor(i / 17) * 29) % 256);
      effects.processImageData({ width: 32, height: 32, data }, effect);
      assert.equal(nodeCrypto.createHash('sha256').update(data).digest('hex'), sha256, effect.type);
    }
  }
});
