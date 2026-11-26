(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoapyGifPolicy = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const MiB = 1024 * 1024;
  const limits = Object.freeze({
    inputBytes: 32 * MiB,
    dimension: 4096,
    pixels: 8388608,
    sourceFrames: 10000,
    decodedBytes: 256 * MiB,
    sharedBytes: 768 * MiB,
    thumbnailBytes: 16 * MiB,
    frames: 300,
    durationMs: 30000,
    timeoutMs: 60000,
  });
  function error(code, message) {
    const value = new Error(message || code);
    value.code = code;
    return value;
  }
  function inputSize(size) {
    if (!Number.isSafeInteger(size) || size < 0) throw error('GIF_INVALID');
    if (size > limits.inputBytes) throw error('GIF_INPUT_LIMIT');
    return size;
  }
  function signature(bytes) {
    return (
      bytes.length >= 6 &&
      bytes[0] === 71 &&
      bytes[1] === 73 &&
      bytes[2] === 70 &&
      bytes[3] === 56 &&
      (bytes[4] === 55 || bytes[4] === 57) &&
      bytes[5] === 97
    );
  }
  function candidate(bytes) {
    return (
      bytes.length >= 3 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70
    );
  }
  function options(value) {
    value = value || {};
    function cap(n, max) {
      n = Number(n);
      return Number.isFinite(n) && n > 0
        ? Math.min(max, Math.max(1, Math.floor(n)))
        : max;
    }
    return {
      maxFrames: cap(value.maxFrames, limits.frames),
      maxDurationMs: cap(value.maxDurationMs, limits.durationMs),
    };
  }
  // Walk block boundaries only: no LZW decoding and no per-source-frame allocations.
  function inspect(input, requested) {
    // Reject array-like objects before a typed-array constructor can allocate from
    // an attacker-controlled length. ArrayBuffer conversion below is a view only.
    if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
      throw error('GIF_INVALID');
    }
    inputSize(input.byteLength);
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const opts = options(requested);
    let p = 0;
    function need(n) {
      if (p + n > bytes.length) throw error('GIF_INVALID');
    }
    function byte() {
      need(1);
      return bytes[p++];
    }
    function word() {
      return byte() | (byte() << 8);
    }
    function skip(n) {
      need(n);
      p += n;
    }
    function blocks() {
      let n;
      while ((n = byte()) !== 0) skip(n);
    }
    if (!signature(bytes)) throw error('GIF_INVALID');
    p = 6;
    const width = word(),
      height = word();
    if (!width || !height) throw error('GIF_INVALID');
    if (
      width > limits.dimension ||
      height > limits.dimension ||
      width * height > limits.pixels
    )
      throw error('GIF_DIMENSION_LIMIT');
    const packed = byte();
    skip(2);
    const globalColors = packed & 128 ? 1 << ((packed & 7) + 1) : 0;
    skip(globalColors * 3);
    let sourceFrameCount = 0,
      frameCount = 0,
      durationMs = 0,
      delay = 0;
    let transparent = null,
      trailer = false;
    while (p < bytes.length) {
      const tag = byte();
      if (tag === 0x3b) {
        trailer = true;
        break;
      }
      if (tag === 0x21) {
        const label = byte();
        if (label === 0xf9) {
          if (byte() !== 4) throw error('GIF_INVALID');
          const control = byte();
          delay = word();
          const index = byte();
          transparent = control & 1 ? index : null;
          if (byte() !== 0 || ((control >> 2) & 7) > 3)
            throw error('GIF_INVALID');
        } else if (label === 0xff) {
          if (byte() !== 11) throw error('GIF_INVALID');
          skip(11);
          blocks();
        } else if (label === 0xfe) blocks();
        else throw error('GIF_INVALID');
      } else if (tag === 0x2c) {
        if (++sourceFrameCount > limits.sourceFrames)
          throw error('GIF_FRAME_LIMIT');
        const x = word(),
          y = word(),
          w = word(),
          h = word(),
          flags = byte();
        if (!w || !h || x + w > width || y + h > height)
          throw error('GIF_INVALID');
        const colors = flags & 128 ? 1 << ((flags & 7) + 1) : globalColors;
        if (!colors || (transparent !== null && transparent >= colors))
          throw error('GIF_INVALID');
        if (flags & 128) skip(colors * 3);
        const codeSize = byte();
        if (codeSize < 2 || codeSize > 8) throw error('GIF_INVALID');
        blocks();
        if (frameCount < opts.maxFrames && durationMs < opts.maxDurationMs) {
          frameCount++;
          durationMs += delay > 0 ? Math.max(20, delay * 10) : 100;
        }
      } else throw error('GIF_INVALID');
    }
    if (!trailer || !sourceFrameCount) throw error('GIF_INVALID');
    const pixels = width * height,
      frameBytes = pixels * 4,
      decodedBytes = frameBytes * frameCount;
    if (decodedBytes > limits.decodedBytes) throw error('GIF_DECODED_LIMIT');
    return {
      width,
      height,
      sourceFrameCount,
      frameCount,
      durationMs,
      frameBytes,
      decodedBytes,
      reservationBytes:
        2 * bytes.byteLength + 2 * decodedBytes + 3 * frameBytes + pixels,
      options: opts,
    };
  }
  return { limits, error, inputSize, signature, candidate, options, inspect };
});
