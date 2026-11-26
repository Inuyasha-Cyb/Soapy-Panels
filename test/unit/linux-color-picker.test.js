const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHex, rgbToHex, rgbToHsv, hsvToRgb } = require('../../app/renderer/src/ui/linux-color-picker');

test('color popup accepts HEX shorthand and rejects invalid colors', () => {
  assert.deepEqual(parseHex(' #aBc '), [170, 187, 204]);
  assert.equal(rgbToHex(parseHex('123456')), '#123456');
  for (const value of ['', '#abcd', '#12345g', '#12345678']) assert.equal(parseHex(value), null);
  for (const rgb of [[-1, 0, 0], [256, 0, 0], [NaN, 0, 0], [0, 0], null]) assert.equal(rgbToHex(rgb), null);
});
test('HSV conversion preserves primary, grayscale and arbitrary sampled colors', () => {
  for (const color of ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#123456', '#35a06c']) {
    assert.equal(rgbToHex(hsvToRgb(rgbToHsv(parseHex(color)))), color);
  }
  assert.equal(rgbToHex(hsvToRgb([360, 1, 1])), '#ff0000');
});
