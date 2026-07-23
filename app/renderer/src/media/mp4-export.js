(function (root, factory) {
  const videoApi =
    typeof module !== "undefined" && module.exports
      ? require("./video")
      : root && root.SoapyPanels && root.SoapyPanels.media
        ? root.SoapyPanels.media.video
        : null;
  const api = factory(root, videoApi);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.media = root.SoapyPanels.media || {};
  root.SoapyPanels.media.mp4Export = api;
})(
  typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : globalThis,
  function (root, videoApi) {
    const MP4_MIME = "video/mp4";
    const DEFAULT_FPS = 30;
    const DEFAULT_VIDEO_BITRATE = 8000000;
    const DEFAULT_AUDIO_BITRATE = 192000;
    const MIX_SAMPLE_RATE = 48000;
    const MIX_CHANNELS = 2;
    const MIX_BLOCK_FRAMES = 4096;
    const MAX_TRACK_PACKET_COUNT = 0xffffffff;
    const AUDIO_PACKET_ESTIMATE_SECONDS = 0.01;
    const AUDIO_PACKET_SAFETY_FACTOR = 4 / 3;
    const AUDIO_PACKET_PADDING = 8;
    const LIMITER_CEILING = Math.pow(10, -1 / 20);

    function createAbortError() {
      const error = new Error("MP4 export was canceled.");
      error.name = "AbortError";
      return error;
    }

    function throwIfAborted(signal) {
      if (signal && signal.aborted) throw createAbortError();
    }

    function validateMaximumPacketCount(value, trackLabel) {
      const label = typeof trackLabel === "string" && trackLabel ? trackLabel : "media";
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > MAX_TRACK_PACKET_COUNT
      ) {
        throw new Error(
          `The MP4 export is too long to reserve ${label} track metadata safely.`,
        );
      }
      return value;
    }

    function calculateCopiedAudioMaximumPacketCount(
      sourcePacketCount,
      totalDuration,
      sourceDuration,
      loop,
    ) {
      const packets = validateMaximumPacketCount(sourcePacketCount, "source audio");
      const outputDuration =
        Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 0;
      const period =
        Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : 0;
      const cycles = loop === true && period > 0 && outputDuration > 0
        ? Math.max(1, Math.ceil(outputDuration / period))
        : 1;
      if (!Number.isSafeInteger(cycles) || cycles < 1) {
        throw new Error("The MP4 export is too long to reserve audio track metadata safely.");
      }
      return validateMaximumPacketCount(packets * cycles, "audio");
    }

    function calculateMixedAudioMaximumPacketCount(durationSeconds, sampleRate) {
      const duration =
        Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
      const rate = Number.isFinite(sampleRate) && sampleRate > 0
        ? sampleRate
        : MIX_SAMPLE_RATE;
      const totalFrames = Math.ceil(duration * rate);
      if (!Number.isSafeInteger(totalFrames) || totalFrames < 0) {
        throw new Error("The MP4 export is too long to reserve audio track metadata safely.");
      }
      const estimatedFramesPerPacket = Math.max(
        1,
        Math.min(512, Math.floor(rate * AUDIO_PACKET_ESTIMATE_SECONDS)),
      );
      const estimatedPackets = Math.ceil(totalFrames / estimatedFramesPerPacket);
      const reservedPackets =
        Math.ceil(estimatedPackets * AUDIO_PACKET_SAFETY_FACTOR) + AUDIO_PACKET_PADDING;
      return validateMaximumPacketCount(reservedPackets, "audio");
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
        "StreamTarget",
        "CanvasSink",
        "CanvasSource",
        "EncodedPacketSink",
        "EncodedAudioPacketSource",
        "AudioBufferSink",
        "AudioSample",
        "AudioSampleSource",
      ];
      if (
        !mediaApi ||
        !mediaApi.ALL_FORMATS ||
        required.some(function (name) {
          return typeof mediaApi[name] !== "function";
        })
      ) {
        throw new Error("Offline MP4 export support did not load.");
      }
      return mediaApi;
    }

    function buildFrameSchedule(durationSeconds, fps) {
      const safeFps = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
      const safeDuration =
        Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
      const frameDuration = 1 / safeFps;
      const frameCount = Math.max(1, Math.ceil(safeDuration * safeFps));
      validateMaximumPacketCount(frameCount, "video");
      const frames = new Array(frameCount);
      for (let index = 0; index < frameCount; index += 1) {
        const timestamp = index * frameDuration;
        frames[index] = {
          index,
          timestamp,
          duration:
            safeDuration > timestamp
              ? Math.min(frameDuration, safeDuration - timestamp)
              : frameDuration,
        };
      }
      return { fps: safeFps, durationSeconds: safeDuration, frameDuration, frameCount, frames };
    }

    function mapVideoTimestamp(timestamp, duration, loop) {
      if (!(duration > 0)) return 0;
      if (loop === true) {
        const wrapped = timestamp % duration;
        return wrapped < 0 ? wrapped + duration : wrapped;
      }
      return Math.max(0, Math.min(timestamp, Math.max(0, duration - 0.000001)));
    }

    function applyPeakLimiter(left, right, state) {
      let peak = 0;
      for (let index = 0; index < left.length; index += 1) {
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
      }
      const targetGain = peak > LIMITER_CEILING ? LIMITER_CEILING / peak : 1;
      if (targetGain < state.gain) {
        state.gain = targetGain;
      } else {
        const blockSeconds = left.length / MIX_SAMPLE_RATE;
        const release = 1 - Math.exp(-blockSeconds / 0.1);
        state.gain = Math.min(1, state.gain + (1 - state.gain) * release);
      }
      for (let index = 0; index < left.length; index += 1) {
        left[index] = Math.max(-LIMITER_CEILING, Math.min(LIMITER_CEILING, left[index] * state.gain));
        right[index] = Math.max(
          -LIMITER_CEILING,
          Math.min(LIMITER_CEILING, right[index] * state.gain),
        );
      }
      return state.gain;
    }

    async function analyzeVideoSources(mediaApi, descriptors, signal) {
      const media = [];
      for (let index = 0; index < descriptors.length; index += 1) {
        throwIfAborted(signal);
        const descriptor = descriptors[index];
        if (!descriptor || !descriptor.blob) {
          throw new Error("An MP4 source is no longer available for export.");
        }
        const input = new mediaApi.Input({
          source: new mediaApi.BlobSource(descriptor.blob),
          formats: mediaApi.ALL_FORMATS,
        });
        try {
          const videoTrack = await input.getPrimaryVideoTrack();
          if (!videoTrack) throw new Error("An MP4 source does not contain a video track.");
          const audioTrack = await input.getPrimaryAudioTrack();
          const duration = await input.computeDuration();
          const videoDuration = await videoTrack.computeDuration();
          media.push({
            id: String(descriptor.id || index),
            input,
            videoTrack,
            audioTrack,
            duration: duration > 0 ? duration : videoDuration,
            videoDuration,
            muted: descriptor.muted !== false,
            loop: descriptor.loop === true,
          });
        } catch (error) {
          input.dispose();
          throw error;
        }
      }
      return media;
    }

    function createVideoCursors(mediaApi, media, schedule) {
      return media.map(function (item) {
        const timestamps = schedule.frames.map(function (frame) {
          return mapVideoTimestamp(frame.timestamp, item.duration, item.loop);
        });
        const sink = new mediaApi.CanvasSink(item.videoTrack, { poolSize: 2 });
        return {
          id: item.id,
          iterator: sink.canvasesAtTimestamps(timestamps)[Symbol.asyncIterator](),
        };
      });
    }

    async function renderVideoFrames(options) {
      const {
        canvas,
        canvasSource,
        cursors,
        schedule,
        renderFrame,
        signal,
        onProgress,
      } = options;
      const context = canvas.getContext("2d");
      for (let index = 0; index < schedule.frames.length; index += 1) {
        throwIfAborted(signal);
        const frame = schedule.frames[index];
        const sources = Object.create(null);
        for (let cursorIndex = 0; cursorIndex < cursors.length; cursorIndex += 1) {
          const cursor = cursors[cursorIndex];
          const next = await cursor.iterator.next();
          sources[cursor.id] = next && !next.done && next.value ? next.value.canvas : null;
        }
        const rendered = await renderFrame({
          timeSeconds: frame.timestamp,
          mediaTimeMs: frame.timestamp * 1000,
          frameSources: sources,
        });
        if (!rendered) throw new Error("Failed to render an MP4 export frame.");
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(rendered, 0, 0, rendered.width, rendered.height, 0, 0, canvas.width, canvas.height);
        await canvasSource.add(frame.timestamp, frame.duration, {
          keyFrame: index % Math.max(1, Math.round(schedule.fps * 2)) === 0,
        });
        if (typeof onProgress === "function") {
          onProgress(0.05 + ((index + 1) / schedule.frameCount) * 0.82);
        }
      }
    }

    async function pumpCopiedAudio(mediaApi, item, source, totalDuration, signal) {
      const track = item.audioTrack;
      const decoderConfig = await track.getDecoderConfig();
      if (!decoderConfig) throw new Error("The source audio configuration could not be read.");
      const packetSink = new mediaApi.EncodedPacketSink(track);
      const period = item.duration > 0 ? item.duration : totalDuration;
      let first = true;
      let cycleStart = 0;
      do {
        for await (const packet of packetSink.packets()) {
          throwIfAborted(signal);
          const timestamp = packet.timestamp + cycleStart;
          if (timestamp >= totalDuration) break;
          if (timestamp + packet.duration <= 0) continue;
          await source.add(
            cycleStart === 0 ? packet : packet.clone({ timestamp }),
            first ? { decoderConfig } : undefined,
          );
          first = false;
        }
        if (!item.loop || !(period > 0)) break;
        cycleStart += period;
      } while (cycleStart < totalDuration);
    }

    async function resetAudioCursor(cursor, cycle) {
      if (cursor.iterator && typeof cursor.iterator.return === "function") {
        try {
          await cursor.iterator.return();
        } catch (_error) {}
      }
      cursor.iterator = cursor.sink.buffers()[Symbol.asyncIterator]();
      cursor.current = null;
      cursor.ended = false;
      cursor.cycle = cycle;
    }

    async function advanceAudioCursor(cursor) {
      if (cursor.ended) return null;
      const next = await cursor.iterator.next();
      if (!next || next.done || !next.value) {
        cursor.current = null;
        cursor.ended = true;
        return null;
      }
      cursor.current = next.value;
      return cursor.current;
    }

    async function mixCursorRange(cursor, sourceStart, outputOffset, frameCount, left, right) {
      let position = 0;
      while (position < frameCount) {
        const sourceTime = sourceStart + position / MIX_SAMPLE_RATE;
        while (
          !cursor.ended &&
          (!cursor.current || cursor.current.timestamp + cursor.current.duration <= sourceTime + 1e-9)
        ) {
          await advanceAudioCursor(cursor);
        }
        if (!cursor.current) break;

        if (cursor.current.timestamp > sourceTime) {
          const gapFrames = Math.max(
            1,
            Math.ceil((cursor.current.timestamp - sourceTime) * MIX_SAMPLE_RATE),
          );
          position += Math.min(frameCount - position, gapFrames);
          continue;
        }

        const wrapped = cursor.current;
        const buffer = wrapped.buffer;
        const sourceRate = buffer.sampleRate;
        const channels = buffer.numberOfChannels;
        const channelLeft = buffer.getChannelData(0);
        const channelRight = channels > 1 ? buffer.getChannelData(1) : channelLeft;
        const bufferEnd = wrapped.timestamp + wrapped.duration;
        const availableFrames = Math.max(
          1,
          Math.ceil((bufferEnd - sourceTime) * MIX_SAMPLE_RATE),
        );
        const end = Math.min(frameCount, position + availableFrames);
        for (; position < end; position += 1) {
          const timestamp = sourceStart + position / MIX_SAMPLE_RATE;
          const sourceIndex = Math.max(0, (timestamp - wrapped.timestamp) * sourceRate);
          const base = Math.min(channelLeft.length - 1, Math.floor(sourceIndex));
          const nextIndex = Math.min(channelLeft.length - 1, base + 1);
          const fraction = sourceIndex - base;
          const l = channelLeft[base] + (channelLeft[nextIndex] - channelLeft[base]) * fraction;
          const r = channelRight[base] + (channelRight[nextIndex] - channelRight[base]) * fraction;
          left[outputOffset + position] += l;
          right[outputOffset + position] += r;
        }
      }
    }

    async function mixCursorBlock(cursor, startTime, frameCount, left, right) {
      let outputOffset = 0;
      while (outputOffset < frameCount) {
        const globalTime = startTime + outputOffset / MIX_SAMPLE_RATE;
        const period = cursor.item.duration;
        if (!(period > 0)) break;
        const cycle = cursor.item.loop ? Math.floor(globalTime / period) : 0;
        if (!cursor.item.loop && globalTime >= period) break;
        if (cursor.cycle !== cycle || !cursor.iterator) await resetAudioCursor(cursor, cycle);
        const sourceStart = cursor.item.loop ? globalTime - cycle * period : globalTime;
        const untilBoundary = cursor.item.loop
          ? Math.max(1, Math.ceil((period - sourceStart) * MIX_SAMPLE_RATE))
          : frameCount - outputOffset;
        const count = Math.min(frameCount - outputOffset, untilBoundary);
        await mixCursorRange(cursor, sourceStart, outputOffset, count, left, right);
        outputOffset += count;
      }
    }

    async function pumpMixedAudio(mediaApi, items, source, totalDuration, signal) {
      const cursors = items.map(function (item) {
        return {
          item,
          sink: new mediaApi.AudioBufferSink(item.audioTrack),
          iterator: null,
          current: null,
          ended: false,
          cycle: -1,
        };
      });
      const limiter = { gain: 1 };
      const totalFrames = Math.ceil(totalDuration * MIX_SAMPLE_RATE);
      for (let startFrame = 0; startFrame < totalFrames; startFrame += MIX_BLOCK_FRAMES) {
        throwIfAborted(signal);
        const frameCount = Math.min(MIX_BLOCK_FRAMES, totalFrames - startFrame);
        const left = new Float32Array(frameCount);
        const right = new Float32Array(frameCount);
        const startTime = startFrame / MIX_SAMPLE_RATE;
        for (let index = 0; index < cursors.length; index += 1) {
          await mixCursorBlock(cursors[index], startTime, frameCount, left, right);
        }
        if (items.length > 1) applyPeakLimiter(left, right, limiter);
        const planar = new Float32Array(frameCount * MIX_CHANNELS);
        planar.set(left, 0);
        planar.set(right, frameCount);
        const sample = new mediaApi.AudioSample({
          data: planar.buffer,
          format: "f32-planar",
          numberOfChannels: MIX_CHANNELS,
          sampleRate: MIX_SAMPLE_RATE,
          timestamp: startTime,
        });
        try {
          await source.add(sample);
        } finally {
          sample.close();
        }
      }
      for (let index = 0; index < cursors.length; index += 1) {
        if (cursors[index].iterator && typeof cursors[index].iterator.return === "function") {
          try {
            await cursors[index].iterator.return();
          } catch (_error) {}
        }
      }
    }

    async function encodeMp4Composition(options) {
      options = options || {};
      const width = Math.max(2, Math.round(Number(options.width) || 2));
      const height = Math.max(2, Math.round(Number(options.height) || 2));
      if (!videoApi || typeof videoApi.validateMp4ExportDimensions !== "function") {
        throw new Error("MP4 dimension validation support did not load.");
      }
      videoApi.validateMp4ExportDimensions({ width, height });
      const mediaApi = resolveMediaApi(options);
      const signal = options.signal || null;
      const descriptors = Array.isArray(options.videos) ? options.videos : [];
      const media = [];
      let output = null;
      let completed = false;
      let abortListener = null;

      try {
        throwIfAborted(signal);
        media.push(...(await analyzeVideoSources(mediaApi, descriptors, signal)));
        const videoDuration = media.reduce(function (maximum, item) {
          return Math.max(maximum, item.duration || 0);
        }, 0);
        const nonVideoDuration =
          Number.isFinite(options.nonVideoDurationMs) && options.nonVideoDurationMs > 0
            ? options.nonVideoDurationMs / 1000
            : 0;
        const stillDuration =
          Number.isFinite(options.stillDurationMs) && options.stillDurationMs > 0
            ? options.stillDurationMs / 1000
            : 2;
        const naturalDuration = Math.max(
          videoDuration,
          nonVideoDuration,
          media.length ? 0 : stillDuration,
        );
        const maximumDuration =
          Number.isFinite(options.maxDurationMs) && options.maxDurationMs > 0
            ? options.maxDurationMs / 1000
            : null;
        const duration = maximumDuration
          ? Math.min(naturalDuration, maximumDuration)
          : naturalDuration;
        const schedule = buildFrameSchedule(duration, options.fps);
        const canvas = options.canvas;
        if (!canvas || typeof canvas.getContext !== "function") {
          throw new Error("Offline MP4 export requires a canvas.");
        }

        const target = options.target || new mediaApi.BufferTarget();
        const fastStart = options.fastStart !== undefined
          ? options.fastStart
          : options.target
            ? "reserve"
            : "in-memory";
        const format = new mediaApi.Mp4OutputFormat({
          fastStart,
        });
        output = new mediaApi.Output({ format, target });
        const canvasSource = new mediaApi.CanvasSource(canvas, {
          codec: "avc",
          bitrate:
            Number.isFinite(options.videoBitsPerSecond) && options.videoBitsPerSecond > 0
              ? options.videoBitsPerSecond
              : DEFAULT_VIDEO_BITRATE,
          keyFrameInterval: 2,
          latencyMode: "quality",
        });
        output.addVideoTrack(canvasSource, {
          frameRate: schedule.fps,
          maximumPacketCount: validateMaximumPacketCount(schedule.frameCount, "video"),
        });

        const audible = media.filter(function (item) {
          return item.muted === false && item.audioTrack;
        });
        let audioSource = null;
        let audioMode = "none";
        let audioMaximumPacketCount = null;
        if (audible.length === 1) {
          const codec = await audible[0].audioTrack.getCodec();
          if (codec && format.getSupportedCodecs().includes(codec)) {
            const packetStats = await audible[0].audioTrack.computePacketStats();
            throwIfAborted(signal);
            audioSource = new mediaApi.EncodedAudioPacketSource(codec);
            audioMode = "copy";
            audioMaximumPacketCount = calculateCopiedAudioMaximumPacketCount(
              packetStats && packetStats.packetCount,
              schedule.durationSeconds,
              audible[0].duration,
              audible[0].loop,
            );
          }
        }
        if (audible.length && !audioSource) {
          audioSource = new mediaApi.AudioSampleSource({
            codec: "aac",
            bitrate: DEFAULT_AUDIO_BITRATE,
          });
          audioMode = "mix";
          audioMaximumPacketCount = calculateMixedAudioMaximumPacketCount(
            schedule.durationSeconds,
            MIX_SAMPLE_RATE,
          );
        }
        if (audioSource) {
          output.addAudioTrack(audioSource, {
            maximumPacketCount: validateMaximumPacketCount(
              audioMaximumPacketCount,
              "audio",
            ),
          });
        }

        if (signal) {
          abortListener = function () {
            if (output && typeof output.cancel === "function") {
              Promise.resolve(output.cancel()).catch(function () {});
            }
          };
          signal.addEventListener("abort", abortListener, { once: true });
        }

        if (typeof options.onProgress === "function") options.onProgress(0.03);
        await output.start();
        const cursors = createVideoCursors(mediaApi, media, schedule);
        const videoPromise = renderVideoFrames({
          canvas,
          canvasSource,
          cursors,
          schedule,
          renderFrame: options.renderFrame,
          signal,
          onProgress: options.onProgress,
        });
        let audioPromise = Promise.resolve();
        if (audioMode === "copy") {
          audioPromise = pumpCopiedAudio(
            mediaApi,
            audible[0],
            audioSource,
            schedule.durationSeconds,
            signal,
          );
        } else if (audioMode === "mix") {
          audioPromise = pumpMixedAudio(
            mediaApi,
            audible,
            audioSource,
            schedule.durationSeconds,
            signal,
          );
        }
        await Promise.all([videoPromise, audioPromise]);
        throwIfAborted(signal);
        if (typeof options.onProgress === "function") options.onProgress(0.9);
        await output.finalize();
        throwIfAborted(signal);
        completed = true;
        if (typeof options.onProgress === "function") options.onProgress(1);

        let blob = null;
        if (target.buffer instanceof ArrayBuffer) {
          blob = new Blob([target.buffer], { type: MP4_MIME });
        }
        return {
          blob,
          durationMs: Math.round(schedule.durationSeconds * 1000),
          frameCount: schedule.frameCount,
          fps: schedule.fps,
          audioTrackCount: audioSource ? 1 : 0,
          audioMode,
        };
      } catch (error) {
        if (signal && signal.aborted && (!error || error.name !== "AbortError")) {
          throw createAbortError();
        }
        throw error;
      } finally {
        if (signal && abortListener) signal.removeEventListener("abort", abortListener);
        if (!completed && output && output.state !== "canceled") {
          try {
            await output.cancel();
          } catch (_error) {}
        }
        for (let index = 0; index < media.length; index += 1) {
          if (media[index].input && media[index].input.disposed !== true) {
            media[index].input.dispose();
          }
        }
      }
    }

    function createStreamTarget(writable, options) {
      const mediaApi = resolveMediaApi(options || {});
      return new mediaApi.StreamTarget(writable, {
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
      });
    }

    return {
      MP4_MIME,
      DEFAULT_FPS,
      DEFAULT_VIDEO_BITRATE,
      DEFAULT_AUDIO_BITRATE,
      MIX_SAMPLE_RATE,
      MAX_TRACK_PACKET_COUNT,
      LIMITER_CEILING,
      buildFrameSchedule,
      mapVideoTimestamp,
      applyPeakLimiter,
      validateMaximumPacketCount,
      calculateCopiedAudioMaximumPacketCount,
      calculateMixedAudioMaximumPacketCount,
      createStreamTarget,
      encodeMp4Composition,
    };
  },
);
