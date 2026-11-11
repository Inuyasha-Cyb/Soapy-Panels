const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canvasPointToPixel,
  canvasPointToScaledPixel,
  rgbaToHex,
  compositeRgba,
} = require("../../app/renderer/src/color-sampler-utils");

test("canvasPointToPixel maps logical points to clamped pixels", () => {
  assert.deepEqual(canvasPointToPixel({ x: 12.9, y: 4.1, inside: true }, 20, 10), { x: 12, y: 4 });
  assert.deepEqual(canvasPointToPixel({ x: -4, y: 99, inside: true }, 20, 10), { x: 0, y: 9 });
  assert.equal(canvasPointToPixel({ x: 1, y: 1, inside: false }, 20, 10), null);
  assert.equal(canvasPointToPixel({ x: 1, y: 1, inside: true }, 0, 10), null);
});

test("rgbaToHex converts RGB channels and ignores alpha", () => {
  assert.equal(rgbaToHex([0, 127.4, 255, 42]), "#007fff");
  assert.equal(rgbaToHex([300, -2, 15.2, 0]), "#ff000f");
  assert.equal(rgbaToHex([1, 2]), null);
  assert.equal(rgbaToHex([1, "bad", 2, 255]), null);
});

test("canvasPointToScaledPixel maps logical points onto a bounded display surface", () => {
  assert.deepEqual(
    canvasPointToScaledPixel({ x: 640, y: 360, inside: true }, 1280, 720, 640, 360),
    { x: 320, y: 180 },
  );
  assert.deepEqual(
    canvasPointToScaledPixel({ x: 1280, y: 720, inside: true }, 1280, 720, 640, 360),
    { x: 639, y: 359 },
  );
  assert.equal(canvasPointToScaledPixel({ x: 1, y: 1, inside: false }, 10, 10, 5, 5), null);
});


test("transparent and translucent pixels resolve against the visible backdrop", () => {
  assert.deepEqual(compositeRgba([255, 0, 0, 0], [20, 40, 60]), [20, 40, 60]);
  assert.deepEqual(compositeRgba([255, 0, 0, 255], [20, 40, 60]), [255, 0, 0]);
  assert.deepEqual(compositeRgba([255, 0, 0, 128], [0, 0, 255]), [128, 0, 127]);
});

test("coordinate mapping rejects nonfinite points and empty surfaces", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(canvasPointToScaledPixel({ x: value, y: 0, inside: true }, 10, 10, 5, 5), null);
    assert.equal(canvasPointToPixel({ x: 0, y: value, inside: true }, 10, 10), null);
  }
  assert.equal(canvasPointToScaledPixel({ x: 1, y: 1, inside: true }, 10, 10, 0, 5), null);
});
