# Linux release validation — 2026-11-10

Candidate: `1.2.1-rc.1`, Linux Community x64. Prepared locally; no commit,
tag, push or publication was performed. Existing working-tree application changes
were preserved and included in this build.

## Artifact

- File: `dist/linux/Soapy.Panels-1.2.1-rc.1-x64.AppImage`
- Size: 271,756,363 bytes
- SHA-256: `bd20f82b7e99d47b4a83d9f17fe2cee359e71f46dbfddc4fe572962f7ff8d1da`
- Checksum file: `dist/linux/Soapy.Panels-1.2.1-rc.1-x64.AppImage.sha256`

The current artifact passes its checksum, executable permission, AppImage type-2
runtime and ELF x64 checks. Older AppImages in `dist/linux` were left intact and
are not selected by release validation.

## Local environment and completed checks

Host: Zorin OS 18.1 (Ubuntu noble base), x64, kernel `7.0.0-42-generic`.
Node `22.23.2`, npm `10.9.8`, Electron `43.8.4`, electron-builder `26.15.3`.
Dependencies were installed with `npm ci` using the existing lockfile; versions
were not upgraded. This artifact was built locally on Zorin, not Ubuntu 22.04.
The CI workflow will produce and validate a separate Ubuntu-built artifact.

| Check | Result |
| --- | --- |
| Structure, IPC and version consistency | Pass |
| Unit suite | 152 passed, 1 Windows-only test skipped |
| Integration suite | 10 passed |
| Full Electron end-to-end suite | 30 passed under Xvfb |
| Asset licenses | Pass: 434 font files, 141 licensed directories |
| New release-tooling lint and launcher shell syntax | Pass |
| Dependency audit thresholds | Pass; zero production advisories, six moderate build advisories |
| Package version/edition, x64 binary, launcher, legal notices, Store/ad exclusions | Pass |
| Current AppImage checksum and runtime | Pass |
| Unpacked executable, Xvfb display | Pass |
| Normal AppImage, local Zorin desktop | Pass |
| Extracted AppRun, local Zorin desktop | Pass |

All three packaged smoke modes passed startup with sandboxing enabled and an
isolated profile; Community capabilities and absent advertising; bundled
sticker/font/legal assets; user font and image import; forced-crash recovery;
project save to disk, New, and reopen; PNG/JPEG/GIF/MP4 encoding and native file
writes; and clean shutdown. Renderer error collections were empty.

Native file picker selections are automated in these checks. The source
end-to-end harness uses `--no-sandbox`; it does not count as evidence of release
sandbox support. Packaged smoke tests reject that flag. The local host already
had `kernel.apparmor_restrict_unprivileged_userns=0`; this work did not change it,
and these results do not certify default Ubuntu 24.04 AppArmor behavior.

Machine-readable reports, logs and screenshots are under
`out/linux-validation/{unpacked,appimage,extracted}/`. Build, unit/integration,
end-to-end and audit logs are copied into `out/linux-validation/` for this handoff.

## Outstanding release gates

- Run the new GitHub workflow: build on Ubuntu 22.04 and test the **same** artifact
  on Ubuntu 22.04 and 24.04. The workflow was prepared and its YAML parsed locally;
  remote jobs were not triggered. Both normal and extracted launch must pass
  without changing global sandbox policy.
- Complete the [manual desktop acceptance checklist](../../LINUX_APPIMAGE_SMOKE_TEST.md#manual-acceptance-before-publishing),
  including a clean host without development tooling, real native dialogs,
  output inspection in external applications, explicit X11/Wayland testing and
  upgrade/profile preservation.
- Any failure on a target host remains a release blocker. Do not infer broad
  Linux compatibility from the local Zorin results.

## Changes made for release readiness

Updated structure/version checks; corrected the dock regex and missing export
collision fixture; stabilized the dock end-to-end test around animations,
responsive menus, help overlays and saved-document reload. Added explicit x64
artifact naming, checksum generation/verification, a sandbox-preserving AppRun,
package checks and isolated packaged smoke tests. CI now validates pull requests
and manual runs, retains assets/diagnostics, and gates tag publication on the
Ubuntu compatibility matrix. Tests and fixtures are no longer ignored.

The repository-wide lint baseline previously reported 1,248 errors; broad lint
cleanup was not part of this release. Release tooling lint passes. Moderate
build advisories remain in the minimatch dependency chain; audit thresholds were
preserved and no forced dependency downgrade was applied.

Release-note draft: [1.2.1-rc.1 Linux](1.2.1-rc.1-linux.md).

## Draft upload test — 2026-11-10

Created an [unpublished GitHub draft](https://github.com/Inuyasha-Cyb/Soapy-Panels/releases/tag/untagged-f5d4c7c8278a6287aa7c) named
`linux-test-1.2.1-rc.1-20261110` with the AppImage and checksum listed above.
Both assets were downloaded through authenticated access, their SHA-256 check
passed, and both matched the local originals byte for byte.

The latest public release remains `v1.2.0`; no commit, source push, or remote
test tag was created. The draft notes disclose that the artifact was built from
uncommitted source and that Ubuntu CI/manual acceptance remain outstanding.
The upload test does not satisfy those compatibility gates.

Verification metadata is saved in
`out/linux-validation/test-publish/verified.json`.
