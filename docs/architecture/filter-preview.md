# Animated filter previews

MP4 and animated GIF previews use a bounded dispatcher and adaptive resolution. Full-resolution exports retain the existing frame preparation and filter math.

## Pipeline

- Video playback schedules work from `requestVideoFrameCallback`. The fallback detects changes in decoded-frame counters (or playback time where counters are unavailable). The 30 FPS limiter uses media timestamps rather than callback arrival times, so callback jitter does not discard valid source frames.
- GIF playback keeps its original frame-index timing. Cached GIF frames still invalidate the background when their playback index changes.
- The renderer coordinator schedules initial, zoom-dependent, and restored previews. Canvas drawing consumes completed bitmaps without submitting filter jobs.
- Each entry has an active request and a replaceable wanted request. A FIFO dispatcher allows one preview capture/filter job globally. A queued request reads the current source and identity when dispatched. Preview work has its own worker so it cannot backlog full-resolution export processing.
- Results carry the entry's media/filter generation. Seeking, replacement, removal, and changed filter settings invalidate stale results. Ordinary playback does not invalidate an active job, allowing it to display while newer frames wait.
- A last valid filtered bitmap stays visible while a new filter result is processed. MP4 retains one result. GIF caches retain the existing device-dependent frame/pixel limits. Removed, superseded, and invalidated bitmaps are explicitly closed.
- Hidden documents stop dispatching previews and cancel recurring video callbacks. Visibility restoration resumes from the current frame. Worker errors stop automatic retries for the failed filter signature; the effects editor displays the failure.

## Quality and interaction

Preview resolution is limited by source size, displayed size × zoom × device pixel ratio, and the existing memory-based cap. Adaptive longest-edge steps are 1280, 960, 720, 540, and 360 pixels. Five consecutive jobs over the 33.3 ms budget lower resolution. Increasing resolution requires 90 fast jobs and enough estimated headroom for the larger pixel count. Pausing and completed paused seeks request a sharper frame within the existing cap.

Slider input is coalesced at 32 ms while dragging; a final change flushes immediately. Adaptation includes work discarded after a newer slider revision, avoiding a quality controller that never adapts during continuous input.

The worker reuses its processing canvas/context and caches up to 16 gradient lookup tables. Alpha, color-space conversion, ordered dithering, and per-frame automatic thresholding retain the existing math. Project serialization and export interfaces are unchanged.

## Diagnostics

In renderer DevTools:

```js
const preview = window.SoapyPanels.debug.filterPreview;
preview.metrics.enable();
preview.metrics.reset();
// Play media or adjust the filter, then inspect:
preview.metrics.snapshot();
preview.queue();
preview.entries();
preview.metrics.enable(false);
```

Metrics keep at most 600 samples per name and report count, mean, p95, and maximum. Timings include capture, dispatcher wait, worker-message wait, filtering, worker round trip, canvas render coordination, displayed-result intervals, result age, and adjustment-to-display latency. Display intervals count changes of filtered bitmaps, not monitor refreshes; control changes can produce more updates than the source frame rate. Multi-layer intervals aggregate per-layer samples, so their reciprocal is not total scene FPS. Cached GIF result age can span multiple loops and is not decoder latency.

## Verification

```sh
node --test test/unit/preview-scheduler.test.js test/unit/effects-runtime.test.js test/unit/effects-parity.test.js
node --test test/e2e/filter-preview.test.js
node tools/development/measure-filter-preview.js --soak-seconds=300 > filter-preview-results.json
```

For a controlled reference, run `node tools/development/prepare-filter-preview-reference.js <pre-change-revision>` and pass the printed temporary directory as `--app-root` to the benchmark. The helper restores the old playback/filter functions and worker modules inside the current app shell, adds display-only instrumentation, and records the exact revision and function list in that temporary directory. It never changes the working app. This compares the preview pipelines, not two complete release builds.

Run the benchmark with one app instance and no concurrent GUI tests. It creates deterministic 30 FPS MP4s through the existing offline encoder and a six-frame 10 FPS GIF. It covers all five filters, continuous adjustments, 4K input, two filtered videos, and optional 30-second resource snapshots over a five-minute soak. It uses a temporary application profile. `--app-root=/path` supports an isolated reference build. Partial reports and error state are preserved if a case fails.

The CPU parity fixtures contain SHA-256 values captured from the pre-optimization filter implementation, including partial alpha, partial strength, dithering, and manual/automatic thresholding. Electron tests cover worker buffer reuse, all filters, hidden/resumed playback, live adjustments, seeking, repeated replacement, cached GIF loops, callback fallback, PNG dimensions/pixels, and a two-second 60-frame MP4 export.

Performance targets are measured goals, not CI timing assertions: at least 28 displayed updates/second for a 1080p/30 clip after adaptation, p95 intervals below 50 ms, and adjustment latency below 100 ms. See the recorded performance report for achieved values and limitations.
