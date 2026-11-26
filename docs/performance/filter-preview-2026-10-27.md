# Filter preview validation — 2026-10-27

The preview pipeline now sustains roughly 29–30 filtered updates per second for a single 1080p/30 clip on this reference machine, compared with roughly 4–8 before. This improvement uses adaptive preview resolution: these video runs settled at a 360-pixel longest edge instead of the reference pipeline's 1280. Paused previews sharpen within the existing device cap; export resolution and filter math are preserved.

## Environment and method

- Linux; AMD Ryzen 5 2600; 15.6 GiB RAM; Electron 43.1.1 / Chromium 150.0.7871.114; 1920 × 1032 window; device pixel ratio 1.
- Deterministic, locally encoded two-second 30 FPS color-bar MP4s at 1080p and 4K; six-frame 10 FPS GIF; all five filters; continuous strength adjustments; two filtered video layers.
- One app at a time. Each regular measurement follows a 1.5-second warm-up and lasts four seconds (two seconds for GIFs). These are short diagnostic samples, not a cross-hardware performance guarantee. Development checks briefly overlapped parts of the separate resource soak.
- The reference restores pre-change playback/filter functions and worker modules from revision `be73c3367d6c5b26cedc02a83b420c778c6e7f4d` into the current app shell, with display-only instrumentation. It is a controlled pipeline comparison, not a comparison of complete release builds. The reference filter matches every captured pixel-parity fixture.
- Display frequency is calculated from mean intervals between distinct filtered bitmaps. It is not the monitor refresh rate or a decoder counter.

## Results

| Input/filter | Before updates/s | After updates/s | Before p95 interval (ms) | After p95 interval (ms) |
| --- | ---: | ---: | ---: | ---: |
| 1080p/grayscale | 5.7 | 29.2 | 233.6 | 49.7 |
| 1080p/threshold | 6.1 | 29.6 | 183.5 | 66.6 |
| 1080p/posterize | 4.0 | 29.7 | 267.0 | 50.6 |
| 1080p/duotone | 8.1 | 29.5 | 133.6 | 67.2 |
| 1080p/gradientMap | 6.6 | 29.5 | 166.9 | 65.7 |
| 4k/posterize | 4.3 | 26.1 | 283.7 | 83.4 |

All GIF filters retained their approximately 10 updates/s source timing after caching. The two-video case averaged approximately 20.6 updates/s per layer across the combined interval samples; this is not total scene FPS.

During continuous strength adjustments, input-to-visible-update latency averaged **59.0 ms**, with **86.5 ms p95** and **117.2 ms maximum**. Multiple filter revisions can update the same source frame, so slider-update frequency can exceed 30/s.

The reference completed twelve cases but retained a transient first-frame capture error in its UI after later frames succeeded. The disabled Apply button prevented transition to the final two-video comparison. The reference report preserves that failure and state; no before value is claimed for two videos. The new implementation completed every case.

## Acceptance status

- **Met:** at least 28 updates/s for each single-video 1080p filter after adaptation.
- **Partially met:** p95 display interval below 50 ms. Grayscale reached 49.7 ms; other 1080p filters measured 50.6–67.2 ms. Occasional presentation stalls remain; this work does not guarantee stutter-free playback.
- **Met at p95:** adjustment latency below 100 ms. The maximum exceeded 100 ms, so this is not an absolute latency bound.
- **Met in the resource test:** five minutes of two-video playback retained one filtered frame per video, at most one globally executing preview task, and bounded pending work. Renderer working set ranged from 347.9 to 484.3 MiB and fell during the run; it did not grow monotonically. This is evidence of bounded behavior over the test, not proof against every possible leak.
- **Correctness:** nine focused unit tests and four Electron scenarios cover scheduling, cancellation, errors, pixel parity, alpha, worker canvas reuse, GIF loops, seeking, paused quality, hidden/resumed playback, repeated media replacement, fallback scheduling, PNG output, and a two-second/60-frame MP4 export.

## Repository checks

Focused tests and lint for all changed filter/test/benchmark modules pass. Integration checks pass. Broader checks remain blocked by existing issues outside this change:

- Unit suite: dock-layout styling assertion and automatic export filename numbering fail.
- Whole-repository lint: 1,249 existing errors remain outside the checked modules.
- Structure check: missing required documentation/AGENTS paths and an outdated requirement for package version 1.2.0 (the workspace is 1.2.1-rc.1).

## Reproduce and inspect

See [implementation and diagnostic commands](../architecture/filter-preview.md). The reference preparation helper accepts an explicit pre-change revision and writes only an isolated temporary app.

- [Reference results and failure state](filter-preview-before-2026-10-27.json)
- [Final implementation results](filter-preview-after-2026-10-27.json)
- [Five-minute resource samples](filter-preview-soak-2026-10-27.json)

The resource run preceded a diagnostic-only fix that stopped seek/loop refreshes from being counted as old slider adjustments. Those invalid adjustment samples are excluded from the resource artifact; its display/resource measurements are unaffected. The final performance artifact uses the corrected diagnostic.
