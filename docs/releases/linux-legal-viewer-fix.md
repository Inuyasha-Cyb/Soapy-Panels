# Privacy Notice and Terms viewer fix

Prepared locally on 2026-11-25. Version remains `1.2.1-rc.1`, Linux Community x64.

## Changes

Help → Privacy Notice and Help → Terms of Service now load their bundled PDFs
from the renderer's own origin. The previous `app://docs/...` address selected
the wrong host and path and was blocked by the existing frame security policy.
The policy and renderer sandbox remain enabled.

Open in system viewer now passes a physical PDF under `resources/legal/` to the
OS reader. Previously it passed a path inside `app.asar`, which external readers
cannot open. A shared Linux/Windows after-pack hook copies the embedded PDFs
from the archive; package validation requires byte-identical physical copies.
Using `extraResources` directly for the source PDFs was rejected during testing
because electron-builder removed those files from the archive.

Document IDs remain allowlisted and the trusted IPC checks and visible opener
error message are retained. Legal wording and its existing draft approval status
have not changed. Existing working-tree fixes are included.

## Local build

`dist/linux-legal-viewer-fix/Soapy.Panels-1.2.1-rc.1-x64.AppImage`

SHA-256: `0c89f0d3de72d861dc6b7bee0557e84bed8958481e40c426c04c9914bbe12a23`

Size: 271,769,506 bytes. Permissions: `755`. Matching checksum file is beside the
AppImage. Earlier AppImages are preserved; disposable unpacked build directories
were removed to recover disk space after an initial build failed with ENOSPC.

From the repository directory:

```bash
./dist/linux-legal-viewer-fix/Soapy.Panels-1.2.1-rc.1-x64.AppImage
```

To verify the download/build:

```bash
cd dist/linux-legal-viewer-fix
sha256sum -c Soapy.Panels-1.2.1-rc.1-x64.AppImage.sha256
```

Close the older app first, launch this build, then open the two entries in Help.

## Validation

Diagnostics and document screenshots: `out/linux-validation/legal-viewer/`.

- Unit tests: 157 passed, one Windows-only test skipped. Integration: 10 passed.
- Legal-document desktop regression passed from source under Xvfb, from the
  AppImage on the local Zorin desktop, and from an extracted AppImage. Packaged
  tests use isolated profiles and assert sandboxing is enabled.
- The regression waits for Chromium's PDF viewer to finish loading, verifies
  page layout and scrolling, closes/reopens both documents, checks the actual
  menu button's IPC route, validates readable PDF paths and bytes, rejects
  unknown IDs, and checks the error message when the OS opener fails.
- Embedded document screenshots were visually inspected. Both documents render
  readable text and page controls without document-related CSP errors.
- System opening uses a stub in automated tests; launching a user's chosen
  external PDF-reader application remains a manual check.
- Normal and extracted packaged smoke tests passed: startup, Community
  capabilities, assets, live color picker/sampling, New Project paint clearing,
  font/image import, crash recovery, save/reopen, PNG/JPEG/GIF/MP4 exports, and
  clean shutdown.
- Structure, asset licenses, package contents, checksum, x64 architecture,
  executable permissions, targeted ESLint and whitespace checks passed.

Windows packaging shares the copy hook and path fix but was not built or launched
on this Linux host. Ubuntu 22.04/24.04 CI was not rerun; the previously reported
Ubuntu 24.04 startup blocker remains separate. No commit, push, or publication.
