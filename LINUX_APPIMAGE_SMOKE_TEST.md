# Linux AppImage Smoke Test

This guide verifies that Soapy Panels can be installed and launched from the
GitHub Release without downloading source code or installing Node.js, npm, or
Electron.

Run the test on a disposable Ubuntu or Debian virtual machine or test account.
Do not run the cleanup commands on a development machine that contains other
Node.js projects.

## 1. Download the AppImage and checksum

Open a terminal and download both release assets:

```bash
curl -LO https://github.com/Inuyasha-Cyb/Soapy-Panels/releases/download/v1.2.0/Soapy.Panels-1.2.0.AppImage
curl -LO https://github.com/Inuyasha-Cyb/Soapy-Panels/releases/download/v1.2.0/Soapy.Panels-1.2.0.AppImage.sha256
```

The first command downloads the self-contained application. The second
downloads the checksum file used to verify that the AppImage was not corrupted
or replaced during download.

## 2. Verify the download

Run this command from the directory containing both downloaded files:

```bash
sha256sum -c Soapy.Panels-1.2.0.AppImage.sha256
```

The expected result is:

```text
Soapy.Panels-1.2.0.AppImage: OK
```

Do not launch the file if verification fails. Download both files again and
repeat the check.

## 3. Make the AppImage executable and launch it

```bash
chmod +x Soapy.Panels-1.2.0.AppImage
./Soapy.Panels-1.2.0.AppImage
```

Confirm that Soapy Panels opens and that basic editing and export work. This
AppImage does not yet install a menu shortcut; that will be handled by the
future one-command installer.

If Ubuntu reports that FUSE is unavailable, install the AppImage runtime
dependency and retry:

```bash
sudo apt update
sudo apt install -y libfuse2
```

## 4. Confirm the test environment has no development tooling

Before launching, or after removing the tools, these checks should report that
the commands are not found:

```bash
command -v node || true
command -v npm || true
command -v electron || true
```

The AppImage should launch successfully even when all three commands are
missing.

## Optional: remove Node.js, npm, and Electron on Ubuntu/Debian

Use these commands only on a disposable test machine. They can affect other
Node.js applications on that machine.

First remove globally installed Electron packages while npm is still
available:

```bash
npm uninstall --global electron electron-builder 2>/dev/null || true
```

Then remove the Ubuntu/Debian Node.js and npm packages:

```bash
sudo apt purge -y nodejs npm
sudo apt autoremove -y
```

Electron installed by this repository is project-local, under `node_modules`,
not a separate system executable. If a source checkout is present on the test
machine, remove only that checkout's dependency directory from its repository
root:

```bash
rm -rf ./node_modules
```

Do not run that command from a directory containing other projects. Finally,
verify the tools are gone:

```bash
command -v node || true
command -v npm || true
command -v electron || true
```

All three checks should produce no path. The AppImage test can then be run
again using the commands above.
