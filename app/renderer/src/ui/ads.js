(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.ui = root.SoapyPanels.ui || {};
  root.SoapyPanels.ui.ads = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ADS_CONFIG = Object.freeze({
    enabled: true,
    showOnLoad: true,
    minViewSeconds: 14,
    startDelayMs: 400,
    repeatIntervalMs: 7200000,
    exportsPerAd: 10,
    pairRotationMs: 7000,
    imageSrc: "assets/ads/001.png",
    imageSecondarySrc: "assets/ads/002.png",
    localImages: Object.freeze([
      "assets/ads/001.png",
      "assets/ads/002.png",
      "assets/ads/003.png",
      "assets/ads/004.png",
      "assets/ads/005.png",
      "assets/ads/006.png",
    ]),
    localizedImages: Object.freeze({
      en: Object.freeze([
        "assets/ads/001.png",
        "assets/ads/002.png",
        "assets/ads/003.png",
        "assets/ads/004.png",
        "assets/ads/005.png",
        "assets/ads/006.png",
      ]),
      es: Object.freeze([
        "assets/ads/Languague/Spanish01.png",
        "assets/ads/Languague/Spanish02.png",
        "assets/ads/Languague/Spanish03.png",
        "assets/ads/Languague/Spanish04.png",
        "assets/ads/Languague/Spanish05.png",
        "assets/ads/Languague/Spanish06.png",
      ]),
      "zh-hans": Object.freeze([
        "assets/ads/Languague/Chinese01.png",
        "assets/ads/Languague/Chinese02.png",
        "assets/ads/Languague/Chinese03.png",
        "assets/ads/Languague/Chinese04.png",
        "assets/ads/Languague/Chinese05.png",
        "assets/ads/Languague/Chinese06.png",
      ]),
      ja: Object.freeze([
        "assets/ads/Languague/Japanese01.png",
        "assets/ads/Languague/Japanese02.png",
        "assets/ads/Languague/Japanese03.png",
        "assets/ads/Languague/Japanese04.png",
        "assets/ads/Languague/Japanese05.png",
        "assets/ads/Languague/Japanese06.png",
      ]),
      id: Object.freeze([
        "assets/ads/Languague/Indo01.png",
        "assets/ads/Languague/Indo02.png",
        "assets/ads/Languague/Indo03.png",
        "assets/ads/Languague/Indo04.png",
        "assets/ads/Languague/Indo05.png",
        "assets/ads/Languague/Indo06.png",
      ]),
    }),
    remote: Object.freeze({
      enabled: false,
      type: "iframe",
      src: "",
      allowedHosts: Object.freeze(["example.com"]),
      sandbox: "allow-scripts allow-forms allow-popups",
      referrerPolicy: "no-referrer",
      title: "",
      alt: "",
    }),
  });

  function isSafeAdUrl(src, allowedHosts, baseUrl) {
    if (!src) return false;
    let url;
    try {
      url = new URL(src, baseUrl || "https://invalid.local/");
    } catch {
      return false;
    }
    if (url.protocol !== "https:") return false;
    const host = (url.hostname || "").toLowerCase();
    return (allowedHosts || []).some(function (allowedHost) {
      const allowed = String(allowedHost || "").toLowerCase();
      return !!allowed && (host === allowed || host.endsWith("." + allowed));
    });
  }

  function normalizeAdLocale(locale) {
    const value = String(locale || "").toLowerCase();
    if (value === "zh" || value === "zh-cn" || value === "zh-hans") {
      return "zh-hans";
    }
    return value || "en";
  }

  function create(options) {
    const opts = options && typeof options === "object" ? options : {};
    const host = opts.root || (typeof window !== "undefined" ? window : null);
    const document = host && host.document;
    if (!host || !document) return null;

    const config = opts.config || ADS_CONFIG;
    const translate = typeof opts.translate === "function"
      ? opts.translate
      : function (key) { return key; };
    const getLocale = typeof opts.getLocale === "function"
      ? opts.getLocale
      : function () { return "en"; };
    let countdownTimer = null;
    let repeatTimer = null;
    let pairRotationTimer = null;
    let startupTimer = null;
    let currentPayload = null;
    let currentPairIndex = 0;
    let exportCount = 0;
    let started = false;
    let disabled = false;

    const overlay = document.createElement("div");
    overlay.id = "adsOverlay";
    overlay.className = "gradient-overlay";
    overlay.setAttribute("role", "presentation");
    overlay.setAttribute("aria-hidden", "true");
    overlay.hidden = true;

    const dialog = document.createElement("div");
    dialog.className = "ads-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "adsDialogTitle");
    dialog.tabIndex = -1;

    const header = document.createElement("div");
    header.className = "ads-header";
    const badge = document.createElement("div");
    badge.className = "ads-badge";
    const timer = document.createElement("div");
    timer.className = "ads-timer";
    timer.id = "adsTimer";
    timer.setAttribute("aria-live", "polite");
    header.append(badge, timer);

    const title = document.createElement("h2");
    title.id = "adsDialogTitle";
    const media = document.createElement("div");
    media.className = "ads-media";
    media.id = "adsMedia";

    const footer = document.createElement("div");
    footer.className = "ads-footer";
    const countdown = document.createElement("div");
    countdown.className = "ads-countdown";
    countdown.id = "adsCountdown";
    countdown.setAttribute("aria-live", "polite");
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.id = "adsClose";
    closeButton.disabled = true;
    closeButton.setAttribute("aria-disabled", "true");
    footer.append(countdown, closeButton);

    dialog.append(header, title, media, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function getDefaultAdImages() {
      const sources = Array.isArray(config.localImages)
        ? config.localImages.filter(Boolean)
        : [];
      return sources.length
        ? sources
        : [config.imageSrc, config.imageSecondarySrc].filter(Boolean);
    }

    function getLocalizedAdImages(locale) {
      const localized = config.localizedImages || {};
      const key = normalizeAdLocale(locale || getLocale());
      let sources = Array.isArray(localized[key]) ? localized[key].filter(Boolean) : [];
      if (!sources.length && key !== "en" && Array.isArray(localized.en)) {
        sources = localized.en.filter(Boolean);
      }
      return sources.length ? sources : getDefaultAdImages();
    }

    function resolveAdPayload() {
      const remote = config.remote;
      if (
        remote &&
        remote.enabled &&
        isSafeAdUrl(remote.src, remote.allowedHosts, host.location.href)
      ) {
        if (remote.type === "image") {
          return { type: "image", src: remote.src, alt: remote.alt || translate("ads.alt") };
        }
        return {
          type: "iframe",
          src: remote.src,
          title: remote.title || translate("ads.title"),
          sandbox: remote.sandbox,
          referrerPolicy: remote.referrerPolicy,
        };
      }
      const sources = getLocalizedAdImages(getLocale());
      return {
        type: "image",
        srcs: sources.length ? sources : [config.imageSrc],
        pairSize: 2,
        alt: translate("ads.alt"),
        local: true,
        locale: normalizeAdLocale(getLocale()),
      };
    }

    function getPairSources(payload, pairIndex) {
      let sources = Array.isArray(payload && payload.srcs)
        ? payload.srcs.filter(Boolean)
        : [];
      if (!sources.length && payload && payload.src) sources = [payload.src];
      let pairSize = Number(payload && payload.pairSize);
      if (!Number.isFinite(pairSize) || pairSize <= 0) pairSize = 2;
      const start = Math.max(0, pairIndex || 0) * pairSize;
      const pair = sources.slice(start, start + pairSize);
      return pair.length ? pair : sources.slice(0, pairSize);
    }

    function mountMedia(payload, pairIndex) {
      if (!payload) return;
      media.innerHTML = "";
      media.classList.remove("is-rotating-pair");
      if (payload.type === "iframe") {
        const frame = document.createElement("iframe");
        frame.src = payload.src;
        frame.title = payload.title || translate("ads.title");
        frame.loading = "eager";
        frame.setAttribute("sandbox", payload.sandbox || config.remote.sandbox);
        frame.setAttribute("referrerpolicy", payload.referrerPolicy || "no-referrer");
        media.appendChild(frame);
        media.classList.add("is-single");
        media.classList.remove("is-multi");
        return;
      }
      let sources = Array.isArray(payload.srcs) ? payload.srcs.filter(Boolean) : [];
      if (!sources.length && payload.src) sources = [payload.src];
      if (payload.pairSize) {
        sources = getPairSources(payload, pairIndex);
        media.classList.add("is-rotating-pair");
      }
      media.classList.toggle("is-multi", sources.length > 1);
      media.classList.toggle("is-single", sources.length <= 1);
      sources.forEach(function (src) {
        const image = document.createElement("img");
        image.alt = payload.alt || translate("ads.alt");
        image.loading = "eager";
        image.decoding = "async";
        image.addEventListener("error", function () {
          image.remove();
          if (!media.querySelector("img, iframe")) {
            media.textContent = translate("ads.unavailable");
          }
        });
        image.src = encodeURI(src);
        media.appendChild(image);
      });
    }

    function stopPairRotation() {
      if (pairRotationTimer) host.clearTimeout(pairRotationTimer);
      pairRotationTimer = null;
    }

    function scheduleNextPair() {
      stopPairRotation();
      if (!currentPayload || currentPayload.type !== "image") return;
      const sources = Array.isArray(currentPayload.srcs)
        ? currentPayload.srcs.filter(Boolean)
        : [];
      let pairSize = Number(currentPayload.pairSize);
      if (!Number.isFinite(pairSize) || pairSize <= 0) pairSize = 2;
      const pairCount = Math.ceil(sources.length / pairSize);
      if (pairCount <= 1 || currentPairIndex >= pairCount - 1) return;
      const rotationMs = Number(config.pairRotationMs);
      if (!Number.isFinite(rotationMs) || rotationMs <= 0) return;
      pairRotationTimer = host.setTimeout(function () {
        currentPairIndex += 1;
        mountMedia(currentPayload, currentPairIndex);
        scheduleNextPair();
      }, rotationMs);
    }

    function setClosable(closable) {
      closeButton.disabled = !closable;
      closeButton.setAttribute("aria-disabled", closable ? "false" : "true");
      closeButton.textContent = translate("ads.close");
    }

    function updateStaticText() {
      badge.textContent = translate("ads.badge");
      title.textContent = translate("ads.sponsored");
      if (currentPayload && currentPayload.type === "image") {
        currentPayload.alt = translate("ads.alt");
      }
      setClosable(!closeButton.disabled);
    }

    function formatCountdown(secondsLeft) {
      const seconds = Math.max(0, Math.ceil(secondsLeft));
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;
      return (minutes > 0 ? String(minutes) : "00") + ":" +
        (remainder < 10 ? "0" + remainder : String(remainder));
    }

    function updateCountdown(secondsLeft) {
      timer.textContent = formatCountdown(secondsLeft);
      countdown.textContent = secondsLeft > 0
        ? translate("ads.closeIn", { seconds: Math.ceil(secondsLeft) })
        : translate("ads.closeNow");
    }

    function stopCountdown() {
      if (countdownTimer) host.clearInterval(countdownTimer);
      countdownTimer = null;
    }

    function startCountdown() {
      stopCountdown();
      const duration = Math.max(0, Number(config.minViewSeconds) || 0);
      const startedAt = Date.now();
      setClosable(duration <= 0);
      updateCountdown(duration);
      if (duration <= 0) return;
      countdownTimer = host.setInterval(function () {
        const remaining = Math.max(0, duration - (Date.now() - startedAt) / 1000);
        updateCountdown(remaining);
        if (remaining <= 0) {
          stopCountdown();
          setClosable(true);
        }
      }, 250);
    }

    function stopRepeatTimer() {
      if (repeatTimer) host.clearTimeout(repeatTimer);
      repeatTimer = null;
    }

    function scheduleRepeat() {
      stopRepeatTimer();
      if (disabled || !config.enabled) return;
      const interval = Number(config.repeatIntervalMs);
      if (!Number.isFinite(interval) || interval <= 0) return;
      repeatTimer = host.setTimeout(function () {
        if (!disabled) open("repeat");
      }, interval);
    }

    function isVisible() {
      return !overlay.hidden;
    }

    function open() {
      if (disabled || !config.enabled || isVisible()) return;
      currentPayload = resolveAdPayload();
      currentPairIndex = 0;
      updateStaticText();
      mountMedia(currentPayload, currentPairIndex);
      scheduleNextPair();
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
      dialog.focus();
      startCountdown();
      scheduleRepeat();
    }

    function close() {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      stopCountdown();
      stopPairRotation();
    }

    function disableForEntitlement() {
      disabled = true;
      close();
      stopRepeatTimer();
      if (startupTimer) host.clearTimeout(startupTimer);
      startupTimer = null;
      exportCount = 0;
    }

    function refreshLocale() {
      if (disabled || !isVisible()) return;
      updateStaticText();
      if (!currentPayload || currentPayload.local !== true) return;
      currentPayload = resolveAdPayload();
      currentPairIndex = 0;
      mountMedia(currentPayload, currentPairIndex);
      scheduleNextPair();
    }

    function scheduleStartup() {
      if (disabled || !config.enabled || !config.showOnLoad || started) return;
      started = true;
      const delay = Math.max(0, Number(config.startDelayMs) || 0);
      const trigger = function () {
        startupTimer = host.setTimeout(function () { open("startup"); }, delay);
      };
      if (document.readyState === "complete") trigger();
      else host.addEventListener("load", trigger, { once: true });
    }

    function initialize() {
      if (disabled) return;
      scheduleStartup();
      scheduleRepeat();
    }

    function recordExport() {
      if (disabled || !config.enabled) return;
      const threshold = Number(config.exportsPerAd);
      if (!Number.isFinite(threshold) || threshold <= 0) return;
      exportCount += 1;
      if (exportCount < threshold) return;
      exportCount = 0;
      if (isVisible() || countdownTimer) {
        scheduleRepeat();
        return;
      }
      open("export");
    }

    function destroy() {
      disableForEntitlement();
      overlay.remove();
    }

    closeButton.addEventListener("click", function () {
      if (!closeButton.disabled) close();
    });
    overlay.addEventListener("click", function (event) { event.stopPropagation(); });
    overlay.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    return {
      config,
      close,
      destroy,
      disableForEntitlement,
      initialize,
      isDisabled: function () { return disabled; },
      open,
      recordExport,
      refreshLocale,
    };
  }

  return {
    ADS_CONFIG,
    create,
    isSafeAdUrl,
    normalizeAdLocale,
  };
});
