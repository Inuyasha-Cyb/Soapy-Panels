const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../../app/renderer/src/media/gif-resource-policy');
const { gif, dataUrl } = require('../support/gif-security');
const mediaDir = path.resolve(__dirname, '../../app/renderer/src/media');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function workerContext(onAllocate = () => {}) {
  const context = { console, ArrayBuffer };
  for (const name of ['Uint8Array', 'Uint8ClampedArray', 'Int32Array']) {
    context[name] = new Proxy(globalThis[name], {
      construct(Target, args) {
        if (typeof args[0] === 'number')
          onAllocate(args[0] * Target.BYTES_PER_ELEMENT);
        return new Target(...args);
      },
    });
  }
  context.self = context;
  vm.createContext(context);
  context.importScripts = (...files) => {
    for (const file of files)
      vm.runInContext(
        fs.readFileSync(path.resolve(mediaDir, file), 'utf8'),
        context,
      );
  };
  vm.runInContext(
    fs.readFileSync(path.join(mediaDir, 'gif-decode-worker.js'), 'utf8'),
    context,
  );
  return context;
}
function service(settings = {}) {
  const stats = {
    workers: 0,
    active: 0,
    peak: 0,
    canvases: [],
    nativeSources: [],
  };
  const realWorker = workerContext();
  const context = {
    console,
    ArrayBuffer,
    Uint8Array,
    Uint8ClampedArray,
    AbortController,
    Blob,
    setTimeout,
    clearTimeout,
    atob,
    DOMException,
    SoapyGifPolicy: {
      ...policy,
      limits: { ...policy.limits, ...settings.limits },
      inputSize(size) {
        policy.inputSize(size);
        if (size > (settings.limits?.inputBytes ?? policy.limits.inputBytes))
          throw policy.error('GIF_INPUT_LIMIT');
        return size;
      },
    },
    ImageData: class {
      constructor(data, width, height) {
        Object.assign(this, { data, width, height });
      }
    },
    Image: class {
      set src(value) {
        stats.nativeSources.push(value);
        if (value) setTimeout(() => this.onload?.(), 0);
      }
    },
    document: {
      createElement() {
        const canvas = {
          width: 0,
          height: 0,
          style: {},
          remove() {},
          getContext() {
            return {
              putImageData() {
                if (settings.failCanvas === stats.canvases.indexOf(canvas))
                  throw new Error('canvas failure');
              },
              drawImage() {},
            };
          },
        };
        stats.canvases.push(canvas);
        return canvas;
      },
    },
    Worker: class {
      constructor() {
        stats.workers++;
        stats.active++;
        stats.peak = Math.max(stats.peak, stats.active);
      }
      terminate() {
        if (!this.ended) {
          this.ended = true;
          stats.active--;
        }
      }
      postMessage(message) {
        if (settings.mode === 'post') throw new Error('post failure');
        if (settings.mode === 'hang') return;
        setTimeout(() => {
          if (this.ended) return;
          if (settings.mode === 'error') {
            this.onerror({});
            return;
          }
          if (settings.mode === 'message') {
            this.onmessageerror({});
            return;
          }
          try {
            const result = realWorker.decodeGif(
              message.arrayBuffer,
              message.options,
            );
            if (settings.mode === 'invalid')
              result.frames[0].buffer = new ArrayBuffer(1);
            this.onmessage({ data: { ok: true, result } });
          } catch (error) {
            this.onmessage({
              data: { ok: false, code: error.code, error: error.message },
            });
          }
        }, settings.delay || 0);
      }
    },
    fetch: settings.fetch,
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(mediaDir, 'gif.js'), 'utf8'),
    context,
  );
  return { api: context.SoapyPanels.media.gif, stats, context };
}
const code = (expected) => (error) => error.code === expected;

test('710-byte allocation bomb and oversized frame rectangles fail before pixel allocation', () => {
  const bomb = gif({ width: 8192, height: 8192, frames: 30 });
  assert.equal(bomb.length, 710);
  const allocations = [];
  const worker = workerContext((bytes) => {
    allocations.push(bytes);
    assert.ok(bytes < 1024, 'large allocation intercepted');
  });
  assert.throws(() => worker.decodeGif(bomb, {}), code('GIF_DIMENSION_LIMIT'));
  const rectangle = gif({ width: 1, height: 1, frames: 1 });
  const descriptor = rectangle.indexOf(0x2c);
  rectangle.writeUInt16LE(65535, descriptor + 5);
  rectangle.writeUInt16LE(65535, descriptor + 7);
  assert.throws(() => worker.decodeGif(rectangle, {}), code('GIF_INVALID'));
  assert.throws(
    () => worker.decodeGif({ length: 1000000000 }, {}),
    code('GIF_INVALID'),
  );
  assert.deepEqual(allocations, []);
});

