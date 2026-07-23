(function initializeStartupExperience(root) {
  "use strict";

  if (!root || !root.document) return;

  const document = root.document;
  const startedAt =
    root.performance && typeof root.performance.now === "function"
      ? root.performance.now()
      : Date.now();
  const marks = Object.create(null);
  const details = Object.create(null);
  let mainMetrics = null;
  let themeReady = false;
  let canvasReady = false;
  let revealScheduled = false;
  let delayed = false;
  let resolveInteractive = null;

  const whenInteractive = new Promise(function (resolve) {
    resolveInteractive = resolve;
  });

  function now() {
    return root.performance && typeof root.performance.now === "function"
      ? root.performance.now()
      : Date.now() - startedAt;
  }

  function mark(name, value) {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key || Object.prototype.hasOwnProperty.call(marks, key)) {
      return marks[key] ?? null;
    }
    marks[key] = Number.isFinite(value) ? value : now();
    return marks[key];
  }

  function translate(key, fallback) {
    const i18n = root.SoapyPanels && root.SoapyPanels.i18n;
    if (i18n && typeof i18n.t === "function") {
      const value = i18n.t(key);
      if (value && value !== key) return value;
    }
    return fallback;
  }

  function requestFrame(callback) {
    if (typeof root.requestAnimationFrame === "function") {
      root.requestAnimationFrame(callback);
      return;
    }
    root.setTimeout(callback, 16);
  }

  function readPaintEntries() {
    if (!root.performance || typeof root.performance.getEntriesByType !== "function") {
      return [];
    }
    return root.performance.getEntriesByType("paint").map(function (entry) {
      return { name: entry.name, startTime: entry.startTime };
    });
  }

  function readNavigationEntry() {
    if (!root.performance || typeof root.performance.getEntriesByType !== "function") {
      return null;
    }
    const entry = root.performance.getEntriesByType("navigation")[0];
    if (!entry) return null;
    return {
      domInteractive: entry.domInteractive,
      domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
      loadEventEnd: entry.loadEventEnd,
    };
  }

  function getSnapshot() {
    return {
      phase: document.body && document.body.classList.contains("startup-ready")
        ? "interactive"
        : delayed
          ? "delayed"
          : "loading",
      themeReady,
      canvasReady,
      marks: Object.assign({}, marks),
      details: Object.assign({}, details),
      main: mainMetrics,
      paints: readPaintEntries(),
      navigation: readNavigationEntry(),
    };
  }

  function revealWorkspace() {
    if (revealScheduled || !themeReady || !canvasReady) return;
    revealScheduled = true;
    mark("revealScheduled");

    requestFrame(function () {
      mark("revealFrameOne");
      requestFrame(function () {
        const body = document.body;
        const workspace = document.querySelector("[data-startup-workspace]");
        const overlay = document.getElementById("startupOverlay");

        if (workspace) {
          workspace.removeAttribute("inert");
          workspace.setAttribute("aria-hidden", "false");
        }
        if (body) {
          body.classList.remove("startup-pending");
          body.classList.add("startup-ready");
        }
        if (overlay) overlay.setAttribute("aria-hidden", "true");

        mark("interactive");
        if (resolveInteractive) resolveInteractive(getSnapshot());
        root.setTimeout(function () {
          if (overlay) overlay.hidden = true;
        }, 220);
      });
    });
  }

  function markThemeReady(themeDetails) {
    if (themeReady) return;
    themeReady = true;
    details.theme = themeDetails || null;
    mark("themeReady");
    revealWorkspace();
  }

  function markCanvasReady(canvasDetails) {
    if (canvasReady) return;
    canvasReady = true;
    details.canvas = canvasDetails || null;
    mark("canvasReady");
    revealWorkspace();
  }

  function setMainMetrics(metrics) {
    mainMetrics = metrics && typeof metrics === "object" ? metrics : null;
  }

  function showDelayedState() {
    if (document.body && document.body.classList.contains("startup-ready")) return;
    delayed = true;
    mark("delayed");
    const overlay = document.getElementById("startupOverlay");
    const status = document.getElementById("startupStatus");
    const retry = document.getElementById("startupRetry");
    if (overlay) overlay.setAttribute("data-startup-state", "delayed");
    if (status) {
      status.textContent = translate(
        "startup.stillLoading",
        "Soapy Panels is still loading…",
      );
    }
    if (retry) retry.hidden = false;
  }

  function installRetryHandler() {
    const retry = document.getElementById("startupRetry");
    if (!retry || retry.dataset.startupRetryBound === "1") return;
    retry.dataset.startupRetryBound = "1";
    retry.addEventListener("click", function () {
      root.location.reload();
    });
  }

  function applyStaticImageFallback(image) {
    if (!image || image.dataset.staticImageFallbackApplied === "1") return;
    image.dataset.staticImageFallbackApplied = "1";
    const behavior = image.dataset.staticImageFallback;

    if (behavior === "docker-icon") {
      const wrapper = image.closest(".docker-icon");
      if (wrapper) wrapper.classList.add("no-icon");
      image.remove();
      return;
    }

    if (behavior === "next-sibling") {
      const fallback = image.nextElementSibling;
      image.hidden = true;
      if (fallback) fallback.hidden = false;
    }
  }

  function installStaticImageFallbacks() {
    const images = document.querySelectorAll("img[data-static-image-fallback]");
    images.forEach(function (image) {
      image.addEventListener(
        "error",
        function () {
          applyStaticImageFallback(image);
        },
        { once: true },
      );
      if (image.complete && image.naturalWidth === 0) {
        applyStaticImageFallback(image);
      }
    });
  }

  mark("startupControllerLoaded");
  installRetryHandler();
  installStaticImageFallbacks();
  root.setTimeout(showDelayedState, 10000);

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        mark("domContentLoaded");
        installRetryHandler();
      },
      { once: true },
    );
  } else {
    mark("domContentLoaded");
  }

  root.addEventListener(
    "load",
    function () {
      mark("windowLoad");
    },
    { once: true },
  );

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.startup = {
    getSnapshot,
    mark,
    markCanvasReady,
    markThemeReady,
    setMainMetrics,
    whenInteractive,
  };
  root.SoapyPanels.debug = root.SoapyPanels.debug || {};
  root.SoapyPanels.debug.startup = {
    getSnapshot,
    whenInteractive,
  };
})(typeof window !== "undefined" ? window : null);
