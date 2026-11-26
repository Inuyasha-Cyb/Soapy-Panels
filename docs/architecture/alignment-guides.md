# Bubble alignment guides

The three classic-script modules under `app/renderer/src/selection/` load before
`boot.js` and expose `window.SoapyPanels.selection` APIs plus CommonJS exports.

- `alignment-geometry.js`: rotated body bounds, component unions, immutable drag
  targets, alignment and adjacent-neighbor spacing candidates, deterministic
  per-axis resolution and hysteresis. Preparation sorts anchors once per drag.
  Each update binary-searches nearby anchors and scans filtered rows/columns for
  adjacent pairs, never all target pairs. Entry/release distances are 6/9 CSS
  pixels divided by the actual DOM scale on each axis.
- `alignment-controller.js`: drag identity, held targets and the local
  `sp.alignmentGuides` preference (`off`, `guides`, `snap`, default `guides`). It
  forwards guide descriptors and returns a translation from the original bounds;
  it never changes project objects or history.
- `alignment-overlay.js`: frame-coalesced SVG lines, spacing brackets and localized
  labels. Stroke widths and labels remain constant in screen pixels. Clearing
  cancels pending paint so stale guides cannot reappear.

`boot.js` adapts canvas movement and both anchor movement entry paths, captures
component geometry once, and applies one corrected translation to the existing
captured member frames. Existing pointer-end handlers own the single history
commit. Ctrl (Windows/Linux) or Command (macOS) replays the latest raw pointer
position with snapping bypassed; guides remain visible. Resizing, rotation,
tails, nudging and background movement do not enter the controller.

Release, pointer cancellation, lost capture, blur, selection changes, restoration
and document reset clear guide state. The SVG is a separate interaction element,
not part of the artwork canvas or the project model, so export and recovery
serialization exclude it. Preference changes do not mark the document dirty.

Focused checks:

```sh
node --test test/unit/alignment-*.test.js
node --test test/e2e/alignment-guides.test.js
```

The geometry suite includes 2,000-bubble preparation and repeated-resolution
measurements and candidate-count assertions. Electron tests exercise the real
anchor and canvas drag handlers, modifier replay, equal-spacing labels,
connected-component offsets, cleanup, export isolation and undo/redo.

## Validation record (2026-10-24)

- Focused suite: 18/18 passing (13 unit tests, 5 Electron tests).
- Full unit suite: 63/65 passing. Existing failures: dock-layout CSS assertion and
  automatic export numbering. Integration suite: 1/1 passing.
- Existing Electron suite plus the first four alignment scenarios: 9/10 passing;
  the existing dock-layout test still expects zero panel-style elements but finds
  three. The subsequently added dense-document scenario passes in the focused run.
- New modules/tests and updated structure checker pass ESLint. `boot.js` passes
  syntax checking (the repository excludes it from ESLint). Linting whole locale
  files also reports eight pre-existing `no-var` errors in de/fr/ru/uk headers;
  the new locale entries introduce no code declarations.
- Structure checking accepts the new script order but remains blocked by existing
  missing `app/renderer/AGENTS.md`, architecture/runbook/debugging/decision docs,
  `test/fixtures`, and its stale package-version requirement of 1.2.0. No placeholder
  instructions or unrelated documents were created to bypass those failures.
- Dense geometry probe: 2,000 bubbles, 16.9 ms preparation, 51.5 ms for 200
  resolutions, at most 900 candidate checks. Real Electron probe: one preparation,
  600 candidate checks per final update, 891 ms for pointer-down and five movement
  steps including application rendering and test-driver overhead. These are local
  measurements, not a cross-platform frame-rate guarantee.
