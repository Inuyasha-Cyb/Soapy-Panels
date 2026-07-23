(function initializeFontCoverageLoader(root) {
  "use strict";

  if (!root || !root.document) return;

  let loadPromise = null;

  function ensureLoaded() {
    if (root.localFontCoverageManifest) {
      return Promise.resolve(root.localFontCoverageManifest);
    }
    if (loadPromise) return loadPromise;

    loadPromise = new Promise(function (resolve, reject) {
      const script = root.document.createElement("script");
      script.src = "assets/fonts/local-font-coverage.manifest.js";
      script.async = true;
      script.dataset.soapyFontCoverage = "true";
      script.addEventListener(
        "load",
        function () {
          if (root.localFontCoverageManifest) {
            resolve(root.localFontCoverageManifest);
            return;
          }
          loadPromise = null;
          reject(new Error("Font coverage data did not load."));
        },
        { once: true },
      );
      script.addEventListener(
        "error",
        function () {
          loadPromise = null;
          reject(new Error("Font coverage data could not be loaded."));
        },
        { once: true },
      );
      root.document.head.appendChild(script);
    });

    return loadPromise;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.fontCoverage = {
    ensureLoaded,
    isLoaded: function () {
      return !!root.localFontCoverageManifest;
    },
  };
})(typeof window !== "undefined" ? window : null);
