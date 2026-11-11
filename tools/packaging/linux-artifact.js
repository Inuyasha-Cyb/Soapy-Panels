const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const { version } = require('../../package.json');
const artifactName = `Soapy.Panels-${version}-x64.AppImage`;
const artifactPath = path.join(root, 'dist/linux', artifactName);
const checksumPath = `${artifactPath}.sha256`;

function assertX64Elf(header) {
  assert.equal(header.subarray(0, 4).toString('hex'), '7f454c46', 'Not an ELF executable');
  assert.equal(header[4], 2, 'Expected a 64-bit ELF executable');
  assert.equal(header[5], 1, 'Expected little-endian ELF');
  assert.equal(header.readUInt16LE(18), 62, 'Expected x86-64 architecture');
}

async function checksumLine(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return `${hash.digest('hex')}  ${path.basename(filePath)}\n`;
}

async function validateArtifact(filePath = artifactPath, { write = false } = {}) {
  assert.ok(fs.lstatSync(filePath).isFile(), 'AppImage must be a regular file');
  fs.accessSync(filePath, fs.constants.X_OK);
  const file = await fs.promises.open(filePath, 'r');
  const header = Buffer.alloc(20);
  try {
    await file.read(header, 0, header.length, 0);
  } finally {
    await file.close();
  }
  assertX64Elf(header);
  assert.equal(header.subarray(8, 11).toString('hex'), '414902', 'Expected a type-2 AppImage');
  const expected = await checksumLine(filePath);
  if (write) await fs.promises.writeFile(`${filePath}.sha256`, expected);
  assert.equal(await fs.promises.readFile(`${filePath}.sha256`, 'utf8'), expected, 'AppImage checksum mismatch');
  return expected;
}

module.exports = { root, version, artifactName, artifactPath, checksumPath, assertX64Elf, checksumLine, validateArtifact };
