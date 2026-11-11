const { GifWriter } = require('../../app/renderer/vendor/omggif/omggif');
function gif({
  width = 2,
  height = 2,
  frames = 2,
  delay = 10,
  disposal = 0,
} = {}) {
  const buffer = Buffer.alloc(frames * 32 + 64);
  const writer = new GifWriter(buffer, width, height, {
    palette: [0, 0xffffff],
  });
  for (let i = 0; i < frames; i++)
    writer.addFrame(0, 0, 1, 1, new Uint8Array([i % 2]), { delay, disposal });
  return buffer.subarray(0, writer.end());
}
function dataUrl(bytes, mime = 'image/gif') {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
module.exports = { gif, dataUrl };
