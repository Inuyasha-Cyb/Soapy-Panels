(function initializeMediabunnyLoader(root) {
  "use strict";

  if (!root || !root.document) return;

  let loadPromise = null;

  function ensureLoaded() {
    if (root.Mediabunny) return Promise.resolve(root.Mediabunny);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise(function (resolve, reject) {
      const existing = root.document.querySelector(
        'script[data-soapy-mediabunny="true"]',
      );
      const script = existing || root.document.createElement("script");

      function finish() {
        if (root.Mediabunny) {
          resolve(root.Mediabunny);
          return;
        }
        loadPromise = null;
        reject(new Error("Offline MP4 export support did not load."));
      }

      function fail() {
        loadPromise = null;
        reject(new Error("Offline MP4 export support could not be loaded."));
      }

      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", fail, { once: true });
      if (!existing) {
        script.src = "vendor/mediabunny/mediabunny.cjs";
        script.async = true;
        script.dataset.soapyMediabunny = "true";
        root.document.head.appendChild(script);
      }
    });

    return loadPromise;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.media = root.SoapyPanels.media || {};
  root.SoapyPanels.media.mediabunny = {
    ensureLoaded,
    isLoaded: function () {
      return !!root.Mediabunny;
    },
  };
})(typeof window !== "undefined" ? window : null);
