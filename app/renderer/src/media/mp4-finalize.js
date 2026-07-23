(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.media = root.SoapyPanels.media || {};
  root.SoapyPanels.media.mp4Finalize = api;
})(
  typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : globalThis,
  function (root) {
    const MP4_MIME = "video/mp4";

    function createAbortError() {
      const error = new Error("MP4 finalization was canceled.");
      error.name = "AbortError";
      return error;
    }

    function throwIfAborted(signal) {
      if (signal && signal.aborted) throw createAbortError();
    }

    function resolveMediaApi(options) {
      const mediaApi =
        options && options.mediaApi ? options.mediaApi : root && root.Mediabunny;
      const required = [
        "Input",
        "BlobSource",
        "Output",
        "Mp4OutputFormat",
        "BufferTarget",
        "Conversion",
      ];
      if (
        !mediaApi ||
        !mediaApi.ALL_FORMATS ||
        required.some(function (name) {
          return typeof mediaApi[name] !== "function";
        })
      ) {
        throw new Error("MP4 finalization support did not load.");
      }
      return mediaApi;
    }

    function reportProgress(callback, value) {
      if (typeof callback !== "function") return;
      const numeric = Number(value);
      callback(Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0);
    }

    async function finalizeMp4Blob(blob, options) {
      options = options || {};
      if (!blob || typeof blob.arrayBuffer !== "function") {
        throw new TypeError("Expected an MP4 Blob to finalize.");
      }

      const mediaApi = resolveMediaApi(options);
      const signal = options.signal || null;
      let input = null;
      let output = null;
      let conversion = null;
      let cancelPromise = null;
      let completed = false;
      let rejectAbort = null;
      let abortListener = null;
      const abortPromise = signal
        ? new Promise(function (_resolve, reject) {
            rejectAbort = reject;
          })
        : null;

      try {
        throwIfAborted(signal);
        const target = new mediaApi.BufferTarget();
        input = new mediaApi.Input({
          source: new mediaApi.BlobSource(blob),
          formats: mediaApi.ALL_FORMATS,
        });
        output = new mediaApi.Output({
          format: new mediaApi.Mp4OutputFormat({ fastStart: "in-memory" }),
          target: target,
        });

        if (signal) {
          abortListener = function () {
            if (conversion && typeof conversion.cancel === "function") {
              cancelPromise = Promise.resolve(conversion.cancel()).catch(function () {});
            } else if (input && typeof input.dispose === "function") {
              input.dispose();
            }
            if (rejectAbort) rejectAbort(createAbortError());
          };
          signal.addEventListener("abort", abortListener, { once: true });
        }

        reportProgress(options.onProgress, 0);
        const videoTracks = await (abortPromise
          ? Promise.race([input.getVideoTracks(), abortPromise])
          : input.getVideoTracks());
        throwIfAborted(signal);
        if (!Array.isArray(videoTracks) || videoTracks.length === 0) {
          throw new Error("The recorded MP4 does not contain a video track.");
        }

        conversion = await (abortPromise
          ? Promise.race([
              mediaApi.Conversion.init({ input: input, output: output }),
              abortPromise,
            ])
          : mediaApi.Conversion.init({ input: input, output: output }));
        throwIfAborted(signal);

        const utilizedTracks = Array.isArray(conversion.utilizedTracks)
          ? conversion.utilizedTracks
          : [];
        const hasVideoConversion = utilizedTracks.some(function (track) {
          return track && track.type === "video";
        });
        if (!conversion.isValid || !hasVideoConversion) {
          throw new Error("The recorded MP4 does not have a valid video-track conversion.");
        }

        conversion.onProgress = function (progress) {
          reportProgress(options.onProgress, progress);
        };
        await (abortPromise
          ? Promise.race([conversion.execute(), abortPromise])
          : conversion.execute());
        throwIfAborted(signal);

        if (!(target.buffer instanceof ArrayBuffer) || target.buffer.byteLength === 0) {
          throw new Error("MP4 finalization produced an empty file.");
        }

        completed = true;
        reportProgress(options.onProgress, 1);
        return new Blob([target.buffer], { type: MP4_MIME });
      } catch (error) {
        if (signal && signal.aborted && (!error || error.name !== "AbortError")) {
          throw createAbortError();
        }
        throw error;
      } finally {
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
        if (cancelPromise) await cancelPromise;
        if (
          !completed &&
          output &&
          typeof output.cancel === "function" &&
          output.state !== "canceled" &&
          output.state !== "finalized"
        ) {
          try {
            await output.cancel();
          } catch (_cancelError) {
            /* Best-effort cleanup after a failed or canceled conversion. */
          }
        }
        if (input && typeof input.dispose === "function" && input.disposed !== true) {
          input.dispose();
        }
      }
    }

    return {
      MP4_MIME,
      finalizeMp4Blob,
    };
  },
);
