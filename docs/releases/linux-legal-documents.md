# Linux Community privacy and license documents

Prepared locally on November 25, 2026. Version remains `1.2.1-rc.1`, Linux x64.

## Changes

Linux now displays its own Privacy Notice and Terms and License. The drafts
commit official Linux Community releases, including future releases, to no user
data collection or transmission. They explain local settings, imported assets,
recovery copies, exports, optional diagnostic logs, and voluntary communication
through external services. Terms and License explains Apache 2.0 permissions,
third-party licenses, artwork ownership, branding, and warranty provisions
without introducing an additional acceptance agreement.

The drafts remain marked for owner/legal approval before publication. Windows
Markdown and PDF documents are byte-for-byte unchanged. Linux's new Help label
is localized in all nine supported locales; the documents themselves are English.

The existing startup-state response now includes edition-selected `helpDocuments`
descriptors (`id`, `fileName`, `titleKey`). Main-process opening and packaging use
the same edition mapping. The document IDs and IPC channel remain unchanged.
Packages include only their edition's PDFs, both embedded and as byte-identical
files accessible to an external reader. Same-origin framing, sandboxing, and
document-ID validation remain enabled. Unknown editions fail rather than opening
another edition's documents.

## Unexpected network request corrected

Fresh-profile monitoring found Chromium downloading a Hunspell spelling
dictionary from Google's CDN. Electron documents this automatic download and
states that the spellchecker does not send typed text to that service:
[Electron spellchecker documentation](https://www.electronjs.org/docs/latest/tutorial/spellchecker).

Linux Community now disables session and window spell checking and clears the
session languages before the first renderer is created. Disabling the window
setting alone did not stop the download. Automatic spelling underlines are
therefore disabled in Linux. Windows retains its existing behavior. No
dependencies were upgraded and no blanket network or sandbox workaround was added.

## Documents and build

- Source: `docs/legal/Soapy_Panels_Linux_Privacy_Notice.md`
- Source: `docs/legal/Soapy_Panels_Linux_Terms_and_License.md`
- Readable PDFs: corresponding filenames in `app/renderer/docs/legal/`
- AppImage: `dist/linux-legal-documents/Soapy.Panels-1.2.1-rc.1-x64.AppImage`
- SHA-256: `379a31aea7563c0d8da753a51ad37a2d404a251928203b8a21675c9ebfc9bb3a`
- Size: 271,769,283 bytes. Executable permissions: `755`.

The matching `.sha256` file is beside the AppImage. Previous AppImages are
preserved. One reproducible older unpacked build directory was removed to free
disk space; its AppImage was retained.

Close the older app, then run from the repository directory:

```bash
./dist/linux-legal-documents/Soapy.Panels-1.2.1-rc.1-x64.AppImage
```

Verify from its output directory:

```bash
sha256sum -c Soapy.Panels-1.2.1-rc.1-x64.AppImage.sha256
```

Regenerate only Linux documents with Python and ReportLab installed:

```bash
python3 tools/legal/generate-legal-pdfs.py --edition linux-community
```

The generator also supports `windows-store` and `all` (default). Linux generation
does not rewrite Windows PDFs. PDFs use deterministic metadata. This preparation
used ReportLab 4.4.5 in an isolated local tools directory, without changing the
application's dependencies.

## Validation

Diagnostics and screenshots: `out/linux-validation/linux-legal-documents/`.

- Unit suite: 159 passed and one Windows-only test skipped; the additional
  edition-specific packaging regression also passed (160 passing unit tests total).
- Integration suite: all 10 passed.
- Legal-document desktop tests passed from Linux source under Xvfb, from the
  normal AppImage, and from an extracted AppImage on the local Zorin desktop.
  Packaged tests use isolated profiles and assert sandboxing remains enabled.
- Tests verify menu and PDF titles, PDF bytes, viewer initialization, page layout,
  scrolling, close/reopen, physical system-reader paths, invalid IDs, and the
  existing opener error message. Embedded document screenshots were inspected.
- The Windows development-edition override passed with its original documents
  and spell checking enabled. A simulated development entitlement suppressed
  its advertising overlay during this document test. This is not a Windows
  binary or operating-system validation.
- Normal and extracted packaged smoke checks passed: assets, live color picker,
  new-project clearing, image/font import, crash recovery, save/reopen,
  PNG/JPEG/GIF/MP4 exports, and clean shutdown.
- Chromium network logs recorded no external HTTP(S)/WebSocket requests during
  the tested Linux flows, including startup and legal-document viewing. Local
  automation connections are excluded. This observation covers Chromium traffic
  in these test scenarios, not every possible OS process or future code change.
- Structure, asset licenses, package content checks, artifact architecture,
  permissions/checksum, targeted ESLint, and whitespace checks passed. Checksums
  confirm the original Windows documents were preserved.

Opening an actual user-selected external PDF-reader application remains a manual
check; automated tests stub that OS opener while verifying its file is readable.
Windows packages and Ubuntu CI were not rebuilt here. The previously reported
Ubuntu 24.04 startup blocker remains separate. No commit, push, or publication.
