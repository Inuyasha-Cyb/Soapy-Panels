(function (root, factory) {
  var api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.selectionHitTestUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function resolveSelectionFallbackHit(primaryHit, px, py, options) {
    if (primaryHit) return primaryHit;

    if (!options) return null;

    if (typeof options.getHits === "function") {
      var hits = options.getHits(px, py);
      if (Array.isArray(hits) && hits.length) {
        return hits[hits.length - 1];
      }
    }

    if (typeof options.getBubbleHit === "function") {
      var bubbleHit = options.getBubbleHit(px, py);
      if (bubbleHit) return bubbleHit;
    }

    if (typeof options.getStickerHit === "function") {
      var stickerHit = options.getStickerHit(px, py);
      if (stickerHit) return stickerHit;
    }

    return null;
  }

  return {
    resolveSelectionFallbackHit: resolveSelectionFallbackHit,
  };
});
