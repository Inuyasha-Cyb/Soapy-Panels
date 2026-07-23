var exports = {};

importScripts("../../vendor/omggif/omggif.js");

var GifReaderCtor =
  (typeof GifReader !== "undefined" && GifReader) ||
  (exports && exports.GifReader);

var DEFAULT_FRAME_DELAY_MS = 100;
var MIN_FRAME_DELAY_MS = 20;

function normalizeDelayFromCentiseconds(value) {
  var numeric = Number(value);
  if (!isFinite(numeric) || numeric <= 0) return DEFAULT_FRAME_DELAY_MS;
  return Math.max(MIN_FRAME_DELAY_MS, Math.round(numeric * 10));
}

function clearRectRgba(pixels, canvasWidth, x, y, width, height) {
  var left = Math.max(0, Math.floor(x || 0));
  var top = Math.max(0, Math.floor(y || 0));
  var right = Math.min(canvasWidth, left + Math.max(0, Math.floor(width || 0)));
  var bottom = Math.min(
    pixels.length / 4 / canvasWidth,
    Math.max(top, top + Math.max(0, Math.floor(height || 0))),
  );
  for (var row = top; row < bottom; row++) {
    var start = (row * canvasWidth + left) * 4;
    var end = (row * canvasWidth + right) * 4;
    for (var i = start; i < end; i++) pixels[i] = 0;
  }
}

function decodeGif(arrayBuffer, options) {
  if (!GifReaderCtor) throw new Error("GIF decoder did not load.");
  var opts = options || {};
  var maxFrames = Math.max(1, Math.floor(Number(opts.maxFrames) || 300));
  var maxDurationMs = Math.max(0, Math.floor(Number(opts.maxDurationMs) || 30000));
  var reader = new GifReaderCtor(new Uint8Array(arrayBuffer));
  var width = reader.width || 0;
  var height = reader.height || 0;
  var sourceFrameCount = reader.numFrames();
  if (!(width > 0) || !(height > 0) || !(sourceFrameCount > 0)) {
    throw new Error("Invalid GIF dimensions.");
  }

  var screen = new Uint8ClampedArray(width * height * 4);
  var frames = [];
  var transfers = [];
  var durationMs = 0;
  var truncated = false;

  for (var frameIndex = 0; frameIndex < sourceFrameCount; frameIndex++) {
    if (frames.length >= maxFrames) {
      truncated = true;
      break;
    }
    if (maxDurationMs > 0 && durationMs >= maxDurationMs) {
      truncated = true;
      break;
    }

    var info = reader.frameInfo(frameIndex);
    var disposal = info && isFinite(info.disposal) ? info.disposal : 0;
    var restorePrevious = disposal === 3 ? new Uint8ClampedArray(screen) : null;

    reader.decodeAndBlitFrameRGBA(frameIndex, screen);

    var framePixels = new Uint8ClampedArray(screen);
    var delayMs = normalizeDelayFromCentiseconds(info && info.delay);
    frames.push({
      delayMs: delayMs,
      disposal: disposal,
      buffer: framePixels.buffer,
    });
    transfers.push(framePixels.buffer);
    durationMs += delayMs;

    if (disposal === 2 && info) {
      clearRectRgba(screen, width, info.x, info.y, info.width, info.height);
    } else if (restorePrevious) {
      screen.set(restorePrevious);
    }
  }

  return {
    width: width,
    height: height,
    frames: frames,
    frameCount: frames.length,
    sourceFrameCount: sourceFrameCount,
    durationMs: durationMs,
    loopCount: typeof reader.loopCount === "function" ? reader.loopCount() : null,
    truncated: truncated,
    transfers: transfers,
  };
}

self.onmessage = function (event) {
  var data = event && event.data ? event.data : {};
  if (data.type !== "decode") return;
  try {
    var decoded = decodeGif(data.arrayBuffer, data.options || {});
    var transfers = decoded.transfers || [];
    delete decoded.transfers;
    self.postMessage({ ok: true, result: decoded }, transfers);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};
