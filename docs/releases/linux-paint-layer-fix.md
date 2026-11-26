# Canvas paint and imported-image layering

Prepared locally on 2026-11-24. Version remains `1.2.1-rc.1`, Linux Community x64.

## Behavior

Imported images now cover existing canvas paint immediately. Clicking or painting
on the image no longer causes the old paint to suddenly disappear from above it.
The original canvas strokes remain underneath and reappear when the image moves
or is removed. Transparent image pixels reveal the paint as expected.

Previously, plain images could use HTML preview elements below the background
canvas, while paint was drawn on that canvas. Painting on the image switched it
to canvas rendering and changed the apparent order. Images now use the existing
canvas compositor whenever canvas paint exists. Documents without canvas paint
retain their optimized HTML image previews. Crossing between these states
invalidates image/drag caches and refreshes both foreground and background layers.

The regression was reproduced before the fix: a screen pixel remained red from
the canvas paint where the imported blue image should have covered it. The same
assertion now passes before any further canvas interaction.

No project format, public API, dependency, or version changes. Existing edits,
including the live color picker and Help-menu moves, are included. No commit,
push, publication, desktop installation, or display-backend default change.

## Local AppImage

`dist/linux-paint-layer-fix/Soapy.Panels-1.2.1-rc.1-x64.AppImage`

SHA-256: `a8da9f9bf8e4abbc2fc77c923e2fa8811950707abb1af8edd60ec63e75b58210`

Size: 271,765,531 bytes. Permissions: `755`. The matching `.sha256` file is
beside it. Earlier AppImages remain in their original directories.

From the repository directory:

```bash
./dist/linux-paint-layer-fix/Soapy.Panels-1.2.1-rc.1-x64.AppImage
```

To verify:

```bash
cd dist/linux-paint-layer-fix
sha256sum -c Soapy.Panels-1.2.1-rc.1-x64.AppImage.sha256
```

## Validation

Diagnostics: `out/linux-validation/paint-layer/`.

- Unit tests: 154 passed, one Windows-only test skipped. Integration: 10 passed.
- Four new rendering regressions pass in development and against the actual
  AppImage on Zorin Wayland with an isolated profile and sandboxing enabled.
- The cases cover real paint strokes and imports; screen/export pixel agreement;
  selection and brush clicks; transparent and overlapping images; dragging and
  deletion; undo/redo; save/reopen; New Project; erasing the last canvas stroke;
  foreground-image transitions; and sampling zoomed/scrolled 16000×12000 artwork
  with display-resolution buffers. A filtered image preview also completes.
- Structure, changed test/tooling lint, asset licenses, x64 artifact/checksum,
  package contents, notices, and Community exclusions pass.
- Packaged renderer, Help menu, and picker match current source.
- Normal AppImage smoke on Wayland passes startup, assets, font/image import,
  live picker, recovery, save/reopen, PNG/JPEG/GIF/MP4 export, and clean shutdown.

- Full Electron desktop suite under Xvfb: all 38 tests passed (`e2e.log`).
- Extracted AppRun smoke on Wayland: the same startup, recovery, editing,
  save/reopen, four export formats, and shutdown checks passed. Both final
  packaged smoke reports have empty renderer-error collections and preserve
  sandboxing. Reports are under `wayland/appimage/` and `wayland/extracted/`.

The separate Ubuntu 24.04 CI startup blocker and missing portable Wayland taskbar
icon remain outside this fix. This build has not been published or run in Ubuntu CI.

## Reproduction

Run `node --test test/e2e/canvas-paint-layering.test.js` under a virtual display.
Set `SOAPY_PAINT_TEST_APPIMAGE` to a packaged executable to run the same cases
against production startup; `SOAPY_TEST_OZONE_PLATFORM=wayland` selects Wayland
for that test run only. The helper does not disable the packaged sandbox.

Build with `electron-builder --config packaging/electron-builder.linux.json
--linux --x64 --publish never --config.directories.output=dist/linux-paint-layer-fix`.
Use `SOAPY_LINUX_OUTPUT_DIR=dist/linux-paint-layer-fix` for checksum and packaged
smoke tooling, and a separate `SOAPY_LINUX_REPORT_DIR` to preserve prior reports.
