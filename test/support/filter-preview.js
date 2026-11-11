// Deterministic 30 FPS moving color bars encoded with the app's existing offline exporter.
async function makeVideo(page, width = 1920, height = 1080) {
  return page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const media = await window.SoapyPanels.media.mediabunny.ensureLoaded();
    const target = new media.BufferTarget();
    const output = new media.Output({ format: new media.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new media.CanvasSource(canvas, { codec: 'avc', bitrate: 4000000 });
    output.addVideoTrack(source, { frameRate: 30 });
    await output.start();
    for (let frame = 0; frame < 60; frame++) {
      context.fillStyle = '#e04020';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#2060d0';
      context.fillRect((frame * width / 60) % width, 0, width / 3, height);
      await source.add(frame / 30, 1 / 30);
    }
    source.close();
    await output.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }, { width, height });
}
async function selectEffect(page, id, type, acceptReadyBitmap = false) {
  await page.evaluate(({ id, type }) => {
    window.SoapyPanels.debug.effects.openEditor(id);
    const input = document.querySelector('#imageEffectMode');
    input.value = type;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, type });
  await page.waitForFunction(({ id, type, acceptReadyBitmap }) => {
    if (document.querySelector('#imageEffectsStatus').dataset.state === 'success') return true;
    // Old builds can retain a priming error status after a later frame succeeds.
    // Benchmarks measure actual ready frames; UI regression tests keep strict status checks.
    if (!acceptReadyBitmap) return false;
    const entry = window.SoapyPanels.debug.filterPreview.entries().find(entry => entry.id === id);
    return entry && entry.width > 0 && !entry.error && entry.key.includes('"type":"' + type + '"');
  }, { id, type, acceptReadyBitmap });
}
module.exports = { makeVideo, selectEffect };

function makeGif(width = 640, height = 360) {
  const { GifWriter } = require('../../app/renderer/vendor/omggif/omggif');
  const buffer = Buffer.alloc(width * height * 8);
  const writer = new GifWriter(buffer, width, height, { loop: 0, palette: [0xe04020, 0x2060d0] });
  for (let frame = 0; frame < 6; frame++) {
    const pixels = Uint8Array.from({ length: width * height }, (_, i) => (Math.floor((i % width) * 6 / width) + frame) % 2);
    writer.addFrame(0, 0, width, height, pixels, { delay: 10 });
  }
  return 'data:image/gif;base64,' + buffer.subarray(0, writer.end()).toString('base64');
}
module.exports.makeGif = makeGif;
