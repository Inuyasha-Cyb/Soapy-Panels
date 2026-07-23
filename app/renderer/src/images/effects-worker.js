importScripts("effects.js");

self.addEventListener("message", function (event) {
  var message = event && event.data ? event.data : {};
  var id = message.id;
  var bitmap = message.bitmap;
  try {
    if (!bitmap || !(bitmap.width > 0) || !(bitmap.height > 0)) {
      throw new Error("The image effect source is unavailable.");
    }
    var api = self.SoapyPanels && self.SoapyPanels.images
      ? self.SoapyPanels.images.effects
      : null;
    if (!api || typeof api.processImageData !== "function") {
      throw new Error("The image effects engine did not load.");
    }
    var canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    var context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image processing is unavailable.");
    context.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === "function") bitmap.close();
    bitmap = null;
    var imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    api.processImageData(imageData, message.effect);
    context.putImageData(imageData, 0, 0);
    var result = canvas.transferToImageBitmap();
    self.postMessage({ id: id, ok: true, bitmap: result }, [result]);
  } catch (error) {
    if (bitmap && typeof bitmap.close === "function") {
      try { bitmap.close(); } catch (_closeError) {}
    }
    self.postMessage({
      id: id,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
});
