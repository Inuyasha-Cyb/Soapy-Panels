var exports = {};

importScripts("../../vendor/gifenc/gifenc.js");

var GIFEncoder = exports && exports.GIFEncoder;
var quantize = exports && exports.quantize;
var applyPalette = exports && exports.applyPalette;

function normalizeDelayMs(value) {
  var numeric = Number(value);
  if (!isFinite(numeric) || numeric <= 0) return 100;
  return Math.max(20, Math.round(numeric));
}

function findTransparentPaletteIndex(palette) {
  if (!Array.isArray(palette)) return -1;
  for (var i = 0; i < palette.length; i++) {
    var color = palette[i];
    if (Array.isArray(color) && color.length > 3 && color[3] === 0) return i;
  }
  return -1;
}

function encodeGif(width, height, frames, options) {
  if (!GIFEncoder || !quantize || !applyPalette) {
    throw new Error("GIF encoder did not load.");
  }
  var frameList = Array.isArray(frames) ? frames : [];
  if (!(width > 0) || !(height > 0) || !frameList.length) {
    throw new Error("Invalid GIF export frames.");
  }
  var opts = options || {};
  var gif = GIFEncoder();

  for (var i = 0; i < frameList.length; i++) {
    var frame = frameList[i];
    if (!frame || !frame.buffer) continue;
    var rgba = new Uint8ClampedArray(frame.buffer);
    var palette = quantize(rgba, 256, {
      format: "rgba4444",
      oneBitAlpha: 127,
      clearAlpha: true,
      clearAlphaThreshold: 0,
    });
    var index = applyPalette(rgba, palette, "rgba4444");
    var transparentIndex = findTransparentPaletteIndex(palette);
    gif.writeFrame(index, width, height, {
      palette: palette,
      delay: normalizeDelayMs(frame.delayMs),
      repeat: i === 0 ? (opts.repeat == null ? 0 : opts.repeat) : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
    });
  }

  gif.finish();
  var bytes = gif.bytes();
  return bytes.slice ? bytes.slice() : new Uint8Array(bytes);
}

self.onmessage = function (event) {
  var data = event && event.data ? event.data : {};
  if (data.type !== "encode") return;
  try {
    var output = encodeGif(data.width, data.height, data.frames, data.options || {});
    self.postMessage({ ok: true, result: { buffer: output.buffer } }, [output.buffer]);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};
