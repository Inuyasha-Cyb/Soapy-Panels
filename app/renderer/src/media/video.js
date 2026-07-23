(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.media = root.SoapyPanels.media || {};
  root.SoapyPanels.media.video = api;
})(
  typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : globalThis,
  function () {
    const MP4_MIME = "video/mp4";
    const MP4_EXPORT_MIN_DIMENSION = 100;
    const MP4_EXPORT_DIMENSION_ERROR_CODE = "MP4_EXPORT_DIMENSIONS_TOO_SMALL";
    const MP4_EXPORT_PLUS_REQUIRED_ERROR_CODE = "MP4_EXPORT_PLUS_REQUIRED";
    const MP4_EXPORT_RESOLUTION_PRESETS = Object.freeze({
      "1080p": Object.freeze({
        id: "1080p",
        width: 1920,
        height: 1080,
        plusOnly: false,
      }),
      "1440p": Object.freeze({
        id: "1440p",
        width: 2560,
        height: 1440,
        plusOnly: true,
      }),
      "4k": Object.freeze({
        id: "4k",
        width: 3840,
        height: 2160,
        plusOnly: true,
      }),
    });
    const MP4_EXPORT_1080P_PIXELS = 1920 * 1080;
    const MP4_EXPORT_1440P_PIXELS = 2560 * 1440;
    const MP4_EXPORT_DEFAULTS = {
      fps: 30,
      maxDurationMs: null,
      stillDurationMs: 2000,
      maxWidth: 1920,
      maxHeight: 1080,
      minWidth: MP4_EXPORT_MIN_DIMENSION,
      minHeight: MP4_EXPORT_MIN_DIMENSION,
      videoBitsPerSecond: 8000000,
    };
    const MP4_RECORDER_MIME_CANDIDATES = [
      'video/mp4;codecs="avc1.42E01E"',
      "video/mp4",
    ];

    function isVideoMime(value) {
      return (
        typeof value === "string" &&
        value.toLowerCase().split(";")[0].trim() === MP4_MIME
      );
    }

    function isMp4Name(value) {
      return typeof value === "string" && /\.mp4(?:$|[?#])/i.test(value);
    }

    function isMp4DataUrl(value) {
      return typeof value === "string" && /^data:video\/mp4(?:;|,)/i.test(value);
    }

    function isMp4Source(value, mimeType) {
      if (isVideoMime(mimeType)) return true;
      if (isMp4DataUrl(value)) return true;
      return isMp4Name(value);
    }

    function isMp4File(file) {
      if (!file) return false;
      if (isVideoMime(file.type)) return true;
      return isMp4Name(file.name);
    }

    function formatDurationTime(seconds) {
      const numeric = Number(seconds);
      const safe = Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
      const totalSeconds = Math.floor(safe);
      const minutes = Math.floor(totalSeconds / 60);
      const remainder = totalSeconds % 60;
      return String(minutes) + ":" + String(remainder).padStart(2, "0");
    }

    function createMp4ExportDimensionError(width, height) {
      const error = new RangeError(
        `MP4 output dimensions must be at least ${MP4_EXPORT_MIN_DIMENSION} × ${MP4_EXPORT_MIN_DIMENSION} pixels; received ${width} × ${height}.`,
      );
      error.name = "Mp4ExportDimensionError";
      error.code = MP4_EXPORT_DIMENSION_ERROR_CODE;
      error.width = width;
      error.height = height;
      error.minimumDimension = MP4_EXPORT_MIN_DIMENSION;
      return error;
    }

    function createMp4ExportPlusRequiredError(options) {
      const details = options || {};
      const error = new Error(
        "An active Soapy Plus subscription is required for MP4 export above 1080p or 30 FPS.",
      );
      error.name = "Mp4ExportPlusRequiredError";
      error.code = MP4_EXPORT_PLUS_REQUIRED_ERROR_CODE;
      error.resolutionId = details.resolutionId || null;
      error.width = details.width;
      error.height = details.height;
      error.fps = details.fps;
      error.maxFreeWidth = details.maxFreeWidth;
      error.maxFreeHeight = details.maxFreeHeight;
      return error;
    }

    function validateMp4ExportDimensions(widthOrOptions, heightValue) {
      const dimensions =
        widthOrOptions && typeof widthOrOptions === "object"
          ? widthOrOptions
          : { width: widthOrOptions, height: heightValue };
      const width = Math.round(Number(dimensions.width));
      const height = Math.round(Number(dimensions.height));
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < MP4_EXPORT_MIN_DIMENSION ||
        height < MP4_EXPORT_MIN_DIMENSION
      ) {
        throw createMp4ExportDimensionError(width, height);
      }
      return {
        width,
        height,
        minimumDimension: MP4_EXPORT_MIN_DIMENSION,
      };
    }

    function resolveMp4ExportDimensions(options) {
      const opts = options || {};
      const defaults = MP4_EXPORT_DEFAULTS;
      const sourceWidth =
        Number.isFinite(opts.canvasWidth) && opts.canvasWidth > 0
          ? Math.round(opts.canvasWidth)
          : 1;
      const sourceHeight =
        Number.isFinite(opts.canvasHeight) && opts.canvasHeight > 0
          ? Math.round(opts.canvasHeight)
          : 1;
      const maxWidth =
        Number.isFinite(opts.maxWidth) && opts.maxWidth > 0
          ? opts.maxWidth
          : defaults.maxWidth;
      const maxHeight =
        Number.isFinite(opts.maxHeight) && opts.maxHeight > 0
          ? opts.maxHeight
          : defaults.maxHeight;

      let scale = 1;
      if (sourceWidth > maxWidth) scale = Math.min(scale, maxWidth / sourceWidth);
      if (sourceHeight > maxHeight) scale = Math.min(scale, maxHeight / sourceHeight);
      if (!Number.isFinite(scale) || scale <= 0) scale = 1;
      scale = Math.min(1, scale);
      let width = Math.max(2, Math.round(sourceWidth * scale));
      let height = Math.max(2, Math.round(sourceHeight * scale));
      if (width % 2) width = Math.max(2, width - 1);
      if (height % 2) height = Math.max(2, height - 1);

      const dimensionsSupported =
        width >= MP4_EXPORT_MIN_DIMENSION && height >= MP4_EXPORT_MIN_DIMENSION;
      return {
        sourceWidth,
        sourceHeight,
        width,
        height,
        scale,
        maxWidth,
        maxHeight,
        minWidth: MP4_EXPORT_MIN_DIMENSION,
        minHeight: MP4_EXPORT_MIN_DIMENSION,
        minimumDimension: MP4_EXPORT_MIN_DIMENSION,
        dimensionsSupported,
        dimensionErrorCode: dimensionsSupported ? null : MP4_EXPORT_DIMENSION_ERROR_CODE,
      };
    }

    function selectMp4RecorderMimeType(isTypeSupported) {
      let supports = isTypeSupported;
      if (
        typeof supports !== "function" &&
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder &&
        typeof MediaRecorder.isTypeSupported === "function"
      ) {
        supports = MediaRecorder.isTypeSupported.bind(MediaRecorder);
      }
      if (typeof supports !== "function") return null;
      for (const candidate of MP4_RECORDER_MIME_CANDIDATES) {
        try {
          if (supports(candidate)) return candidate;
        } catch (_error) {
          /* Ignore broken support probes and try the next candidate. */
        }
      }
      return null;
    }

    function normalizeMp4ResolutionId(value) {
      const id = typeof value === "string" ? value.trim().toLowerCase() : "";
      return Object.prototype.hasOwnProperty.call(MP4_EXPORT_RESOLUTION_PRESETS, id)
        ? id
        : "1080p";
    }

    function normalizeMp4ExportFps(value) {
      return Number(value) === 60 ? 60 : 30;
    }

    function getMp4ExportBounds(resolutionId, canvasWidth, canvasHeight) {
      const id = normalizeMp4ResolutionId(resolutionId);
      const preset = MP4_EXPORT_RESOLUTION_PRESETS[id];
      const width = Number(canvasWidth);
      const height = Number(canvasHeight);
      const portrait = Number.isFinite(width) && Number.isFinite(height) && height > width;
      return {
        resolutionId: id,
        maxWidth: portrait ? preset.height : preset.width,
        maxHeight: portrait ? preset.width : preset.height,
        portrait,
        plusOnly: preset.plusOnly,
      };
    }

    function selectMp4VideoBitrate(width, height, fps) {
      const safeWidth = Number.isFinite(Number(width)) && Number(width) > 0
        ? Number(width)
        : MP4_EXPORT_DEFAULTS.maxWidth;
      const safeHeight = Number.isFinite(Number(height)) && Number(height) > 0
        ? Number(height)
        : MP4_EXPORT_DEFAULTS.maxHeight;
      const pixels = safeWidth * safeHeight;
      const highFrameRate = normalizeMp4ExportFps(fps) === 60;
      if (pixels <= MP4_EXPORT_1080P_PIXELS) return highFrameRate ? 12000000 : 8000000;
      if (pixels <= MP4_EXPORT_1440P_PIXELS) return highFrameRate ? 24000000 : 16000000;
      return highFrameRate ? 53000000 : 35000000;
    }

    function resolveMp4ExportQuality(options) {
      const opts = options || {};
      const resolutionId = normalizeMp4ResolutionId(opts.resolutionId || opts.resolution);
      const fps = normalizeMp4ExportFps(opts.fps);
      const bounds = getMp4ExportBounds(
        resolutionId,
        opts.canvasWidth,
        opts.canvasHeight,
      );
      const dimensions = resolveMp4ExportDimensions({
        canvasWidth: opts.canvasWidth,
        canvasHeight: opts.canvasHeight,
        maxWidth: bounds.maxWidth,
        maxHeight: bounds.maxHeight,
      });
      const requiresPlus = bounds.plusOnly || fps === 60;
      return {
        resolutionId,
        fps,
        maxWidth: bounds.maxWidth,
        maxHeight: bounds.maxHeight,
        width: dimensions.width,
        height: dimensions.height,
        scale: dimensions.scale,
        portrait: bounds.portrait,
        requiresPlus,
        allowed: !requiresPlus || opts.hasPremiumMp4Export === true,
        minimumDimension: dimensions.minimumDimension,
        dimensionsSupported: dimensions.dimensionsSupported,
        dimensionErrorCode: dimensions.dimensionErrorCode,
        videoBitsPerSecond: selectMp4VideoBitrate(dimensions.width, dimensions.height, fps),
      };
    }

    function validateMp4ExportQualityAccess(options) {
      const opts = options || {};
      const width = Math.round(Number(opts.width));
      const height = Math.round(Number(opts.height));
      const fps = Number(opts.fps);
      const requestedResolutionId =
        typeof opts.resolutionId === "string" &&
        Object.prototype.hasOwnProperty.call(
          MP4_EXPORT_RESOLUTION_PRESETS,
          opts.resolutionId.trim().toLowerCase(),
        )
          ? opts.resolutionId.trim().toLowerCase()
          : null;
      const freeBounds = getMp4ExportBounds(
        "1080p",
        opts.canvasWidth,
        opts.canvasHeight,
      );
      const premiumPresetRequested = !!(
        requestedResolutionId &&
        MP4_EXPORT_RESOLUTION_PRESETS[requestedResolutionId].plusOnly
      );
      const exceedsFreeDimensions =
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        (width > freeBounds.maxWidth || height > freeBounds.maxHeight);
      const exceedsFreeFrameRate = Number.isFinite(fps) && fps > 30;
      const requiresPlus =
        premiumPresetRequested || exceedsFreeDimensions || exceedsFreeFrameRate;

      if (requiresPlus && opts.hasPremiumMp4Export !== true) {
        throw createMp4ExportPlusRequiredError({
          resolutionId: requestedResolutionId,
          width,
          height,
          fps,
          maxFreeWidth: freeBounds.maxWidth,
          maxFreeHeight: freeBounds.maxHeight,
        });
      }

      return {
        allowed: true,
        requiresPlus,
        resolutionId: requestedResolutionId,
        width,
        height,
        fps,
        maxFreeWidth: freeBounds.maxWidth,
        maxFreeHeight: freeBounds.maxHeight,
      };
    }

    function buildMp4ExportSpec(options) {
      const opts = options || {};
      const defaults = MP4_EXPORT_DEFAULTS;
      const fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : defaults.fps;
      const frameDelayMs = 1000 / fps;
      const maxDurationMs =
        Number.isFinite(opts.maxDurationMs) && opts.maxDurationMs > 0
          ? opts.maxDurationMs
          : null;
      const stillDurationMs =
        Number.isFinite(opts.stillDurationMs) && opts.stillDurationMs > 0
          ? opts.stillDurationMs
          : defaults.stillDurationMs;
      const dimensions = resolveMp4ExportDimensions(opts);
      validateMp4ExportDimensions(dimensions);

      const durations = Array.isArray(opts.mediaDurationsMs) ? opts.mediaDurationsMs : [];
      let sourceDurationMs = 0;
      for (const value of durations) {
        const duration = Number(value);
        if (Number.isFinite(duration) && duration > sourceDurationMs) {
          sourceDurationMs = duration;
        }
      }
      const hasAnimation = sourceDurationMs > 0;
      const uncappedDurationMs = hasAnimation ? sourceDurationMs : stillDurationMs;
      const durationMs = maxDurationMs
        ? Math.min(maxDurationMs, uncappedDurationMs)
        : uncappedDurationMs;
      const frameCount = Math.max(1, Math.ceil(durationMs / frameDelayMs));

      return {
        fps,
        frameDelayMs,
        sourceDurationMs,
        durationMs,
        frameCount,
        hasAnimation,
        sourceWidth: dimensions.sourceWidth,
        sourceHeight: dimensions.sourceHeight,
        width: dimensions.width,
        height: dimensions.height,
        scale: dimensions.scale,
        maxDurationMs,
        stillDurationMs,
        maxWidth: dimensions.maxWidth,
        maxHeight: dimensions.maxHeight,
        minWidth: dimensions.minWidth,
        minHeight: dimensions.minHeight,
        minimumDimension: dimensions.minimumDimension,
        dimensionsSupported: true,
        dimensionErrorCode: null,
        mimeType:
          typeof opts.mimeType === "string" && opts.mimeType
            ? opts.mimeType
            : selectMp4RecorderMimeType(opts.isTypeSupported),
        videoBitsPerSecond:
          Number.isFinite(opts.videoBitsPerSecond) && opts.videoBitsPerSecond > 0
            ? opts.videoBitsPerSecond
            : defaults.videoBitsPerSecond,
      };
    }

    return {
      MP4_MIME,
      MP4_EXPORT_MIN_DIMENSION,
      MP4_EXPORT_DIMENSION_ERROR_CODE,
      MP4_EXPORT_PLUS_REQUIRED_ERROR_CODE,
      MP4_EXPORT_RESOLUTION_PRESETS,
      MP4_EXPORT_DEFAULTS,
      MP4_RECORDER_MIME_CANDIDATES,
      isVideoMime,
      isMp4Name,
      isMp4DataUrl,
      isMp4Source,
      isMp4File,
      formatDurationTime,
      validateMp4ExportDimensions,
      resolveMp4ExportDimensions,
      selectMp4RecorderMimeType,
      normalizeMp4ResolutionId,
      normalizeMp4ExportFps,
      getMp4ExportBounds,
      selectMp4VideoBitrate,
      resolveMp4ExportQuality,
      validateMp4ExportQualityAccess,
      buildMp4ExportSpec,
    };
  },
);
