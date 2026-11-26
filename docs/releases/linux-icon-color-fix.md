# Linux icon and color-picker update

Prepared locally on 2026-11-20; final verification on 2026-11-22.
Version remains `1.2.1-rc.1`, Linux Community x64. Existing working-tree changes
were preserved. No commit, push, tag, desktop installation, or publication was performed.

## Changes

- Linux windows use the bundled Soapy Panels artwork at 128×128, a taskbar-sized
  bitmap. The desktop identity, generated desktop filename, and window class
  agree on `com.soapy.panels`. Package checks cover the desktop entry and icons.
- Linux color squares open an app-owned popup with a color area, hue slider,
  HEX/RGB fields, original/new previews, and a canvas eyedropper. Changes remain
  drafts until Apply; Cancel/Escape leaves the project unchanged. Windows keeps
  its native picker.
- Canvas sampling uses the existing display-sized artwork renderer, excluding
  editing guides. Sampling cancellation and read failures restore the popup.
  Dynamic gradient/effect controls, disabled/removed targets, keyboard access,
  and translated labels are covered.
- The preload bridge exposes a read-only `platform` value. No project format,
  privileged IPC, capture permissions, sandbox settings, or dependencies changed.

## New local build

`dist/linux-icon-color-fix/Soapy.Panels-1.2.1-rc.1-x64.AppImage`

SHA-256: `3680ddfbb1e79871495e2b8d7dea1c19cf5336b69c091a7e0167698db08b9c59`

Size: 271,760,799 bytes. Executable permissions: `755`. The matching `.sha256`
file is beside the AppImage. The previously downloaded GitHub build remains in
`out/linux-validation/github-ubuntu22-42945915849/app/` and still passes its checksum.

From the repository directory:

```bash
./dist/linux-icon-color-fix/Soapy.Panels-1.2.1-rc.1-x64.AppImage
```

To verify the download/build bytes:

```bash
cd dist/linux-icon-color-fix
sha256sum -c Soapy.Panels-1.2.1-rc.1-x64.AppImage.sha256
```

## Validation

- Structure/version checks: pass.
- Unit tests: 154 passed, one Windows-only test skipped.
- Integration tests: 10 passed.
- Full Electron desktop suite under Xvfb: 32 passed.
- Additional popup tests: cancellation, invalid input, failure/retry, target
  isolation, gradients, effects, undo/redo, save/reopen, large zoomed/scrolled
  artwork, and transparent backdrop matching passed.
- Asset licenses and release-tooling lint: pass.
- Dependency audit thresholds: pass; zero production advisories and the same
  six moderate build-tool advisories.
- Packaged runtime code matches the source. AppImage checksum, x64 architecture,
  version, Community edition, notices, and Store/advertising exclusions pass.

| Final build launch check | Result |
| --- | --- |
| Normal AppImage, Zorin Wayland | Pass |
| Extracted AppRun, Zorin Wayland | Pass |
| Normal AppImage, local X11/XWayland | Pass, including native icon pixels |
| Extracted AppRun, local X11/XWayland | Pass, including native icon pixels |
| Unpacked executable, Xvfb | Pass, including native icon pixels |

Final packaged launch results and screenshots are saved beneath
`out/linux-validation/icon-color-fix/final-*/`. Each smoke run uses an isolated
profile and preserves sandboxing. It exercises the popup and canvas eyedropper,
assets, font/image import, recovery, save/reopen, PNG/JPEG/GIF/MP4 export, and clean shutdown.

The virtual-display smoke initially timed out waiting for its programmatically
triggered file chooser. The harness now uses real File-menu clicks to supply a
fresh user gesture; the rerun passed. This changed test tooling, not application
file-opening behavior. Final reports have empty renderer-error collections.

## Desktop limitations and remaining release gates

The X11 check verifies the window class and complete 128×128 native icon data,
including a pixel comparison against the bundled artwork. The popup screenshot
was visually inspected. GNOME denied desktop screenshot access, so the actual
taskbar appearance on Zorin Wayland still needs a user visual check. A compositor
may require an installed desktop entry for icon association; this portable build
does not install one or force X11.

This local build does not resolve or revalidate the separate Ubuntu 24.04 CI
startup failure. Ubuntu CI and the remaining manual release-acceptance checks
must pass before public publication.

## Reproducing the isolated build checks

Build with `electron-builder --config packaging/electron-builder.linux.json --linux
--x64 --publish never --config.directories.output=dist/linux-icon-color-fix`.
Set `SOAPY_LINUX_OUTPUT_DIR=dist/linux-icon-color-fix` for checksum and smoke commands.
Set `SOAPY_LINUX_REPORT_DIR` to a separate diagnostics directory to preserve prior results.
`SOAPY_TEST_OZONE_PLATFORM=x11` or `wayland` selects a backend only for smoke testing;
normal application startup keeps the desktop's default backend.
