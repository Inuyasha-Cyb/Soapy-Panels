# Linux live color and paint-reset update

Prepared locally on 2026-11-23 with Node 22.23.2. Version remains
`1.2.1-rc.1`, Linux Community x64. This build supersedes the popup behavior
described in `linux-icon-color-fix.md`; the older artifacts are preserved.

## Changes

- The hue slider displays the full rainbow and a thumb colored with the selected hue.
- Valid color edits update the artwork immediately. Closing the popup, pressing
  Escape, or clicking outside keeps those edits. One popup session forms one undo
  step. Invalid input retains the last valid color. Gradient/effect editors keep
  their enclosing editing workflow; brush colors affect subsequent strokes.
- The canvas eyedropper uses an accessible icon button. Hovering shows an 11×11
  pixel neighborhood at 10× magnification, the center pixel, a swatch, and HEX.
  Clicking selects the color; Escape returns to the popup without selecting.
  The magnifier shares the sampler's artwork rendering and transparency handling,
  excludes editing guides, and does not alter canvas zoom. Updates are capped at
  30 per second, buffers use display resolution, and cancellation releases them.
- New Project clears painted strokes, pending gestures, previews, caches, and
  history. Cancelling New Project preserves the document. Brush preferences remain.
  The paint-reset fix applies to Windows as well; Windows retains its native picker.

No dependencies, project format, version, desktop installation, or sandbox
settings changed. Existing working-tree edits were preserved. No commit, push,
tag, or publication was performed.

## Local test build

`dist/linux-live-color-fix/Soapy.Panels-1.2.1-rc.1-x64.AppImage`

SHA-256: `2ebba4ed2354e36640b51c0ee0a1cf0e171210e54de907a8990175cdc0f50843`

Size: 271,765,693 bytes. Executable permissions: `755`. The matching `.sha256`
file is beside the AppImage.

Launch from the repository directory:

```bash
./dist/linux-live-color-fix/Soapy.Panels-1.2.1-rc.1-x64.AppImage
```

Verify the bytes:

```bash
cd dist/linux-live-color-fix
sha256sum -c Soapy.Panels-1.2.1-rc.1-x64.AppImage.sha256
```

The previous comparison build remains in `dist/linux-icon-color-fix/` and the
downloaded GitHub build remains in
`out/linux-validation/github-ubuntu22-42945915849/app/`.

## Validation

Results and screenshots are under `out/linux-validation/live-color/`.
Desktop launch tests use isolated profiles and preserve the production sandbox.
They cover live color changes, magnified sampling, paint reset, font/image import,
crash recovery, project save/reopen, PNG/JPEG/GIF/MP4 exports, and clean shutdown.

The source tests additionally cover invalid values, keyboard interaction,
removed/disabled controls, failed sampling and retry, gradient/effect controls,
transparent artwork, zoomed/scrolled large images, undo/redo, and late brush
events after New Project. New Project is checked using real mouse strokes and
transparent exported PNG pixels, including save/reopen.

- Structure/version checks, release-tooling lint, and asset-license checks pass.
- Unit tests: 154 passed; one Windows-only test skipped. Integration tests: 10 passed.
- Package checks cover x64, version, Community edition, legal notices,
  desktop entry/icons, and exclusion of Store/advertising components.
  Packaged renderer modules, HTML, CSS, and locales match the source exactly.
- The packaged popup and magnifier screenshots were visually inspected.

| Packaged launch check | Result |
| --- | --- |
| Normal AppImage, Zorin Wayland | Pass |
| Extracted AppRun, Zorin Wayland | Pass |
| Normal AppImage, X11/XWayland | Pass, including native icon pixels |
| Extracted AppRun, X11/XWayland at 200% scaling | Pass, including native icon pixels |
| Unpacked executable, Xvfb | Pass, including native icon pixels |

All final launch reports have empty renderer-error collections. The 200% run's
first paint gesture hit the startup drop hint; the harness now dismisses that
hint before painting, and the full rerun passed. A source style-isolation test
initially compared a button during its hover transition. That test now disables
transitions in the two dialogs it compares. Neither adjustment changes app code.

The final full Electron desktop suite passed all 34 tests under Xvfb; see
`out/linux-validation/live-color/e2e-final.log`. Final backend reports are in
`wayland/`, `x11/`, `x11-hidpi-final/`, and `xvfb/` beneath the diagnostics directory.

The audit thresholds pass: zero production advisories and six moderate
build-tool advisories involving minimatch, @electron/universal, app-builder-lib,
dmg-builder, electron-builder, and electron-builder-squirrel-windows. No high or
critical build advisories were reported. Dependency changes remain outside this fix.

## Remaining release checks

This local Zorin build does not resolve or rerun the separate Ubuntu 24.04 CI
startup failure. Public release still requires that blocker to be resolved.
The user confirmed that the taskbar icon is still missing on Zorin Wayland.
On 2026-11-23, a read-only registry query of the running GNOME Shell 46.0
compositor confirmed that it does not advertise `xdg_toplevel_icon_manager_v1`,
the Wayland protocol for supplying window icon pixels. The capability report is
`out/linux-validation/taskbar-shortcut-preview/wayland-capabilities.json`.
GNOME also cannot resolve an installed `com.soapy.panels.desktop` entry.
The bundled icon and X11 native icon checks passing therefore do not establish
that the Wayland taskbar icon works. This remains a cosmetic compatibility issue.
The user requires the icon to work on first AppImage launch and declined a local
shortcut installation; no desktop entry was installed and no display backend
was forced. Desktop registration or an XWayland fallback would change the
current portability/backend policy and are not implemented in this build.

## Reproduction

Build with `electron-builder --config packaging/electron-builder.linux.json
--linux --x64 --publish never --config.directories.output=dist/linux-live-color-fix`.
Set `SOAPY_LINUX_OUTPUT_DIR=dist/linux-live-color-fix` for checksum and smoke tools.
Use `SOAPY_LINUX_REPORT_DIR` to retain independent diagnostics and
`node tools/testing/smoke-linux.js appimage` (or `extracted`, `unpacked`).
`SOAPY_TEST_OZONE_PLATFORM=x11|wayland` and `SOAPY_TEST_SCALE_FACTOR=1|1.5|2`
select test-only launch settings; ordinary launches keep the desktop defaults.
