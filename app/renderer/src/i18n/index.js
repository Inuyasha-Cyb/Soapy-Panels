window.SoapyPanels = window.SoapyPanels || {};

(function () {
  var DEFAULT_LOCALE = "en";
  var STORAGE_KEY = "sp.locale";
  var locales = window.SoapyPanels.i18nLocales || {};
  var applying = false;
  var currentLocale = readStoredLocale() || DEFAULT_LOCALE;

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
  }

  function getCatalog(locale) {
    return locales[locale] || locales[DEFAULT_LOCALE] || {};
  }

  function getAvailableLocales() {
    return Object.keys(locales).filter(function (locale) {
      return !!locales[locale];
    });
  }

  function normalizeLocale(locale) {
    var value = String(locale || "").toLowerCase();
    if (hasOwn(locales, value)) return value;
    var base = value.split("-")[0];
    if (hasOwn(locales, base)) return base;
    return DEFAULT_LOCALE;
  }

  function readRawStoredLocale() {
    try {
      if (typeof localStorage === "undefined") return "";
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch (_e) {
      return "";
    }
  }

  function isSupportedLocale(locale) {
    var value = String(locale || "").toLowerCase();
    if (!value) return false;
    if (hasOwn(locales, value)) return true;
    var base = value.split("-")[0];
    return hasOwn(locales, base);
  }

  function hasStoredLocale() {
    return isSupportedLocale(readRawStoredLocale());
  }

  function readStoredLocale() {
    return hasStoredLocale() ? normalizeLocale(readRawStoredLocale()) : "";
  }

  function writeStoredLocale(locale) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(STORAGE_KEY, locale);
    } catch (_e) { }
  }

  function lookupString(locale, key) {
    var catalog = getCatalog(locale);
    if (catalog.strings && hasOwn(catalog.strings, key)) return catalog.strings[key];
    var fallback = getCatalog(DEFAULT_LOCALE);
    if (fallback.strings && hasOwn(fallback.strings, key)) return fallback.strings[key];
    return key;
  }

  function interpolate(value, params) {
    var text = String(value == null ? "" : value);
    if (!params || typeof params !== "object") return text;
    return text.replace(/\{([A-Za-z0-9_]+)\}/g, function (_match, name) {
      return hasOwn(params, name) ? String(params[name]) : "";
    });
  }

  function resolvePlural(value, params) {
    if (!value || typeof value !== "object") return value;
    var count = params && typeof params.count === "number" ? params.count : null;
    if (count === 1 && hasOwn(value, "one")) return value.one;
    if (hasOwn(value, "other")) return value.other;
    if (hasOwn(value, "one")) return value.one;
    return "";
  }

  function t(key, params) {
    return interpolate(resolvePlural(lookupString(currentLocale, key), params), params);
  }

  function setElementAttribute(el, attr, value) {
    if (!el || el.getAttribute(attr) === value) return;
    el.setAttribute(attr, value);
  }

  function getElementRoot(root) {
    if (!root) return null;
    if (root.nodeType === 1) return root;
    if (root.nodeType === 9) return root.documentElement || root.body;
    return null;
  }

  function applyKeyedTranslations(root) {
    root = getElementRoot(root);
    if (!root) return;
    var list = [];
    if (root.hasAttribute && root.hasAttribute("data-i18n")) list.push(root);
    if (root.querySelectorAll) {
      list = list.concat(Array.prototype.slice.call(root.querySelectorAll("[data-i18n]")));
    }
    list.forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key) {
        var nextText = t(key);
        if (el.textContent !== nextText) el.textContent = nextText;
      }
    });

    var attrTargets = [];
    if (
      root.matches &&
      root.matches("[data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-tooltip]")
    ) {
      attrTargets.push(root);
    }
    if (root.querySelectorAll) {
      attrTargets = attrTargets.concat(
        Array.prototype.slice.call(
          root.querySelectorAll("[data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-tooltip]"),
        ),
      );
    }
    attrTargets.forEach(function (el) {
      [
        ["data-i18n-title", "title"],
        ["data-i18n-aria-label", "aria-label"],
        ["data-i18n-placeholder", "placeholder"],
        ["data-i18n-tooltip", "data-tooltip"],
      ].forEach(function (pair) {
        var key = el.getAttribute(pair[0]);
        if (key) setElementAttribute(el, pair[1], t(key));
      });
    });
  }

  function translateDom(root) {
    if (typeof document === "undefined") return;
    var target = root || document.body || document.documentElement;
    if (!target || applying) return;
    applying = true;
    try {
      applyKeyedTranslations(target);
      if (document.documentElement) {
        document.documentElement.lang = getCatalog(currentLocale).lang || currentLocale;
      }
      if (document.title && document.title !== t("app.title")) document.title = t("app.title");
    } finally {
      applying = false;
    }
  }

  function dispatchLocaleChange(previousLocale) {
    if (typeof window === "undefined" || !window.dispatchEvent) return;
    var detail = { locale: currentLocale, previousLocale: previousLocale };
    try {
      window.dispatchEvent(new CustomEvent("soapy:locale-change", { detail: detail }));
    } catch (_e) {
      if (typeof document === "undefined" || !document.createEvent) return;
      var event = document.createEvent("CustomEvent");
      event.initCustomEvent("soapy:locale-change", false, false, detail);
      window.dispatchEvent(event);
    }
  }

  function setLocale(locale) {
    var next = normalizeLocale(locale);
    var previous = currentLocale;
    currentLocale = next;
    writeStoredLocale(next);
    translateDom();
    if (previous !== next) dispatchLocaleChange(previous);
    return currentLocale;
  }

  function onChange(callback) {
    if (typeof window === "undefined" || typeof callback !== "function") {
      return function () { };
    }
    var handler = function (event) {
      callback(event && event.detail ? event.detail : { locale: currentLocale });
    };
    window.addEventListener("soapy:locale-change", handler);
    return function () {
      window.removeEventListener("soapy:locale-change", handler);
    };
  }

  function init() {
    currentLocale = normalizeLocale(currentLocale);
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          translateDom();
        }, { once: true });
      } else {
        translateDom();
      }
    }
  }

  window.SoapyPanels.i18n = {
    t: t,
    setLocale: setLocale,
    getLocale: function () { return currentLocale; },
    getAvailableLocales: getAvailableLocales,
    getCatalog: getCatalog,
    hasStoredLocale: hasStoredLocale,
    translateDom: translateDom,
    onChange: onChange,
  };

  init();
})();
