const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { externalRequestsInNetLog } = require('../../tools/testing/network-log');

test('network observations detect external HTTP/WebSocket requests even in crash-truncated logs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soapy-netlog-test-'));
  const file = path.join(dir, 'network.json');
  try {
    const urls = ['app://index.html/', 'blob:local', 'http://127.0.0.1:1234/',
      'https://example.com/a', 'wss://example.com/socket', 'https://localhost.example.com/'];
    await fs.writeFile(file, '{"events": [\n' + urls.map(url => JSON.stringify({ params: { url } })).join(',\n'));
    assert.deepEqual(await externalRequestsInNetLog(file), urls.slice(3));
    await fs.writeFile(file, '');
    await assert.rejects(externalRequestsInNetLog(file), /network observation log/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
