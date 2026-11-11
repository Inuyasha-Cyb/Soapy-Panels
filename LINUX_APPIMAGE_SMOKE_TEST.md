# Linux AppImage installation and release validation

The Linux Community edition is a portable x64 application for Intel/AMD Linux
desktops. It includes themes and MP4 export, with no advertisements or Microsoft
Store purchases. Node.js, npm and a separate Electron installation are not needed
on the user's computer. It does not install a menu shortcut or an automatic updater.

Ubuntu 22.04 and 24.04 are the CI compatibility targets. A passing local test on a
derivative is not a substitute for those checks. Desktop sessions and host sandbox
policies must also be validated before publication.

## Download, verify and launch

Download the AppImage and matching `.sha256` asset from the
[GitHub releases page](https://github.com/Inuyasha-Cyb/Soapy-Panels/releases).
The following names apply to the prepared candidate; it is not published until
these assets appear on that release page.

From the folder containing both files:

```bash
sha256sum -c Soapy.Panels-1.2.1-rc.1-x64.AppImage.sha256
chmod +x Soapy.Panels-1.2.1-rc.1-x64.AppImage
./Soapy.Panels-1.2.1-rc.1-x64.AppImage
```

The checksum command must print `OK`. A checksum detects a damaged or mismatched
file; it is not a digital signature. Run the application as your normal user.

For an upgrade, save your projects, close the old version, download and verify
both new assets, then launch the new AppImage. Keep your `.soapy` project files
and application profile. Replacing the executable does not require deleting the
profile. Back up projects before trying a prerelease; keep the previous AppImage
if you need to return to it.

## FUSE and launch troubleshooting

If the runtime reports a missing FUSE library, install the compatibility package
for your distribution:

```bash
# Ubuntu 22.04 / Debian 12
sudo apt-get install libfuse2

# Ubuntu 24.04 and derivatives based on it
sudo apt-get install libfuse2t64
```

These package names and the extraction fallback are described in the
[AppImage FUSE guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).
Do not replace an existing FUSE 3 installation with FUSE 2.

If FUSE is unavailable, extract into a new directory containing no previous
`squashfs-root`, then launch the extracted application:

```bash
./Soapy.Panels-1.2.1-rc.1-x64.AppImage --appimage-extract
./squashfs-root/AppRun
```

Keep the whole extracted folder together. This fallback avoids mounting the
AppImage; it does not bypass sandbox restrictions.

The release launcher preserves Chromium's sandbox. A message about user
namespaces, AppArmor, or an unusable sandbox is a host compatibility failure,
not a missing FUSE dependency. Record the distribution, desktop session and
terminal output. Resolve application-specific sandbox policy with the distro or
system administrator before treating that host as supported. Do not use
`--no-sandbox` or globally disable AppArmor to make a release validation pass.
See the [AppImage sandbox explanation](https://docs.appimage.org/user-guide/troubleshooting/electron-sandboxing.html).

If a file is executable but permission is denied, check whether its filesystem
is mounted with `noexec`; move the application to an executable filesystem.
For startup or rendering problems, launch it from a terminal and retain the log.

## Build and automated validation

Use Node 22 (at least 22.12.0) and a Linux x64 host. From the repository root:

```bash
npm ci
npm run check
npm run lint:release
npm run licenses:check
npm run audit:security
xvfb-run -a -s '-screen 0 1600x1000x24' npm run test:e2e
npm run dist:linux
npm run check:package:linux
npm run check:artifact:linux
xvfb-run -a -s '-screen 0 1600x1000x24' npm run smoke:linux -- unpacked
xvfb-run -a -s '-screen 0 1600x1000x24' npm run smoke:linux -- appimage
xvfb-run -a -s '-screen 0 1600x1000x24' npm run smoke:linux -- extracted
```

On an interactive desktop, omit `xvfb-run` to validate that session. The smoke
command always creates a private temporary profile, tests actual packaged
startup, and removes its test data. It checks the version, Community features,
sandbox flags, bundled assets, font/image import, crash recovery, project
save/reopen, PNG/JPEG/GIF/MP4 encoding and native file writes, and clean shutdown.
File picker choices are automated. This does not replace manual native-dialog
and desktop validation.

Results, Electron logs and a success screenshot are written under
`out/linux-validation/{unpacked,appimage,extracted}/`. A failed check returns a
nonzero exit code. The existing source end-to-end harness uses `--no-sandbox`;
only the separate packaged smoke commands test sandbox-preserving launch.

`npm run dist:linux` does not publish. It produces exactly these current-version
assets, even if older versions are present in the output directory:

- `dist/linux/Soapy.Panels-1.2.1-rc.1-x64.AppImage`
- `dist/linux/Soapy.Panels-1.2.1-rc.1-x64.AppImage.sha256`

`npm run checksum:linux` regenerates the checksum after an intentional rebuild;
`npm run check:artifact:linux` verifies it without rewriting it. Verification
also checks executable permission, the ELF x64 header, and the AppImage runtime.
The package checker validates the embedded app version and edition, the x64 app
binary, the sandbox-preserving launcher, legal notices and Store/ad exclusions.

The GitHub workflow builds on Ubuntu 22.04, retains the two release assets,
and tests those same bytes on Ubuntu 22.04 and 24.04. Pull requests and manual
runs validate and upload workflow artifacts only. Matching version tags publish
only after all build and compatibility jobs pass. Tests and their fixtures must
be included with the source changes; generated output remains ignored.

## Manual acceptance before publishing

Use disposable desktop VMs or dedicated test accounts, including a fresh host
without Node.js, npm or Electron. Do not uninstall development tools from your
working machine. Record the AppImage checksum and the result of each item:

- Normal launch and extraction fallback work without development tooling.
- First-run language/help screens work; no ads or Store purchase prompts appear.
- Window controls, keyboard shortcuts, menus, dock layout and scaling work in
  the tested X11 and Wayland sessions.
- Create and edit a speech bubble; import an image and a user font. Check bundled
  fonts, stickers, themes and help/legal documents.
- Save a project using the real picker, close the app, reopen the file, and
  verify content. Canceling save/open/export dialogs leaves the editor usable.
- Export PNG, JPEG, GIF and MP4 using the real native dialogs. Open each output
  in another application and inspect the result.
- Interrupt an unsaved session, recover it on restart, then save it. Normal quit
  must close without leaving an unexpected process or recovery prompt.
- Replace an older AppImage with the candidate and confirm projects and profile
  preferences remain available.

Missing evidence, sandbox failures or unsupported media output are outstanding
release gates. Keep the release-note draft and validation record in
`docs/releases/` up to date before publication.