test('exact dimension, pixel, decoded-byte, compressed-byte, and metadata limits', () => {
  assert.equal(
    policy.inspect(gif({ width: 4096, height: 2048, frames: 8 })).decodedBytes,
    256 * 1024 * 1024,
  );
  assert.throws(
    () => policy.inspect(gif({ width: 4096, height: 2048, frames: 9 })),
    code('GIF_DECODED_LIMIT'),
  );
  assert.throws(
    () => policy.inspect(gif({ width: 4096, height: 2049, frames: 1 })),
    code('GIF_DIMENSION_LIMIT'),
  );
  assert.throws(
    () => policy.inspect(gif({ width: 4097, height: 1, frames: 1 })),
    code('GIF_DIMENSION_LIMIT'),
  );
  assert.equal(policy.inputSize(32 * 1024 * 1024), 32 * 1024 * 1024);
  assert.throws(
    () => policy.inputSize(32 * 1024 * 1024 + 1),
    code('GIF_INPUT_LIMIT'),
  );
  assert.equal(policy.inspect(gif({ frames: 10000 })).sourceFrameCount, 10000);
  assert.throws(
    () => policy.inspect(gif({ frames: 10001 })),
    code('GIF_FRAME_LIMIT'),
  );
});

test('malformed/truncated blocks, palettes, invalid rectangles and code sizes fail closed', () => {
  const bytes = gif();
  for (let length = 0; length < bytes.length; length++)
    assert.throws(
      () => policy.inspect(bytes.subarray(0, length)),
      code('GIF_INVALID'),
    );
  for (const mutate of [
    (b) => {
      b[10] &= 127;
    },
    (b) => {
      b[b.indexOf(0x2c) + 10] = 12;
    },
    (b) => b.writeUInt16LE(2, b.indexOf(0x2c) + 1),
    (b) => b.writeUInt16LE(0, b.indexOf(0x2c) + 5),
  ]) {
    const bad = Buffer.from(bytes);
    mutate(bad);
    assert.throws(() => policy.inspect(bad));
  }
});

test('caller options cannot raise frame/duration limits; existing truncation and delays remain', () => {
  const bytes = gif({ frames: 400, delay: 1 });
  for (const maxFrames of [Infinity, NaN, 99999, -1, 0])
    assert.equal(policy.inspect(bytes, { maxFrames }).frameCount, 300);
  assert.equal(policy.inspect(bytes, { maxFrames: 2 }).frameCount, 2);
  assert.equal(
    policy.inspect(gif({ frames: 301, delay: 100 }), {
      maxDurationMs: Infinity,
    }).frameCount,
    30,
  );
  assert.equal(
    policy.inspect(gif({ frames: 10, delay: 0 }), { maxDurationMs: 150 })
      .frameCount,
    2,
  );
});

test('decoder preserves disposal, transparency, looping and timing', () => {
  const { GifWriter } = require('../../app/renderer/vendor/omggif/omggif');
  const bytes = Buffer.alloc(256);
  const writer = new GifWriter(bytes, 2, 1, {
    palette: [0xff0000, 0x00ff00],
    loop: 2,
  });
  writer.addFrame(0, 0, 1, 1, new Uint8Array([0]), { delay: 1, disposal: 3 });
  writer.addFrame(1, 0, 1, 1, new Uint8Array([1]), { delay: 0, disposal: 2 });
  writer.addFrame(0, 0, 1, 1, new Uint8Array([1]), {
    delay: 20,
    transparent: 1,
  });
  const result = workerContext().decodeGif(bytes.subarray(0, writer.end()), {});
  assert.equal(result.loopCount, 2);
  assert.equal(result.durationMs, 320);
  assert.deepEqual(
    [...new Uint8Array(result.frames[0].buffer)],
    [255, 0, 0, 255, 0, 0, 0, 0],
  );
  assert.deepEqual(
    [...new Uint8Array(result.frames[1].buffer)],
    [0, 0, 0, 0, 0, 255, 0, 255],
  );
  assert.deepEqual(
    [...new Uint8Array(result.frames[2].buffer)],
    Array(8).fill(0),
  );
});

