(function (root, factory) {
  var api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.colorSamplerUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function canvasPointToPixel(point, width, height) {
    if (!point || point.inside !== true || !(width > 0) || !(height > 0)) return null;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return {
      x: clamp(Math.floor(point.x), 0, width - 1),
      y: clamp(Math.floor(point.y), 0, height - 1),
    };
  }

  function canvasPointToScaledPixel(point, logicalWidth, logicalHeight, pixelWidth, pixelHeight) {
    if (
      !point ||
      point.inside !== true ||
      !(logicalWidth > 0) ||
      !(logicalHeight > 0) ||
      !(pixelWidth > 0) ||
      !(pixelHeight > 0)
    ) {
      return null;
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return {
      x: clamp(Math.floor((point.x / logicalWidth) * pixelWidth), 0, pixelWidth - 1),
      y: clamp(Math.floor((point.y / logicalHeight) * pixelHeight), 0, pixelHeight - 1),
    };
  }

  function rgbaToHex(rgba) {
    if (!rgba || rgba.length < 3) return null;
    var channels = [rgba[0], rgba[1], rgba[2]];
    if (channels.some(function (channel) { return !Number.isFinite(Number(channel)); })) {
      return null;
    }
    return "#" + channels.map(function (channel) {
      var value = clamp(Math.round(Number(channel)), 0, 255);
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function compositeRgba(rgba, backdrop) {
    var alpha = clamp(Number(rgba[3]) / 255, 0, 1);
    return [0, 1, 2].map(function (index) {
      return Math.round(rgba[index] * alpha + backdrop[index] * (1 - alpha));
    });
  }

  return {
    compositeRgba: compositeRgba,
    canvasPointToPixel: canvasPointToPixel,
    canvasPointToScaledPixel: canvasPointToScaledPixel,
    rgbaToHex: rgbaToHex,
  };
});
