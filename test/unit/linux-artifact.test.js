const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateArtifact, artifactName, version } = require('../../tools/packaging/linux-artifact');

test('release artifact names select the current version and x64 architecture', () => {
  assert.equal(artifactName, `Soapy.Panels-${version}-x64.AppImage`);
  assert.ok(!artifactName.includes(' '));
});

test('artifact validation rejects tampering, wrong architecture and missing execute permission', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-artifact-'));
  const file = path.join(dir, artifactName);
  const header = Buffer.alloc(64);
  Buffer.from('7f454c4602010000414902', 'hex').copy(header);
  header.writeUInt16LE(62, 18);
  try {
    await fs.writeFile(file, header, { mode: 0o755 });
    await assert.rejects(validateArtifact(file), /ENOENT/);
    const checksum = await validateArtifact(file, { write: true });
    assert.match(checksum, /^[a-f0-9]{64} {2}Soapy\.Panels-/);
    await fs.appendFile(file, 'tampered');
    await assert.rejects(validateArtifact(file), /checksum mismatch/);
    header.writeUInt16LE(183, 18);
    await fs.writeFile(file, header);
    await assert.rejects(validateArtifact(file, { write: true }), /x86-64/);
    header.writeUInt16LE(62, 18);
    await fs.writeFile(file, header);
    if (process.platform !== 'win32') {
      await fs.chmod(file, 0o644);
      await assert.rejects(validateArtifact(file, { write: true }), /EACCES/);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('AppRun preserves arguments and sandboxing regardless of user-namespace probe results', { skip: process.platform !== 'linux' }, async () => {
  const { execFileSync } = require('node:child_process');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-launcher-'));
  try {
    await fs.copyFile(path.join(__dirname, '../../packaging/linux/AppRun'), path.join(dir, 'AppRun'));
    await fs.chmod(path.join(dir, 'AppRun'), 0o755);
    await fs.writeFile(path.join(dir, 'unshare'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await fs.writeFile(path.join(dir, 'soapy-panels'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const output = execFileSync(path.join(dir, 'AppRun'), ['--user-data-dir=/tmp/profile with spaces', '--flag'], { encoding: 'utf8' });
    assert.equal(output, '--user-data-dir=/tmp/profile with spaces\n--flag\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
