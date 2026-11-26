# Linux release validation — 2026-11-10

Candidate: `1.2.1-rc.1`, Linux Community x64. The initial local preparation
performed no commit, tag, push or publication. Existing working-tree application
changes were preserved and included in that build. The later GitHub CI follow-up
below records the separately authorized source branch and remote validation.

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

- Resolve the Ubuntu 24.04 startup failure recorded below. Ubuntu 22.04 build
  and both launch modes passed; Ubuntu 24.04 failed both launch modes. Both target
  systems must pass without changing global sandbox policy before publication.
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

## GitHub CI results — verified 2026-11-20

At the user's request, the candidate source was copied into an isolated worktree,
committed and pushed on `ci/linux-1.2.1-rc.1-ubuntu22`, and submitted as
[draft PR #10](https://github.com/Inuyasha-Cyb/Soapy-Panels/pull/10).
The original dirty workspace was preserved. Source commit:
`dadc67443639ec32bc9062deeca98b67aab14538`.

[Actions run 42945915849](https://github.com/Inuyasha-Cyb/Soapy-Panels/actions/runs/42945915849)
completed with these results:

| Check | Result |
| --- | --- |
| Ubuntu 22.04 clean Node 22 build, all source checks and Electron tests | Pass |
| AppImage build, package/artifact checks and unpacked smoke | Pass |
| Same artifact: normal AppImage launch on Ubuntu 22.04 | Pass |
| Same artifact: extraction fallback on Ubuntu 22.04 | Pass |
| Same artifact: normal and extracted launch on Ubuntu 24.04 | Fail at startup |
| Tag publication | Skipped |

Both Ubuntu 22.04 smoke reports have `ok: true` and empty error collections.
They verify sandboxed startup, Community capabilities/assets, font/image import,
editing and crash recovery, project save/reopen, PNG/JPEG/GIF/MP4 encoding and
file writes, and clean shutdown.

The Ubuntu 24.04 job reports Playwright `Process failed to launch!` for both
modes before application checks. No smoke reports were produced. The available
job log does not establish the underlying cause; do not label this an AppArmor
failure without further diagnostics. It remains a release blocker, and the
overall workflow result is **failure**. No sandbox workaround was added.
Manual desktop acceptance remains outstanding.

The Ubuntu-built artifact was downloaded locally and its SHA-256 verified:

- File: `out/linux-validation/github-ubuntu22-42945915849/app/Soapy.Panels-1.2.1-rc.1-x64.AppImage`
- Matching `.sha256` file is beside it.
- Size: 271,757,266 bytes; executable mode `755`; ELF x86-64.
- SHA-256: `6c739394399d9099627233077027943e9fbda6642f60f8acc5f702729ca0c270`

This is a separate Ubuntu build; the original Zorin-built artifact was retained.
Run metadata, job logs and downloaded Ubuntu 22.04 smoke reports are under
`out/linux-validation/github-ubuntu22-42945915849/`.
The PR remains a draft; nothing was merged or publicly released.
