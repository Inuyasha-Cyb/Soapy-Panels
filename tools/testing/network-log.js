const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

async function externalRequestsInNetLog(file) {
  const text = await fs.readFile(file, 'utf8');
  assert.match(text, /"events"\s*:/, 'Chromium must create the network observation log');
  // Crash-recovery tests intentionally kill Chromium, so its final JSON closing
  // brackets may be absent. Complete URL fields remain readable in that log.
  const urls = [...text.matchAll(/"url"\s*:\s*("(?:[^"\\]|\\.)*")/g)]
    .map(match => JSON.parse(match[1]));
  return [...new Set(urls.filter(url => {
    if (!/^(https?|wss?):/i.test(url)) return false;
    const host = new URL(url).hostname;
    // Playwright's debugging connections are local to the isolated test run.
    return !['localhost', '127.0.0.1', '[::1]'].includes(host);
  }))];
}

module.exports = { externalRequestsInNetLog };
