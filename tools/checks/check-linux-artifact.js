#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { artifactPath, validateArtifact } = require('../packaging/linux-artifact');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--write')) throw new Error('Usage: check-linux-artifact.js [--write]');
  const checksum = await validateArtifact(artifactPath, { write: args.includes('--write') });
  execFileSync(artifactPath, ['--appimage-version'], { timeout: 15000, stdio: 'pipe' });
  console.log(`Validated Linux x64 AppImage: ${artifactPath}\n${checksum.trim()}`);
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
