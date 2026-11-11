(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.images = root.SoapyPanels.images || {};
  root.SoapyPanels.images.effectsRuntime = api;
})(
  typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : globalThis,
  function (root) {
    "use strict";

    const DEFAULT_WORKER_URL = "src/images/effects-worker.js";

    function closeBitmap(bitmap) {
      if (bitmap && typeof bitmap.close === "function") {
        try { bitmap.close(); } catch { /* Resource was already released. */ }
      }
    }

    function createProcessor(options) {
      options = options || {};
      const workerUrl = options.workerUrl || DEFAULT_WORKER_URL;
      let worker = null;
      let nextId = 1;
      const pending = Object.create(null);
      let generations = Object.create(null);
      let destroyed = false;

      function rejectPending(error) {
        for (const id in pending) {
          if (!Object.prototype.hasOwnProperty.call(pending, id)) continue;
          pending[id].reject(error);
          delete pending[id];
        }
      }

      function resetWorker(error) {
        if (worker) {
          try { worker.terminate(); } catch { /* Resource was already released. */ }
        }
        worker = null;
        if (error) rejectPending(error);
      }

      function ensureWorker() {
        if (destroyed) throw new Error("The image effects processor was closed.");
        if (worker) return worker;
        if (!root || typeof root.Worker !== "function") {
          throw new Error("Image effects workers are unavailable.");
        }
        worker = new root.Worker(workerUrl);
        worker.addEventListener("message", function (event) {
          const message = event && event.data ? event.data : {};
          const task = pending[message.id];
          if (!task) {
            closeBitmap(message.bitmap);
            return;
          }
          delete pending[message.id];
          if (generations[task.key] !== task.generation) {
            closeBitmap(message.bitmap);
            task.resolve(null);
            return;
          }
          if (!message.ok || !message.bitmap) {
            task.reject(new Error(message.error || "Unable to process the image effect."));
            return;
          }
          if (task.onTiming) task.onTiming(Object.assign({
            captureMs: task.captureMs,
            roundTripMs: performance.now() - task.sentAt,
          }, message.timing || {}));
          task.resolve(message.bitmap);
        });
        worker.addEventListener("error", function (event) {
          const message = event && event.message
            ? event.message
            : "The image effects worker failed.";
          resetWorker(new Error(message));
        });
        return worker;
      }

      function getSourceDimensions(source) {
        if (!source) return { width: 0, height: 0 };
        return {
          width: Number(source.videoWidth || source.naturalWidth || source.width || 0),
          height: Number(source.videoHeight || source.naturalHeight || source.height || 0),
        };
      }

      function createSourceBitmap(source, processOptions) {
        const maxDimension = Math.max(0, Number(processOptions.maxDimension) || 0);
        const size = getSourceDimensions(source);
        const longest = Math.max(size.width, size.height);
        if (maxDimension > 0 && longest > maxDimension) {
          const scale = maxDimension / longest;
          return root.createImageBitmap(source, {
            resizeWidth: Math.max(1, Math.round(size.width * scale)),
            resizeHeight: Math.max(1, Math.round(size.height * scale)),
            resizeQuality: "high",
          }).catch(function () {
            const canvas = new root.OffscreenCanvas(
              Math.max(1, Math.round(size.width * scale)),
              Math.max(1, Math.round(size.height * scale)),
            );
            canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
            return canvas.transferToImageBitmap();
          });
        }
        return root.createImageBitmap(source);
      }

      async function process(source, effect, processOptions) {
        processOptions = processOptions || {};
        if (!source) throw new Error("The image effect source is unavailable.");
        if (!root || typeof root.createImageBitmap !== "function") {
          throw new Error("ImageBitmap processing is unavailable.");
        }
        const key = String(processOptions.key || "default");
        const generation = (generations[key] || 0) + 1;
        generations[key] = generation;
        const captureStart = performance.now();
        const bitmap = await createSourceBitmap(source, processOptions);
        if (destroyed || generations[key] !== generation) {
          closeBitmap(bitmap);
          return null;
        }
        const id = nextId++;
        let activeWorker;
        try {
          activeWorker = ensureWorker();
        } catch (error) {
          closeBitmap(bitmap);
          throw error;
        }
        return new Promise(function (resolve, reject) {
          pending[id] = {
            key: key,
            generation: generation,
            captureMs: performance.now() - captureStart,
            sentAt: performance.now(),
            onTiming: processOptions.onTiming,
            resolve: resolve,
            reject: reject,
          };
          try {
            activeWorker.postMessage({ id: id, bitmap: bitmap, effect: effect, measure: !!processOptions.onTiming, submittedAt: performance.timeOrigin + performance.now() }, [bitmap]);
          } catch (error) {
            delete pending[id];
            closeBitmap(bitmap);
            reject(error);
          }
        });
      }

      function cancel(key) {
        const normalizedKey = String(key || "default");
        generations[normalizedKey] = (generations[normalizedKey] || 0) + 1;
      }

      function destroy() {
        if (destroyed) return;
        destroyed = true;
        resetWorker(new Error("The image effects processor was closed."));
        generations = Object.create(null);
      }

      return {
        process: process,
        cancel: cancel,
        destroy: destroy,
      };
    }

    return {
      DEFAULT_WORKER_URL: DEFAULT_WORKER_URL,
      createProcessor: createProcessor,
      closeBitmap: closeBitmap,
    };
  },
);
