const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUserAssetStore } = require('../../app/main/user-assets');
const { gif } = require('../support/gif-security');

test('user GIF assets are bounded, signature-detected, and never fall back to raw file URLs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soapy-gif-assets-'));
  const store = createUserAssetStore();
  try {
    store.initialize(directory);
    const folder = path.join(directory, 'stickers');
    fs.writeFileSync(path.join(folder, 'disguised.png'), gif());
    fs.writeFileSync(
      path.join(folder, 'bomb.gif'),
      gif({ width: 8192, height: 8192, frames: 30 }),
    );
    fs.writeFileSync(path.join(folder, 'large.gif'), gif());
    fs.truncateSync(path.join(folder, 'large.gif'), 32 * 1024 * 1024 + 1);
    fs.writeFileSync(path.join(folder, 'broken.gif'), Buffer.from('GIF89a'));
    const entries = Object.fromEntries(
      store.readUserStickers().map((entry) => [entry.name, entry]),
    );
    assert.equal(entries.disguised.mediaKind, 'gif');
    assert.match(entries.disguised.src, /^data:image\/gif;base64,/);
    for (const name of ['bomb', 'large', 'broken']) {
      assert.equal(entries[name].src, '');
      assert.ok(entries[name].loadErrorCode.startsWith('GIF_'));
    }
    assert.equal(entries.large.loadErrorCode, 'GIF_INPUT_LIMIT');
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
