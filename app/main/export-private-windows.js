const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function createWindowsExportPermissions(options = {}) {
  const run = options.execFile || execFile;
  const systemRoot = options.systemRoot || process.env.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new Error(
      'Windows system directory is unavailable. Private exports cannot be created.',
    );
  }
  const executable = path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = fs.readFileSync(
    path.join(__dirname, 'export-private-windows.ps1'),
    'utf8',
  );
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const children = new Set();
  function invoke(request) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = run(
          executable,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            encoded,
          ],
          {
            cwd: path.win32.dirname(executable),
            windowsHide: true,
            timeout: request.action === 'copy' ? 30 * 60 * 1000 : 15000,
            maxBuffer: 64 * 1024,
          },
          (error, stdout) => {
            children.delete(child);
            let result;
            try {
              result = JSON.parse(String(stdout).replace(/^\uFEFF/, ''));
            } catch {
              /* handled below */
            }
            if (!error && result && result.ok) resolve(result);
            else {
              const failure = new Error(
                'Unable to establish private Windows export storage. Check profile permissions and Windows PowerShell availability.',
              );
              failure.code =
                (result && result.code) || 'EXPORT_PRIVATE_STORAGE';
              failure.cause = error;
              reject(failure);
            }
          },
        );
        children.add(child);
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({ ...request, parentPid: process.pid }));
      } catch (error) {
        reject(error);
      }
    });
  }
  return {
    directory: (directory, create) =>
      invoke({ action: 'directory', path: directory, create }),
    file: (file) => invoke({ action: 'file', path: file }),
    copy: (source, destination, automatic) =>
      invoke({ action: 'copy', source, destination, automatic }),
    cancel: () => {
      for (const child of children) child.kill();
    },
  };
}
module.exports = { createWindowsExportPermissions };