test('FIFO serialization spans workers/materialization and releases retained owners exactly once', async () => {
  const { api, stats } = service({ delay: 5 });
  const jobs = Array.from({ length: 8 }, () => api.decodeArrayBuffer(gif()));
  const runtimes = await Promise.all(jobs);
  assert.equal(stats.peak, 1);
  assert.equal(api.getResourceUsage().usedBytes, 8 * 2 * 2 * 4 * 2);
  const releaseExport = runtimes[0].retain();
  const canvas = runtimes[0].frames[0].canvas;
  for (const runtime of runtimes) {
    runtime.release();
    runtime.release();
  }
  assert.equal(canvas.width, 2);
  assert.equal(api.getResourceUsage().usedBytes, 32);
  releaseExport();
  releaseExport();
  assert.equal(canvas.width, 0);
  assert.equal(api.getResourceUsage().usedBytes, 0);
});

test('shared budget rejects before worker allocation and becomes available after release', async () => {
  const bytes = gif();
  const admission = policy.inspect(bytes).reservationBytes;
  const { api, stats } = service({ limits: { sharedBytes: admission + 31 } });
  const first = await api.decodeArrayBuffer(bytes);
  await assert.rejects(api.decodeArrayBuffer(gif()), code('GIF_SHARED_LIMIT'));
  assert.equal(stats.workers, 1);
  first.release();
  const retry = await api.decodeArrayBuffer(gif());
  retry.release();
  assert.equal(api.getResourceUsage().usedBytes, 0);
});

test('queued and active aborts release reservations and allow the next job', async () => {
  const { api } = service({ delay: 20 });
  const active = new AbortController(),
    queued = new AbortController();
  const first = api.decodeArrayBuffer(gif(), { signal: active.signal });
  const second = api.decodeArrayBuffer(gif(), { signal: queued.signal });
  const checks = Promise.all([
    assert.rejects(first, { name: 'AbortError' }),
    assert.rejects(second, { name: 'AbortError' }),
  ]);
  queued.abort();
  await tick();
  active.abort();
  await checks;
  const next = await api.decodeArrayBuffer(gif());
  next.release();
  assert.equal(api.getResourceUsage().usedBytes, 0);
});

for (const mode of ['hang', 'error', 'message', 'post', 'invalid', 'canvas']) {
  test(`${mode} failure rolls back worker, budget and partial canvases`, async () => {
    const { api, stats } = service({
      mode,
      limits: { timeoutMs: 10 },
      failCanvas: mode === 'canvas' ? 1 : undefined,
    });
    await assert.rejects(api.decodeArrayBuffer(gif()));
    await tick();
    assert.equal(stats.active, 0);
    assert.equal(api.getResourceUsage().usedBytes, 0);
    assert.ok(stats.canvases.every((canvas) => canvas.width === 0));
  });
}

test('input checks precede blob reads and copied views; mislabeled GIFs avoid native decoding', async () => {
  const { api, stats } = service();
  await assert.rejects(
    api.decodeBlob({
      size: policy.limits.inputBytes + 1,
      arrayBuffer() {
        throw new Error('read forbidden');
      },
    }),
    code('GIF_INPUT_LIMIT'),
  );
  const image = await api.loadImage(dataUrl(gif(), 'image/png'));
  assert.equal(stats.nativeSources.length, 0);
  image._soapyGifRuntime.release();
  await assert.rejects(
    api.loadImage(dataUrl(gif({ width: 8192 }), 'image/png')),
    code('GIF_DIMENSION_LIMIT'),
  );
  assert.equal(stats.nativeSources.length, 0);
});

test('streamed input is bounded with missing or dishonest content length and always canceled', async () => {
  for (const length of [null, '1', '33']) {
    let canceled = false,
      read = 0;
    const { api } = service({
      limits: { inputBytes: 32 },
      fetch: async () => ({
        ok: true,
        headers: { get: () => length },
        body: {
          getReader: () => ({
            async read() {
              read++;
              return { done: false, value: new Uint8Array(17) };
            },
            async cancel() {
              canceled = true;
            },
          }),
        },
      }),
    });
    await assert.rejects(
      api.decodeSource('app://test.gif'),
      code('GIF_INPUT_LIMIT'),
    );
    assert.ok(canceled);
    assert.ok(read <= 2);
    assert.equal(api.getResourceUsage().usedBytes, 0);
  }
});

test('preview canvases are bounded, evicted, and released when detached', async () => {
  const { api } = service({ limits: { thumbnailBytes: 16 } });
  const target = () => ({
    isConnected: true,
    style: {},
    appendChild(canvas) {
      this.canvas = canvas;
    },
  });
  const a = target(),
    b = target();
  await api.setPreview(a, dataUrl(gif()));
  await api.setPreview(b, dataUrl(gif()));
  assert.equal(a.canvas.width, 0);
  assert.equal(api.getResourceUsage().previewBytes, 16);
  b.isConnected = false;
  const runtime = await api.decodeArrayBuffer(gif());
  runtime.release();
  api.clearPreviews();
  assert.equal(api.getResourceUsage().usedBytes, 0);
});
