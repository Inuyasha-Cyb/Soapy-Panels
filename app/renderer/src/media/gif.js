(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.media = root.SoapyPanels.media || {};
  root.SoapyPanels.media.gif = api;
})(
  typeof self !== 'undefined'
    ? self
    : typeof window !== 'undefined'
      ? window
      : globalThis,
  function (root) {
    const policy =
      typeof module !== 'undefined' && module.exports
        ? require('./gif-resource-policy')
        : root.SoapyGifPolicy;
    const DEFAULT_FRAME_DELAY_MS = 100;
    const MIN_FRAME_DELAY_MS = 20;
    const WORKER_TIMEOUT_MS = policy.limits.timeoutMs;
    const DECODE_WORKER_URL = 'src/media/gif-decode-worker.js';
    const EXPORT_WORKER_URL = 'src/media/gif-export-worker.js';

    function isFiniteNumber(value) {
      return typeof value === 'number' && isFinite(value);
    }

    function normalizeDelayMs(value, fallback) {
      const numeric = Number(value);
      const fallbackMs =
        isFiniteNumber(fallback) && fallback > 0
          ? fallback
          : DEFAULT_FRAME_DELAY_MS;
      if (!isFinite(numeric) || numeric <= 0) return fallbackMs;
      return Math.max(MIN_FRAME_DELAY_MS, Math.round(numeric));
    }

    function normalizeCentisecondDelay(value) {
      const numeric = Number(value);
      if (!isFinite(numeric) || numeric <= 0) return DEFAULT_FRAME_DELAY_MS;
      return normalizeDelayMs(numeric * 10, DEFAULT_FRAME_DELAY_MS);
    }

    function buildFrameTimeline(frames) {
      const list = Array.isArray(frames) ? frames : [];
      let cursor = 0;
      const timeline = [];
      for (let i = 0; i < list.length; i++) {
        const delayMs = normalizeDelayMs(list[i] && list[i].delayMs);
        const startMs = cursor;
        cursor += delayMs;
        timeline.push({
          index: i,
          delayMs,
          startMs,
          endMs: cursor,
        });
      }
      return {
        frames: timeline,
        durationMs: cursor,
      };
    }

    function frameIndexAtTime(timeline, timeMs) {
      const frames =
        timeline && Array.isArray(timeline.frames) ? timeline.frames : [];
      if (!frames.length) return 0;
      const durationMs =
        isFiniteNumber(timeline.durationMs) && timeline.durationMs > 0
          ? timeline.durationMs
          : frames[frames.length - 1].endMs || DEFAULT_FRAME_DELAY_MS;
      if (!(durationMs > 0)) return 0;
      let localTime = Number(timeMs);
      if (!isFinite(localTime)) localTime = 0;
      localTime = ((localTime % durationMs) + durationMs) % durationMs;
      for (let i = 0; i < frames.length; i++) {
        if (localTime < frames[i].endMs) return frames[i].index;
      }
      return frames[frames.length - 1].index;
    }

    function isGifMime(value) {
      return (
        typeof value === 'string' &&
        value.toLowerCase().split(';')[0] === 'image/gif'
      );
    }

    function isGifName(value) {
      return typeof value === 'string' && /\.gif(?:$|[?#])/i.test(value);
    }

    function isGifDataUrl(value) {
      return (
        typeof value === 'string' && /^data:image\/gif(?:;|,)/i.test(value)
      );
    }

    function isGifFile(file) {
      if (!file) return false;
      if (isGifMime(file.type)) return true;
      return isGifName(file.name);
    }

    function isGifSource(value, mimeType) {
      if (isGifMime(mimeType)) return true;
      if (isGifDataUrl(value)) return true;
      return isGifName(value);
    }

    function createWorker(workerUrl) {
      if (!root || typeof root.Worker !== 'function') {
        throw new Error('GIF workers are not available.');
      }
      return new root.Worker(workerUrl);
    }

    function abortError() {
      const e = policy.error('GIF_ABORTED');
      e.name = 'AbortError';
      return e;
    }
    function checkAbort(signal) {
      if (signal && signal.aborted) throw abortError();
    }

    function runWorker(workerUrl, message, transfer, signal) {
      return new Promise(function (resolve, reject) {
        let worker,
          timeoutId,
          settled = false;
        function finish(error, result) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (signal) signal.removeEventListener('abort', aborted);
          if (worker) worker.terminate();
          if (error) reject(error);
          else resolve(result);
        }
        function aborted() {
          finish(abortError());
        }
        try {
          checkAbort(signal);
          worker = createWorker(workerUrl);
          if (signal) signal.addEventListener('abort', aborted, { once: true });
          timeoutId = setTimeout(
            () => finish(policy.error('GIF_TIMEOUT')),
            WORKER_TIMEOUT_MS,
          );
          worker.onmessage = function (event) {
            const data = (event && event.data) || {};
            finish(
              data.ok
                ? null
                : policy.error(data.code || 'GIF_INVALID', data.error),
              data.result,
            );
          };
          worker.onerror = () => finish(policy.error('GIF_WORKER_ERROR'));
          worker.onmessageerror = () =>
            finish(policy.error('GIF_WORKER_ERROR'));
          worker.postMessage(message, transfer || []);
        } catch (error) {
          finish(error);
        }
      });
    }

    // One queue spans input reads, the worker, and materialization. Only source handles
    // are queued; a batch must not eagerly copy all of its compressed inputs.
    const queue = [];
    let active = false,
      usedBytes = 0;
    function reserve(bytes) {
      if (usedBytes + bytes > policy.limits.sharedBytes)
        throw policy.error('GIF_SHARED_LIMIT');
      usedBytes += bytes;
      let amount = bytes;
      return {
        resize(next) {
          if (usedBytes - amount + next > policy.limits.sharedBytes)
            throw policy.error('GIF_SHARED_LIMIT');
          usedBytes += next - amount;
          amount = next;
        },
        release() {
          usedBytes -= amount;
          amount = 0;
        },
      };
    }
    function enqueue(task, signal) {
      return new Promise((resolve, reject) => {
        const job = { task, signal, resolve, reject, abort: null };
        job.abort = function () {
          const index = queue.indexOf(job);
          if (index < 0) return;
          queue.splice(index, 1);
          signal.removeEventListener('abort', job.abort);
          reject(abortError());
        };
        if (signal && signal.aborted) {
          reject(abortError());
          return;
        }
        if (signal) signal.addEventListener('abort', job.abort, { once: true });
        queue.push(job);
        pump();
      });
    }
    function pump() {
      if (active || !queue.length) return;
      active = true;
      const job = queue.shift();
      if (job.signal) job.signal.removeEventListener('abort', job.abort);
      Promise.resolve()
        .then(() => {
          checkAbort(job.signal);
          return job.task();
        })
        .then(job.resolve, job.reject)
        .finally(() => {
          active = false;
          pump();
        });
    }

    function dataUrlBytes(source, prefixOnly) {
      const comma = source.indexOf(',');
      if (comma < 0) throw policy.error('GIF_INVALID');
      const base64 = /;base64$/i.test(source.slice(0, comma));
      const start = comma + 1;
      if (base64) {
        const length = source.length - start;
        if (!prefixOnly) {
          // Reject oversized text before removing whitespace or allocating decoded bytes.
          if (length > Math.ceil(policy.limits.inputBytes / 3) * 4 + 4)
            throw policy.error('GIF_INPUT_LIMIT');
        }
        const text = source
          .slice(start, prefixOnly ? start + 64 : undefined)
          .replace(/\s/g, '');
        let binary;
        try {
          binary = root.atob(text);
        } catch {
          throw policy.error('GIF_INVALID');
        }
        if (!prefixOnly) policy.inputSize(binary.length);
        return Uint8Array.from(binary, (c) => c.charCodeAt(0));
      }
      // Percent-encoded binary data URLs do not use UTF-8 decoding.
      if (!prefixOnly && source.length - start > policy.limits.inputBytes * 3)
        throw policy.error('GIF_INPUT_LIMIT');
      let size = 0;
      const end = source.length;
      function visit(emit) {
        let count = 0;
        for (let i = start; i < end && (!prefixOnly || count < 6); i++) {
          let value = source.charCodeAt(i);
          if (source[i] === '%') {
            const hex = source.slice(i + 1, i + 3);
            if (!/^[0-9a-f]{2}$/i.test(hex)) throw policy.error('GIF_INVALID');
            value = parseInt(hex, 16);
            i += 2;
          }
          if (value > 255) throw policy.error('GIF_INVALID');
          if (++count > policy.limits.inputBytes)
            throw policy.error('GIF_INPUT_LIMIT');
          if (emit) emit(value, count - 1);
        }
        return count;
      }
      size = visit(null);
      const out = new Uint8Array(size);
      visit((value, i) => {
        out[i] = value;
      });
      return out;
    }

    async function readSource(source, signal, prefixOnly) {
      checkAbort(signal);
      if (typeof source === 'string' && /^data:/i.test(source))
        return dataUrlBytes(source, prefixOnly);
      if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
        if (!prefixOnly) policy.inputSize(source.byteLength);
        const view =
          source instanceof ArrayBuffer
            ? new Uint8Array(source)
            : new Uint8Array(
                source.buffer,
                source.byteOffset,
                source.byteLength,
              );
        return view.subarray(0, prefixOnly ? 6 : view.length);
      }
      if (
        source &&
        typeof source.slice === 'function' &&
        typeof source.size === 'number'
      ) {
        if (!prefixOnly) policy.inputSize(source.size);
        const buffer = await (
          prefixOnly ? source.slice(0, 6) : source
        ).arrayBuffer();
        checkAbort(signal);
        return new Uint8Array(buffer);
      }
      const response = await root.fetch(source, { signal });
      if (!response.ok || !response.body) throw policy.error('GIF_UNREADABLE');
      const reader = response.body.getReader();
      let bytes,
        size = 0;
      try {
        if (!prefixOnly) {
          const length = response.headers.get('content-length');
          if (length !== null) policy.inputSize(Number(length));
        }
        // A bounded backing store also prevents millions of tiny stream chunks from
        // accumulating an unbounded array of chunk descriptors.
        bytes = new Uint8Array(prefixOnly ? 6 : policy.limits.inputBytes);
        while (true) {
          checkAbort(signal);
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = prefixOnly
            ? value.subarray(0, Math.max(0, 6 - size))
            : value;
          if (!prefixOnly) policy.inputSize(size + chunk.length);
          bytes.set(chunk, size);
          size += chunk.length;
          if (prefixOnly && size >= 6) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return bytes.slice(0, size);
    }

    function createImageDataForFrame(width, height, rgba) {
      if (typeof ImageData === 'function') {
        return new ImageData(rgba, width, height);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(rgba);
      return imageData;
    }

    function materializeDecodedGif(decoded, expected, lease) {
      if (
        !decoded ||
        decoded.width !== expected.width ||
        decoded.height !== expected.height ||
        decoded.sourceFrameCount !== expected.sourceFrameCount ||
        !Array.isArray(decoded.frames) ||
        decoded.frames.length !== expected.frameCount ||
        decoded.frameCount !== expected.frameCount ||
        decoded.durationMs !== expected.durationMs ||
        decoded.frames.some(
          (frame) =>
            !frame ||
            !(frame.buffer instanceof ArrayBuffer) ||
            frame.buffer.byteLength !== expected.frameBytes ||
            !Number.isFinite(frame.delayMs) ||
            frame.delayMs < 20 ||
            frame.delayMs > 655350 ||
            !Number.isInteger(frame.disposal) ||
            frame.disposal < 0 ||
            frame.disposal > 3,
        )
      ) {
        throw policy.error('GIF_INVALID');
      }
      const { width, height } = expected;
      const frames = [];
      try {
        for (const sourceFrame of decoded.frames) {
          const canvas = document.createElement('canvas');
          frames.push({
            canvas,
            delayMs: sourceFrame.delayMs,
            disposal: sourceFrame.disposal,
          });
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw policy.error('GIF_WORKER_ERROR');
          ctx.putImageData(
            createImageDataForFrame(
              width,
              height,
              new Uint8ClampedArray(sourceFrame.buffer),
            ),
            0,
            0,
          );
          sourceFrame.buffer = null;
        }
      } catch (error) {
        for (const frame of frames) {
          frame.canvas.width = 0;
          frame.canvas.height = 0;
        }
        throw error;
      }
      const timeline = buildFrameTimeline(frames);
      let owners = 1,
        ownerReleased = false;
      function drop() {
        if (--owners !== 0) return;
        for (const frame of frames) {
          frame.canvas.width = 0;
          frame.canvas.height = 0;
        }
        frames.length = 0;
        lease.release();
      }
      lease.resize(expected.decodedBytes);
      return {
        width,
        height,
        frames,
        timeline,
        frameCount: frames.length,
        sourceFrameCount: decoded.sourceFrameCount,
        durationMs: timeline.durationMs,
        loopCount: decoded.loopCount == null ? null : decoded.loopCount,
        truncated: decoded.truncated === true,
        retain() {
          if (!owners) throw policy.error('GIF_INVALID');
          owners++;
          let released = false;
          return () => {
            if (!released) {
              released = true;
              drop();
            }
          };
        },
        release() {
          if (!ownerReleased) {
            ownerReleased = true;
            drop();
          }
        },
      };
    }

    function decode(source, options) {
      options = options || {};
      return enqueue(async function () {
        const knownSize =
          source &&
          (source.byteLength !== undefined ? source.byteLength : source.size);
        const initialBytes =
          knownSize === undefined
            ? policy.limits.inputBytes
            : policy.inputSize(knownSize);
        prunePreviews();
        const lease = reserve(2 * initialBytes);
        const controller = new AbortController();
        const signal = controller.signal;
        const cancel = () => controller.abort();
        let timedOut = false;
        if (options.signal)
          options.signal.addEventListener('abort', cancel, { once: true });
        const deadline = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, WORKER_TIMEOUT_MS);
        try {
          const bytes = await readSource(source, signal, false);
          checkAbort(signal);
          const expected = policy.inspect(bytes, options);
          lease.resize(expected.reservationBytes);
          const buffer =
            bytes.byteOffset === 0 &&
            bytes.byteLength === bytes.buffer.byteLength
              ? bytes.buffer
              : bytes.slice().buffer;
          const decoded = await runWorker(
            DECODE_WORKER_URL,
            { type: 'decode', arrayBuffer: buffer, options: expected.options },
            [buffer],
            signal,
          );
          checkAbort(signal);
          return materializeDecodedGif(decoded, expected, lease);
        } catch (error) {
          lease.release();
          if (timedOut) throw policy.error('GIF_TIMEOUT');
          throw error;
        } finally {
          clearTimeout(deadline);
          if (options.signal)
            options.signal.removeEventListener('abort', cancel);
        }
      }, options.signal);
    }
    function decodeArrayBuffer(source, options) {
      return decode(source, options);
    }
    function decodeBlob(source, options) {
      return decode(source, options);
    }
    function decodeSource(source, options) {
      return decode(source, options);
    }

    async function probe(source, signal) {
      const bytes = await readSource(source, signal, true);
      return policy.candidate(bytes);
    }
    async function loadImage(source, options) {
      options = options || {};
      const isGif = await probe(options.blob || source, options.signal);
      checkAbort(options.signal);
      if (isGif || options.gif) {
        const runtime = await decode(options.blob || source, options);
        const image = runtime.frames[0].canvas;
        image._soapyGifRuntime = runtime;
        return image;
      }
      return new Promise((resolve, reject) => {
        const image = new root.Image();
        const timeout = setTimeout(() => {
          image.src = '';
          finish(policy.error('GIF_UNREADABLE'));
        }, 20000);
        function abort() {
          image.src = '';
          finish(abortError());
        }
        function finish(error) {
          clearTimeout(timeout);
          image.onload = image.onerror = null;
          if (options.signal)
            options.signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve(image);
        }
        image.onload = () => finish();
        image.onerror = () => finish(policy.error('GIF_UNREADABLE'));
        if (options.signal)
          options.signal.addEventListener('abort', abort, { once: true });
        image.src = source;
      });
    }

    // Cache owns the actual preview canvases. Eviction clears their backing stores,
    // including canvases still attached to hidden library tiles.
    const previews = new Map();
    let previewBytes = 0;
    function prunePreviews() {
      for (const [element, value] of previews) {
        if (element.isConnected) continue;
        value.canvas.remove();
        value.canvas.width = value.canvas.height = 0;
        value.lease.release();
        previewBytes -= value.size;
        previews.delete(element);
      }
    }
    const previewJobs = new WeakMap();
    async function setPreview(target, source, options) {
      if (previewJobs.has(target)) return previewJobs.get(target);
      const job = populatePreview(target, source, options).finally(() =>
        previewJobs.delete(target),
      );
      previewJobs.set(target, job);
      return job;
    }
    async function populatePreview(target, source, options) {
      options = options || {};
      prunePreviews();
      if (!(await probe(source, options.signal)) && !options.gif) {
        if (target.isConnected)
          target.style.backgroundImage = 'url(' + JSON.stringify(source) + ')';
        return;
      }
      if (previews.has(target)) {
        const old = previews.get(target);
        previews.delete(target);
        previews.set(target, old);
        return;
      }
      const runtime = await decode(source, {
        maxFrames: 1,
        signal: options.signal,
      });
      let lease, canvas;
      try {
        checkAbort(options.signal);
        if (!target.isConnected) return;
        const scale = Math.min(
          1,
          128 / Math.max(runtime.width, runtime.height),
        );
        const width = Math.max(1, Math.round(runtime.width * scale)),
          height = Math.max(1, Math.round(runtime.height * scale));
        const size = width * height * 4;
        for (const [element, value] of previews) {
          if (
            !element.isConnected ||
            previewBytes + size > policy.limits.thumbnailBytes
          ) {
            value.canvas.remove();
            value.canvas.width = value.canvas.height = 0;
            value.lease.release();
            previewBytes -= value.size;
            previews.delete(element);
          }
        }
        lease = reserve(size);
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw policy.error('GIF_WORKER_ERROR');
        ctx.drawImage(runtime.frames[0].canvas, 0, 0, width, height);
        canvas.style.cssText =
          'width:100%;height:100%;object-fit:contain;pointer-events:none';
        target.style.backgroundImage = 'none';
        target.appendChild(canvas);
        previews.set(target, { canvas, lease, size });
        previewBytes += size;
        lease = null;
      } finally {
        if (lease) {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
          lease.release();
        }
        runtime.release();
      }
    }
    function clearPreviews() {
      for (const value of previews.values()) {
        value.canvas.remove();
        value.canvas.width = value.canvas.height = 0;
        value.lease.release();
      }
      previews.clear();
      previewBytes = 0;
    }

    function encodeGifFrames(width, height, frames, options) {
      const safeWidth = Math.max(1, Math.round(Number(width) || 0));
      const safeHeight = Math.max(1, Math.round(Number(height) || 0));
      const frameList = Array.isArray(frames) ? frames : [];
      if (!safeWidth || !safeHeight || !frameList.length) {
        return Promise.reject(new Error('No GIF export frames.'));
      }

      const transfer = [];
      const workerFrames = frameList.map(function (frame) {
        const buffer = frame && frame.buffer;
        if (buffer instanceof ArrayBuffer) transfer.push(buffer);
        return {
          buffer,
          delayMs: normalizeDelayMs(frame && frame.delayMs),
        };
      });

      return runWorker(
        EXPORT_WORKER_URL,
        {
          type: 'encode',
          width: safeWidth,
          height: safeHeight,
          frames: workerFrames,
          options: options || {},
        },
        transfer,
      ).then(function (result) {
        if (!result || !result.buffer) throw new Error('GIF export failed.');
        return new Blob([result.buffer], { type: 'image/gif' });
      });
    }

    return {
      DEFAULT_FRAME_DELAY_MS,
      MIN_FRAME_DELAY_MS,
      normalizeDelayMs,
      normalizeCentisecondDelay,
      buildFrameTimeline,
      frameIndexAtTime,
      isGifMime,
      isGifName,
      isGifDataUrl,
      isGifFile,
      isGifSource,
      decodeArrayBuffer,
      decodeBlob,
      decodeSource,
      encodeGifFrames,
      probe,
      loadImage,
      setPreview,
      clearPreviews,
      policy,
      getResourceUsage: () => ({
        usedBytes,
        previewBytes,
        activeDecoders: active ? 1 : 0,
        queuedDecoders: queue.length,
      }),
    };
  },
);
