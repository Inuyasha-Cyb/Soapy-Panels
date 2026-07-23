(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.media = root.SoapyPanels.media || {};
  root.SoapyPanels.media.gif = api;
})(
  typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : globalThis,
  function (root) {
  const DEFAULT_FRAME_DELAY_MS = 100;
  const MIN_FRAME_DELAY_MS = 20;
  const DEFAULT_DECODE_MAX_FRAMES = 300;
  const DEFAULT_DECODE_MAX_DURATION_MS = 30000;
  const WORKER_TIMEOUT_MS = 60000;
  const DECODE_WORKER_URL = "src/media/gif-decode-worker.js";
  const EXPORT_WORKER_URL = "src/media/gif-export-worker.js";

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function normalizeDelayMs(value, fallback) {
    const numeric = Number(value);
    const fallbackMs = isFiniteNumber(fallback) && fallback > 0
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
    const frames = timeline && Array.isArray(timeline.frames) ? timeline.frames : [];
    if (!frames.length) return 0;
    const durationMs = isFiniteNumber(timeline.durationMs) && timeline.durationMs > 0
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
    return typeof value === "string" && value.toLowerCase().split(";")[0] === "image/gif";
  }

  function isGifName(value) {
    return typeof value === "string" && /\.gif(?:$|[?#])/i.test(value);
  }

  function isGifDataUrl(value) {
    return typeof value === "string" && /^data:image\/gif(?:;|,)/i.test(value);
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
    if (!root || typeof root.Worker !== "function") {
      throw new Error("GIF workers are not available.");
    }
    return new root.Worker(workerUrl);
  }

  function runWorker(workerUrl, message, transfer) {
    return new Promise(function (resolve, reject) {
      let worker;
      let timeoutId = null;
      try {
        worker = createWorker(workerUrl);
      } catch (error) {
        reject(error);
        return;
      }

      function cleanup() {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (worker) {
          try {
            worker.terminate();
          } catch (_e) {}
        }
        worker = null;
      }

      timeoutId = setTimeout(function () {
        cleanup();
        reject(new Error("GIF worker timed out."));
      }, WORKER_TIMEOUT_MS);

      worker.onmessage = function (event) {
        const data = event && event.data ? event.data : {};
        cleanup();
        if (data.ok) resolve(data.result);
        else reject(new Error(data.error || "GIF worker failed."));
      };

      worker.onerror = function (event) {
        const messageText =
          event && event.message ? event.message : "GIF worker failed.";
        cleanup();
        reject(new Error(messageText));
      };

      try {
        worker.postMessage(message, Array.isArray(transfer) ? transfer : []);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  function arrayBufferFromBlob(blob) {
    if (!blob) return Promise.reject(new Error("Missing GIF blob."));
    if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      try {
        const reader = new FileReader();
        reader.onload = function () {
          resolve(reader.result);
        };
        reader.onerror = function () {
          reject(new Error("Unable to read GIF blob."));
        };
        reader.readAsArrayBuffer(blob);
      } catch (error) {
        reject(error);
      }
    });
  }

  function fetchArrayBuffer(source) {
    if (!source || typeof source !== "string") {
      return Promise.reject(new Error("Missing GIF source."));
    }
    if (!root || typeof root.fetch !== "function") {
      return Promise.reject(new Error("Fetch is not available for GIF source."));
    }
    return root.fetch(source).then(function (response) {
      if (!response || !response.ok) {
        throw new Error("Unable to fetch GIF source.");
      }
      return response.arrayBuffer();
    });
  }

  function createImageDataForFrame(width, height, rgba) {
    if (typeof ImageData === "function") {
      return new ImageData(rgba, width, height);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    return imageData;
  }

  function materializeDecodedGif(decoded) {
    if (!decoded || !decoded.width || !decoded.height || !Array.isArray(decoded.frames)) {
      throw new Error("Invalid decoded GIF data.");
    }
    if (typeof document === "undefined" || !document.createElement) {
      throw new Error("GIF frame materialization requires a document.");
    }

    const width = Math.max(1, Math.round(decoded.width));
    const height = Math.max(1, Math.round(decoded.height));
    const frames = [];
    for (let i = 0; i < decoded.frames.length; i++) {
      const sourceFrame = decoded.frames[i];
      if (!sourceFrame || !sourceFrame.buffer) continue;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      const rgba = new Uint8ClampedArray(sourceFrame.buffer);
      ctx.putImageData(createImageDataForFrame(width, height, rgba), 0, 0);
      frames.push({
        canvas,
        delayMs: normalizeDelayMs(sourceFrame.delayMs),
        disposal: sourceFrame.disposal || 0,
      });
    }
    const timeline = buildFrameTimeline(frames);
    return {
      width,
      height,
      frames,
      timeline,
      frameCount: frames.length,
      sourceFrameCount: decoded.sourceFrameCount || frames.length,
      durationMs: timeline.durationMs,
      loopCount: decoded.loopCount == null ? null : decoded.loopCount,
      truncated: decoded.truncated === true,
    };
  }

  function decodeArrayBuffer(arrayBuffer, options) {
    if (!arrayBuffer) return Promise.reject(new Error("Missing GIF bytes."));
    const decodeOptions = options || {};
    const payloadBuffer =
      arrayBuffer instanceof ArrayBuffer
        ? arrayBuffer
        : arrayBuffer.buffer instanceof ArrayBuffer
          ? arrayBuffer.buffer.slice(
              arrayBuffer.byteOffset || 0,
              (arrayBuffer.byteOffset || 0) + arrayBuffer.byteLength,
            )
          : null;
    if (!payloadBuffer) return Promise.reject(new Error("Invalid GIF bytes."));
    return runWorker(
      DECODE_WORKER_URL,
      {
        type: "decode",
        arrayBuffer: payloadBuffer,
        options: {
          maxFrames: decodeOptions.maxFrames || DEFAULT_DECODE_MAX_FRAMES,
          maxDurationMs:
            decodeOptions.maxDurationMs || DEFAULT_DECODE_MAX_DURATION_MS,
        },
      },
      [payloadBuffer],
    ).then(materializeDecodedGif);
  }

  function decodeBlob(blob, options) {
    return arrayBufferFromBlob(blob).then(function (arrayBuffer) {
      return decodeArrayBuffer(arrayBuffer, options);
    });
  }

  function decodeSource(source, options) {
    return fetchArrayBuffer(source).then(function (arrayBuffer) {
      return decodeArrayBuffer(arrayBuffer, options);
    });
  }

  function encodeGifFrames(width, height, frames, options) {
    const safeWidth = Math.max(1, Math.round(Number(width) || 0));
    const safeHeight = Math.max(1, Math.round(Number(height) || 0));
    const frameList = Array.isArray(frames) ? frames : [];
    if (!safeWidth || !safeHeight || !frameList.length) {
      return Promise.reject(new Error("No GIF export frames."));
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
        type: "encode",
        width: safeWidth,
        height: safeHeight,
        frames: workerFrames,
        options: options || {},
      },
      transfer,
    ).then(function (result) {
      if (!result || !result.buffer) throw new Error("GIF export failed.");
      return new Blob([result.buffer], { type: "image/gif" });
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
  };
});
