/* global importScripts */
importScripts("effects.js");

let canvas;
let context;

self.addEventListener("message", function (event) {
  const message = event && event.data ? event.data : {};
  const id = message.id;
  let bitmap = message.bitmap;
  try {
    if (!bitmap || !(bitmap.width > 0) || !(bitmap.height > 0)) {
      throw new Error("The image effect source is unavailable.");
    }
    const api = self.SoapyPanels && self.SoapyPanels.images
      ? self.SoapyPanels.images.effects
      : null;
    if (!api || typeof api.processImageData !== "function") {
      throw new Error("The image effects engine did not load.");
    }
    const started = performance.now();
    if (!canvas) {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      context = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    if (!context) throw new Error("Image processing is unavailable.");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === "function") bitmap.close();
    bitmap = null;
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const filterStart = performance.now();
    api.processImageData(imageData, message.effect);
    const filterMs = performance.now() - filterStart;
    context.putImageData(imageData, 0, 0);
    const result = canvas.transferToImageBitmap();
    self.postMessage({ id: id, ok: true, bitmap: result, timing: message.measure ? { filterMs, workerMs: performance.now() - started, workerQueueMs: performance.timeOrigin + started - message.submittedAt } : null }, [result]);
  } catch (error) {
    if (bitmap && typeof bitmap.close === "function") {
      try { bitmap.close(); } catch { /* Resource was already released. */ }
    }
    self.postMessage({
      id: id,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
});
