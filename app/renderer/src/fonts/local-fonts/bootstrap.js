'use strict';

(function bootstrapLocalFonts() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function getFontFamilyApi() {
    return window.SoapyPanels && window.SoapyPanels.fonts
      ? window.SoapyPanels.fonts.families || null
      : null;
  }

  function resolveRequire() {
    if (typeof require === 'function') return require;
    if (typeof window.require === 'function') return window.require;
    return null;
  }

  function guessFormatFromPath(pathValue) {
    if (typeof pathValue !== 'string') return '';
    const lower = pathValue.toLowerCase();
    if (lower.endsWith('.woff2')) return 'woff2';
    if (lower.endsWith('.woff')) return 'woff';
    if (lower.endsWith('.otf')) return 'opentype';
    if (lower.endsWith('.ttf')) return 'truetype';
    return '';
  }

  function normalizeManifestEntry(entry, index) {
    if (!entry || typeof entry !== 'object') return null;
    const family = typeof entry.family === 'string' ? entry.family.trim() : '';
    if (!family) return null;

    const descriptor =
      typeof entry.descriptor === 'string' ? entry.descriptor.trim() : '';

    const fallback =
      typeof entry.fallback === 'string' && entry.fallback.trim()
        ? entry.fallback.trim()
        : 'sans-serif';

    const rawStyle =
      typeof entry.style === 'string' ? entry.style.toLowerCase().trim() : '';
    const style =
      rawStyle === 'italic' || rawStyle === 'oblique' ? rawStyle : 'normal';
    const weight =
      entry.weight != null && entry.weight !== ''
        ? String(entry.weight)
        : '400';

    let sources = [];
    if (Array.isArray(entry.sources) && entry.sources.length) {
      sources = entry.sources
        .map(function (source) {
          if (!source || typeof source !== 'object') return null;
          const srcPath =
            source.path || source.href || source.url || source.file;
          if (typeof srcPath !== 'string' || !srcPath.trim()) return null;
          const fmt = source.format || guessFormatFromPath(srcPath);
          return {
            href: srcPath,
            format: fmt || undefined,
          };
        })
        .filter(Boolean);
    } else if (
      entry.sources &&
      typeof entry.sources === 'object' &&
      (entry.sources.path ||
        entry.sources.href ||
        entry.sources.url ||
        entry.sources.file)
    ) {
      const srcPath =
        entry.sources.path ||
        entry.sources.href ||
        entry.sources.url ||
        entry.sources.file;
      if (typeof srcPath === 'string' && srcPath.trim()) {
        sources = [
          {
            href: srcPath,
            format:
              entry.sources.format ||
              entry.format ||
              guessFormatFromPath(srcPath),
          },
        ];
      }
    }

    if (!sources.length) {
      const singlePath = entry.path || entry.file || entry.href || entry.url;
      if (typeof singlePath === 'string' && singlePath.trim()) {
        sources = [
          {
            href: singlePath,
            format: entry.format || guessFormatFromPath(singlePath),
          },
        ];
      }
    }
    if (!sources.length) return null;

    const firstSource = sources[0];
    const label =
      typeof entry.label === 'string' && entry.label.trim()
        ? entry.label.trim()
        : descriptor
          ? `${family} (${descriptor})`
          : family;

    let id = '';
    if (entry.id != null && String(entry.id).trim()) {
      id = String(entry.id).trim();
    } else {
      const generated = `manifest-${family}-${weight}-${style}-${index}`;
      id = generated.replace(/\s+/g, '-').toLowerCase();
    }

    const coverageManifest = window.localFontCoverageManifest;
    const coverageRanges =
      coverageManifest &&
      coverageManifest.version === 1 &&
      coverageManifest.byFontId &&
      Array.isArray(coverageManifest.byFontId[id])
        ? coverageManifest.byFontId[id]
        : null;

    return {
      id,
      href: firstSource.href,
      format: firstSource.format,
      sources,
      family,
      fallback,
      label,
      weight,
      style,
      baseFamily: entry.baseFamily || family,
      descriptor,
      coverageRanges,
    };
  }

  function readManifestFonts() {
    const manifest = window.localFontManifest;
    if (!Array.isArray(manifest)) return [];
    return manifest
      .map(function (entry, index) {
        return normalizeManifestEntry(entry, index);
      })
      .filter(Boolean);
  }

  function dedupeFonts(fonts) {
    const seen = new Set();
    const result = [];
    fonts.forEach(function (font) {
      if (!font || !font.family) return;
      const key = [
        font.family,
        font.weight || '',
        font.style || '',
        font.label || '',
      ]
        .join('|')
        .toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(font);
    });
    return result;
  }

  function sortFonts(fonts) {
    return fonts.sort(function (a, b) {
      return a.label.localeCompare(b.label, undefined, {
        sensitivity: 'base',
      });
    });
  }

  function composeFontValue(family, fallback) {
    const needsQuotes = /\s/.test(family);
    const primary = needsQuotes
      ? "'" + family.replace(/'/g, "\\'") + "'"
      : family;
    return fallback ? primary + ', ' + fallback : primary;
  }

  function defaultCreateFontFaceCss(font) {
    const familyNames = [font.family || 'Local Font'];
    if (font.legacyFamily && font.legacyFamily !== familyNames[0]) {
      familyNames.push(font.legacyFamily);
    }
    let sources = [];
    if (Array.isArray(font.sources) && font.sources.length) {
      sources = font.sources;
    } else if (
      font.sources &&
      typeof font.sources === 'object' &&
      (font.sources.href ||
        font.sources.path ||
        font.sources.url ||
        font.sources.file)
    ) {
      const srcPath =
        font.sources.path ||
        font.sources.href ||
        font.sources.url ||
        font.sources.file;
      if (typeof srcPath === 'string' && srcPath.trim()) {
        sources = [
          {
            href: srcPath,
            format: font.sources.format || font.format,
          },
        ];
      }
    } else if (font.href) {
      sources = [{ href: font.href, format: font.format }];
    }
    const src =
      sources
        .filter(function (source) {
          return source && source.href;
        })
        .map(function (source) {
          const fmt = source.format ? ` format("${source.format}")` : '';
          return `url("${source.href}")${fmt}`;
        })
        .join(', ') || 'local("")';

    return familyNames
      .map(function (familyName) {
        const escapedFamily = familyName
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        return (
          `@font-face {` +
          ` font-family: "${escapedFamily}";` +
          ` src: ${src};` +
          ` font-display: swap;` +
          ` font-style: ${font.style || 'normal'};` +
          ` font-weight: ${font.weight || '400'};` +
          ` }`
        );
      })
      .join('\n');
  }

  function preloadFonts(fonts) {
    if (!fonts || !fonts.length) return;
    if (!document.fonts || typeof document.fonts.load !== 'function') return;
    const seen = new Set();
    fonts.forEach(function (font) {
      if (!font || !font.family) return;
      const family = font.family;
      const style = font.style || 'normal';
      const weight = font.weight || '400';
      const key = family + '|' + style + '|' + weight;
      if (seen.has(key)) return;
      seen.add(key);
      const safeFamily = family.replace(/"/g, '\\"');
      const descriptor = style + ' ' + weight + ' 16px "' + safeFamily + '"';
      try {
        document.fonts.load(descriptor);
      } catch {
        /* ignore */
      }
    });
  }

  function schedulePreload(fonts) {
    if (!fonts || !fonts.length) return;
    if (
      typeof window !== 'undefined' &&
      typeof window.requestIdleCallback === 'function'
    ) {
      window.requestIdleCallback(function () {
        preloadFonts(fonts);
      });
    } else {
      setTimeout(function () {
        preloadFonts(fonts);
      }, 0);
    }
  }

  function styleFontOption(option) {
    if (!option) return;
    const value = option.value || option.textContent || '';
    if (value) option.style.fontFamily = value;
    option.style.fontSize = '18px';
    option.style.lineHeight = '1.4';
    if (option.dataset && option.dataset.fontWeight) {
      option.style.fontWeight = option.dataset.fontWeight;
    } else {
      option.style.fontWeight = '';
    }
    if (option.dataset && option.dataset.fontStyle) {
      const fontStyle = option.dataset.fontStyle;
      option.style.fontStyle =
        fontStyle && fontStyle !== 'normal' ? fontStyle : 'normal';
    } else {
      option.style.fontStyle = '';
    }
  }

  function styleSelectOptions(select) {
    if (!select || !select.options) return;
    Array.prototype.forEach.call(select.options, function (option) {
      styleFontOption(option);
    });
  }

  const FAVORITES_KEY = 'sp.fontFavorites';
  let fontFavoriteCache = null;
  let fontPickerOutsideHandler = null;
  let fontPickerPositionHandler = null;
  let fontPickerIgnoreClick = false;
  let fontPickerSearchTerm = '';
  let fontPickerShowAll = false;
  let fontPickerContextId = null;
  let fontPickerVirtualState = null;
  let fontPickerRenderFrame = null;
  let fontCoverageById = new Map();
  let fontCoverageLoadPromise = null;

  const FONT_PICKER_ROW_HEIGHT = 47;
  const FONT_PICKER_OVERSCAN_ROWS = 2;
  let fontPickerOptionDataCache = null;

  function applyLoadedFontCoverage() {
    const manifest = window.localFontCoverageManifest;
    const byFontId =
      manifest && manifest.version === 1 && manifest.byFontId
        ? manifest.byFontId
        : null;
    if (!byFontId) return false;

    if (Array.isArray(window.localFonts)) {
      window.localFonts.forEach(function (font) {
        if (!font || !font.id || !Array.isArray(byFontId[font.id])) return;
        font.coverageRanges = byFontId[font.id];
        fontCoverageById.set(font.id, font.coverageRanges);
      });
    }
    const pickerFonts = Array.isArray(window.localFontPickerFonts)
      ? window.localFontPickerFonts
      : [];
    const facesById = new Map();
    (Array.isArray(window.localFonts) ? window.localFonts : []).forEach(
      function (font) {
        if (font && font.id) facesById.set(font.id, font);
      },
    );
    const familyApi = getFontFamilyApi();
    pickerFonts.forEach(function (font) {
      if (!font || !font.id || !familyApi) return;
      const faceCandidates = (font.coverageFaceIds || [font.id].concat(font.legacyIds || []))
        .map(function (id) {
          return facesById.get(id);
        })
        .filter(Boolean);
      const ranges = familyApi.unionCoverageRanges(faceCandidates);
      if (ranges) {
        font.coverageRanges = ranges;
        fontCoverageById.set(font.id, ranges);
      }
    });
    fontPickerOptionDataCache = null;
    return true;
  }

  function ensureFontCoverageLoaded() {
    if (applyLoadedFontCoverage()) {
      return Promise.resolve(window.localFontCoverageManifest);
    }
    if (fontCoverageLoadPromise) return fontCoverageLoadPromise;
    const loader =
      window.SoapyPanels && window.SoapyPanels.fontCoverage
        ? window.SoapyPanels.fontCoverage
        : null;
    if (!loader || typeof loader.ensureLoaded !== 'function') {
      return Promise.resolve(null);
    }
    fontCoverageLoadPromise = loader
      .ensureLoaded()
      .then(function (manifest) {
        applyLoadedFontCoverage();
        return manifest;
      })
      .catch(function () {
        fontCoverageLoadPromise = null;
        return null;
      });
    return fontCoverageLoadPromise;
  }

  function refreshFontPickerAfterCoverage(select) {
    ensureFontCoverageLoaded().then(function () {
      updateFontPickerToggle(select);
      const elements = getFontPickerElements();
      if (!elements || !elements.panel || elements.panel.hidden) return;
      buildFontPicker(select, {
        keepOpen: true,
        skipClose: true,
        focusSearch: false,
        preserveScroll: true,
      });
    });
  }

  function translateFontPicker(key, params, fallback) {
    const i18n =
      window.SoapyPanels && window.SoapyPanels.i18n
        ? window.SoapyPanels.i18n
        : null;
    if (i18n && typeof i18n.t === 'function') {
      const value = i18n.t(key, params);
      if (value && value !== key) return value;
    }
    return fallback;
  }

  function getRelevantTextCodePoints() {
    const textInput = document.getElementById('propText');
    const compatibility =
      window.SoapyPanels && window.SoapyPanels.fontCompatibility;
    if (
      !compatibility ||
      typeof compatibility.extractRelevantCodePoints !== 'function'
    ) {
      return [];
    }
    return compatibility.extractRelevantCodePoints(
      textInput && typeof textInput.value === 'string' ? textInput.value : '',
    );
  }

  function classifyFontCoverage(coverageRanges, codePoints) {
    const compatibility =
      window.SoapyPanels && window.SoapyPanels.fontCompatibility;
    if (
      !compatibility ||
      typeof compatibility.classifyCoverage !== 'function'
    ) {
      return 'unknown';
    }
    return compatibility.classifyCoverage(coverageRanges, codePoints);
  }

  function loadFavoriteList() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function getFavoriteSet() {
    if (!fontFavoriteCache) {
      fontFavoriteCache = new Set(loadFavoriteList());
    }
    return new Set(fontFavoriteCache);
  }

  function persistFavoriteSet(set) {
    fontFavoriteCache = new Set(set);
    try {
      localStorage.setItem(
        FAVORITES_KEY,
        JSON.stringify(Array.from(fontFavoriteCache)),
      );
    } catch {
      /* ignore */
    }
  }

  function toggleFavorite(id) {
    if (!id) return getFavoriteSet();
    const current = getFavoriteSet();
    if (current.has(id)) current.delete(id);
    else current.add(id);
    persistFavoriteSet(current);
    return current;
  }

  function ensureOptionId(option) {
    if (!option) return null;
    if (option.dataset.fontId) return option.dataset.fontId;
    if (option.dataset.localFont) {
      option.dataset.fontId = option.dataset.localFont;
    } else {
      const labelSlug = (option.textContent || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
      option.dataset.fontId = `builtin:${labelSlug}:${option.value}`;
    }
    return option.dataset.fontId;
  }

  function getFontPickerElements() {
    const container = document.getElementById('fontPicker');
    if (!container) return null;
    const toggle = container.querySelector('.font-picker-toggle');
    const panel = container.querySelector('.font-picker-panel');
    const label = container.querySelector('.font-picker-toggle-label');
    const favorite = container.querySelector('.font-picker-toggle-star');
    const warning = container.querySelector('.font-picker-toggle-warning');
    return { container, toggle, panel, label, favorite, warning };
  }

  function closeFontPicker(container) {
    const elements = getFontPickerElements();
    if (!elements || !elements.panel || !elements.toggle) return;
    if (container && elements.container !== container) return;
    elements.panel.hidden = true;
    elements.toggle.setAttribute('aria-expanded', 'false');
    elements.panel.style.position = '';
    elements.panel.style.left = '';
    elements.panel.style.top = '';
    elements.panel.style.width = '';
    elements.panel.style.maxHeight = '';
    elements.panel.style.zIndex = '';
    detachFontPickerPositioning();
    fontPickerIgnoreClick = false;
    fontPickerShowAll = false;
    if (fontPickerOutsideHandler) {
      document.removeEventListener('mousedown', fontPickerOutsideHandler);
      document.removeEventListener('touchstart', fontPickerOutsideHandler);
      document.removeEventListener('keydown', handleFontPickerKeydown);
      fontPickerOutsideHandler = null;
    }
  }

  function openFontPicker(container) {
    const elements = getFontPickerElements();
    if (!elements || !elements.panel || !elements.toggle || !elements.container)
      return;
    if (container && elements.container !== container) return;
    elements.panel.hidden = false;
    elements.toggle.setAttribute('aria-expanded', 'true');
    attachFontPickerPositioning();
    positionFontPickerPanel();
    requestFontPickerVirtualRender();
    if (!fontPickerOutsideHandler) {
      fontPickerOutsideHandler = function (event) {
        const current = getFontPickerElements();
        if (
          current &&
          current.container &&
          !current.container.contains(event.target)
        ) {
          closeFontPicker(current.container);
        }
      };
      document.addEventListener('mousedown', fontPickerOutsideHandler);
      document.addEventListener('touchstart', fontPickerOutsideHandler);
      document.addEventListener('keydown', handleFontPickerKeydown);
    }
  }

  function attachFontPickerPositioning() {
    if (fontPickerPositionHandler) return;
    fontPickerPositionHandler = function () {
      positionFontPickerPanel();
    };
    window.addEventListener('scroll', fontPickerPositionHandler, true);
    window.addEventListener('resize', fontPickerPositionHandler);
  }

  function detachFontPickerPositioning() {
    if (!fontPickerPositionHandler) return;
    window.removeEventListener('scroll', fontPickerPositionHandler, true);
    window.removeEventListener('resize', fontPickerPositionHandler);
    fontPickerPositionHandler = null;
  }

  function positionFontPickerPanel() {
    const elements = getFontPickerElements();
    if (!elements || !elements.panel || elements.panel.hidden) return;
    const { panel, toggle } = elements;
    if (!toggle) return;
    const rect = toggle.getBoundingClientRect();
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth || 0;
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight || 0;
    const margin = 12;
    const minWidth = Math.max(rect.width, 320);
    const maxWidth = Math.min(520, viewportWidth - margin * 2);
    const width = Math.min(Math.max(minWidth, 360), maxWidth);
    let left = rect.left;
    if (left + width > viewportWidth - margin) {
      left = viewportWidth - width - margin;
    }
    left = Math.max(margin, left);

    const spaceBelow = viewportHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const preferredHeight = Math.min(720, viewportHeight - margin * 2);
    let maxHeight;
    let top;
    if (spaceBelow >= 240 || spaceBelow >= spaceAbove) {
      maxHeight = Math.min(preferredHeight, spaceBelow);
      top = rect.bottom + 6;
      if (maxHeight < 200) {
        maxHeight = Math.min(preferredHeight, spaceAbove);
        top = Math.max(margin, rect.top - maxHeight - 6);
      }
    } else {
      maxHeight = Math.min(preferredHeight, spaceAbove);
      top = Math.max(margin, rect.top - maxHeight - 6);
      if (maxHeight < 200) {
        maxHeight = Math.min(preferredHeight, spaceBelow);
        top = rect.bottom + 6;
      }
    }
    maxHeight = Math.max(240, Math.min(maxHeight, preferredHeight));

    panel.style.position = 'fixed';
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(margin, top)}px`;
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${maxHeight}px`;
    panel.style.zIndex = '1000';
    requestFontPickerVirtualRender();
  }

  function handleFontPickerKeydown(event) {
    if (event.key === 'Escape') {
      const elements = getFontPickerElements();
      if (elements && elements.container) {
        closeFontPicker(elements.container);
        if (elements.toggle) elements.toggle.focus();
      }
    }
  }

  function updateFontPickerToggle(select) {
    const elements = getFontPickerElements();
    if (!elements || !elements.label || !select) return;
    const option = select.options[select.selectedIndex];
    if (!option) return;
    const labelText = option.textContent || '';
    elements.label.textContent = labelText.trim();
    const family = option.value || '';
    elements.label.style.fontFamily = family;
    const weight = option.dataset.fontWeight || '';
    const style = option.dataset.fontStyle || 'normal';
    elements.label.style.fontWeight = weight || '400';
    elements.label.style.fontStyle =
      style && style !== 'normal' ? style : 'normal';
    const optionId = ensureOptionId(option);
    const compatibilityStatus = classifyFontCoverage(
      optionId ? fontCoverageById.get(optionId) : null,
      getRelevantTextCodePoints(),
    );
    const isIncompatible = compatibilityStatus === 'incompatible';
    elements.container.classList.toggle(
      'has-incompatible-font',
      isIncompatible,
    );
    if (elements.warning) elements.warning.hidden = !isIncompatible;
    if (elements.favorite) {
      const favorites = getFavoriteSet();
      const isFavorite = optionId ? favorites.has(optionId) : false;
      elements.favorite.setAttribute(
        'aria-pressed',
        isFavorite ? 'true' : 'false',
      );
      elements.favorite.setAttribute(
        'aria-label',
        isFavorite ? 'Remove from favorites' : 'Add to favorites',
      );
      elements.favorite.dataset.fontId = optionId || '';
    }
  }

  function collectFontPickerOptionData(select, favorites) {
    const optionCount = select.options.length;
    if (
      !fontPickerOptionDataCache ||
      fontPickerOptionDataCache.select !== select ||
      fontPickerOptionDataCache.optionCount !== optionCount
    ) {
      const cachedData = [];
      Array.prototype.forEach.call(select.options, function (option) {
        if (!option || option.disabled) return;
        const id = ensureOptionId(option);
        const label = (option.textContent || '').trim();
        if (!label) return;
        const value = option.value;
        const weight = option.dataset.fontWeight || '';
        const style = option.dataset.fontStyle || 'normal';
        const fontFamily =
          option.style && option.style.fontFamily
            ? option.style.fontFamily
            : value;
        cachedData.push({
          id,
          value,
          label,
          fontFamily,
          fontWeight: weight,
          fontStyle: style,
          coverageRanges: fontCoverageById.get(id) || null,
          optionRef: option,
        });
      });
      fontPickerOptionDataCache = {
        select,
        optionCount,
        optionData: cachedData,
      };
    }

    const optionData = fontPickerOptionDataCache.optionData.map(function (data) {
      return Object.assign({}, data, {
        isFavorite: favorites.has(data.id),
        isSelected: data.optionRef.selected,
      });
    });

    const validIds = new Set(
      optionData.map(function (item) {
        return item.id;
      }),
    );
    const filteredFavorites = new Set();
    favorites.forEach(function (id) {
      if (validIds.has(id)) filteredFavorites.add(id);
    });
    if (filteredFavorites.size !== favorites.size) {
      persistFavoriteSet(filteredFavorites);
    }

    optionData.sort(function (a, b) {
      const favA = filteredFavorites.has(a.id) ? 1 : 0;
      const favB = filteredFavorites.has(b.id) ? 1 : 0;
      if (favA !== favB) return favB - favA;
      const labelA = a.label.toLowerCase();
      const labelB = b.label.toLowerCase();
      if (labelA < labelB) return -1;
      if (labelA > labelB) return 1;
      return 0;
    });

    return { optionData, filteredFavorites };
  }

  function createFontPickerOptionRow(data, state) {
    const row = document.createElement('div');
    row.className = 'font-picker-option';
    row.setAttribute('role', 'option');
    row.dataset.value = data.value;
    row.dataset.fontId = data.id;
    if (data.compatibility === 'incompatible') {
      row.classList.add('is-incompatible');
      row.dataset.compatibility = 'incompatible';
    }
    if (data.isSelected) {
      row.classList.add('is-selected');
      row.setAttribute('aria-selected', 'true');
    } else {
      row.setAttribute('aria-selected', 'false');
    }

    const mainButton = document.createElement('button');
    mainButton.type = 'button';
    mainButton.className = 'font-picker-option-button';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'font-picker-option-label';
    labelSpan.textContent = data.label;
    mainButton.appendChild(labelSpan);
    if (data.compatibility === 'incompatible') {
      const badge = document.createElement('span');
      badge.className = 'font-picker-compatibility-badge';
      badge.textContent = translateFontPicker(
        'docker.incompatibleFont',
        null,
        'Missing characters',
      );
      badge.title = translateFontPicker(
        'docker.incompatibleFontHelp',
        null,
        'This font is missing characters used by the current text.',
      );
      mainButton.appendChild(badge);
    }
    mainButton.style.fontFamily = data.fontFamily;
    if (data.fontWeight) mainButton.style.fontWeight = data.fontWeight;
    mainButton.style.fontStyle =
      data.fontStyle && data.fontStyle !== 'normal' ? data.fontStyle : 'normal';

    mainButton.addEventListener('click', function (event) {
      event.preventDefault();
      Array.prototype.forEach.call(state.select.options, function (option) {
        option.selected = option === data.optionRef;
      });
      fontPickerSearchTerm = '';
      state.select.value = data.value;
      state.select.dispatchEvent(new Event('input', { bubbles: true }));
      state.select.dispatchEvent(new Event('change', { bubbles: true }));
      closeFontPicker(state.container);
    });

    const starButton = document.createElement('button');
    starButton.type = 'button';
    starButton.className = 'font-picker-star';
    starButton.dataset.fontId = data.id;
    starButton.setAttribute(
      'aria-pressed',
      data.isFavorite ? 'true' : 'false',
    );
    starButton.setAttribute(
      'aria-label',
      data.isFavorite ? 'Remove from favorites' : 'Add to favorites',
    );
    starButton.textContent = '★';
    starButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const updated = toggleFavorite(data.id);
      buildFontPicker(state.select, {
        keepOpen: true,
        favorites: updated,
        skipClose: true,
        focusSearch: false,
        preserveScroll: true,
      });
      const rebuiltStar = Array.from(
        state.panel.querySelectorAll('.font-picker-star[data-font-id]'),
      ).find(function (candidate) {
        return candidate.dataset.fontId === data.id;
      });
      if (rebuiltStar) {
        rebuiltStar.setAttribute(
          'aria-pressed',
          updated.has(data.id) ? 'true' : 'false',
        );
      }
    });

    row.appendChild(mainButton);
    row.appendChild(starButton);
    return row;
  }

  function renderFontPickerVirtualRows() {
    const state = fontPickerVirtualState;
    if (!state || !state.panel || !state.list) return;
    const data = state.data || [];
    const rowHeight = state.rowHeight || FONT_PICKER_ROW_HEIGHT;
    const searchHeight = state.searchWrap ? state.searchWrap.offsetHeight : 0;
    const scrollTop = Math.max(0, (state.panel.scrollTop || 0) - searchHeight);
    const viewportHeight = state.panel.clientHeight || 480;
    const start = Math.max(
      0,
      Math.floor(scrollTop / rowHeight) - FONT_PICKER_OVERSCAN_ROWS,
    );
    const end = Math.min(
      data.length,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) +
        FONT_PICKER_OVERSCAN_ROWS,
    );

    if (state.renderedStart === start && state.renderedEnd === end) return;
    state.renderedStart = start;
    state.renderedEnd = end;
    state.list.textContent = '';

    const topSpacer = document.createElement('div');
    topSpacer.className = 'font-picker-virtual-spacer';
    topSpacer.style.height = `${start * rowHeight}px`;
    state.list.appendChild(topSpacer);

    for (let index = start; index < end; index += 1) {
      state.list.appendChild(createFontPickerOptionRow(data[index], state));
    }

    const bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'font-picker-virtual-spacer';
    bottomSpacer.style.height = `${Math.max(0, data.length - end) * rowHeight}px`;
    state.list.appendChild(bottomSpacer);
  }

  function requestFontPickerVirtualRender() {
    if (fontPickerRenderFrame !== null) return;
    const raf =
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame
        : function (callback) {
            return setTimeout(callback, 16);
          };
    fontPickerRenderFrame = raf(function () {
      fontPickerRenderFrame = null;
      renderFontPickerVirtualRows();
    });
  }

  function buildFontPicker(select, opts) {
    const elements = getFontPickerElements();
    if (!elements || !select) return;
    const { container, panel } = elements;
    if (!container || !panel) return;
    const wasOpen = !panel.hidden;
    const skipClose = !!(opts && opts.skipClose);
    const previousScrollTop = panel.scrollTop || 0;
    if (wasOpen && !skipClose) {
      closeFontPicker(container);
    }

    const favorites =
      opts && opts.favorites instanceof Set ? opts.favorites : getFavoriteSet();
    const { optionData } = collectFontPickerOptionData(select, favorites);

    const relevantCodePoints = getRelevantTextCodePoints();
    const compatibilityActive = relevantCodePoints.length > 0;
    const classifiedData = optionData.map(function (data) {
      return Object.assign({}, data, {
        compatibility: compatibilityActive
          ? classifyFontCoverage(data.coverageRanges, relevantCodePoints)
          : 'compatible',
      });
    });
    const hiddenIncompatibleCount = classifiedData.filter(function (data) {
      return data.compatibility === 'incompatible' && !data.isSelected;
    }).length;
    let compatibilityFilteredData;
    if (!compatibilityActive || fontPickerShowAll) {
      compatibilityFilteredData = classifiedData;
    } else {
      const selectedIncompatible = classifiedData.filter(function (data) {
        return data.compatibility === 'incompatible' && data.isSelected;
      });
      const compatibleOrUnknown = classifiedData.filter(function (data) {
        return data.compatibility !== 'incompatible';
      });
      compatibilityFilteredData = selectedIncompatible.concat(
        compatibleOrUnknown,
      );
    }

    if (opts && typeof opts.searchTerm === 'string') {
      fontPickerSearchTerm = opts.searchTerm;
    }
    const searchLower = fontPickerSearchTerm.trim().toLowerCase();
    const filteredData = searchLower
      ? compatibilityFilteredData.filter(function (data) {
          return data.label.toLowerCase().startsWith(searchLower);
        })
      : compatibilityFilteredData.slice();

    panel.innerHTML = '';
    panel.onscroll = null;
    fontPickerVirtualState = null;

    const searchWrap = document.createElement('div');
    searchWrap.className = 'font-picker-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = translateFontPicker(
      'docker.searchFonts',
      null,
      'Search fonts…',
    );
    searchInput.autocomplete = 'off';
    searchInput.value = fontPickerSearchTerm;
    searchInput.setAttribute(
      'aria-label',
      translateFontPicker('docker.searchFonts', null, 'Search fonts'),
    );
    searchWrap.appendChild(searchInput);

    if (compatibilityActive && hiddenIncompatibleCount > 0) {
      const filterLabel = document.createElement('label');
      filterLabel.className = 'font-picker-filter-row';
      const filterInput = document.createElement('input');
      filterInput.type = 'checkbox';
      filterInput.checked = fontPickerShowAll;
      filterInput.setAttribute(
        'aria-label',
        translateFontPicker('docker.showAllFonts', null, 'Show all fonts'),
      );
      const filterText = document.createElement('span');
      filterText.className = 'font-picker-filter-label';
      filterText.textContent = translateFontPicker(
        'docker.showAllFonts',
        null,
        'Show all fonts',
      );
      const filterCount = document.createElement('span');
      filterCount.className = 'font-picker-filter-count';
      filterCount.textContent = String(hiddenIncompatibleCount);
      filterCount.title = translateFontPicker(
        'docker.hiddenIncompatibleFonts',
        { count: hiddenIncompatibleCount },
        `${hiddenIncompatibleCount} incompatible fonts`,
      );
      filterLabel.appendChild(filterInput);
      filterLabel.appendChild(filterText);
      filterLabel.appendChild(filterCount);
      searchWrap.appendChild(filterLabel);
      filterInput.addEventListener('change', function () {
        fontPickerShowAll = filterInput.checked;
        buildFontPicker(select, {
          keepOpen: true,
          skipClose: true,
          focusSearch: false,
          searchTerm: fontPickerSearchTerm,
          preserveScroll: false,
        });
      });
    }
    panel.appendChild(searchWrap);

    const list = document.createElement('div');
    list.className = 'font-picker-list';
    list.classList.add('font-picker-list--virtual');
    list.setAttribute('role', 'listbox');
    panel.appendChild(list);

    if (!filteredData.length) {
      const empty = document.createElement('div');
      empty.className = 'font-picker-empty';
      empty.textContent =
        compatibilityActive && !fontPickerShowAll && !searchLower
          ? translateFontPicker(
              'docker.noCompatibleFonts',
              null,
              'No compatible fonts found',
            )
          : translateFontPicker(
              'docker.noFontsFound',
              null,
              'No fonts found',
            );
      list.appendChild(empty);
    } else {
      fontPickerVirtualState = {
        panel,
        list,
        searchWrap,
        select,
        container,
        data: filteredData,
        rowHeight: FONT_PICKER_ROW_HEIGHT,
        renderedStart: -1,
        renderedEnd: -1,
      };
      panel.onscroll = requestFontPickerVirtualRender;
      if (opts && opts.preserveScroll) panel.scrollTop = previousScrollTop;
      else panel.scrollTop = 0;
      renderFontPickerVirtualRows();
    }

    searchInput.addEventListener('input', function (event) {
      fontPickerSearchTerm = event.target.value || '';
      buildFontPicker(select, {
        keepOpen: true,
        skipClose: true,
        focusSearch: true,
        searchTerm: fontPickerSearchTerm,
      });
    });

    searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        fontPickerSearchTerm = '';
        searchInput.value = '';
        buildFontPicker(select, {
          keepOpen: true,
          skipClose: true,
          focusSearch: true,
          searchTerm: fontPickerSearchTerm,
        });
      }
    });

    updateFontPickerToggle(select);

    const shouldKeepOpen = wasOpen || (opts && opts.keepOpen);
    if (shouldKeepOpen) {
      if (!skipClose) openFontPicker(container);
      else {
        positionFontPickerPanel();
        requestFontPickerVirtualRender();
      }
      if (!opts || opts.focusSearch !== false) {
        setTimeout(function () {
          const inputEl = panel.querySelector('.font-picker-search input');
          if (inputEl) {
            inputEl.focus({ preventScroll: true });
            const len = inputEl.value.length;
            inputEl.setSelectionRange(len, len);
          }
        }, 0);
      }
    } else if (wasOpen && !skipClose) {
      closeFontPicker(container);
    }
    positionFontPickerPanel();
    requestFontPickerVirtualRender();
  }

  function syncFontPickerFromSelect(select, opts) {
    const targetSelect = select || document.getElementById('propFont');
    if (!targetSelect) return;
    if (
      opts &&
      Object.prototype.hasOwnProperty.call(opts, 'contextId')
    ) {
      const nextContextId =
        opts.contextId == null ? null : String(opts.contextId);
      if (
        fontPickerContextId !== null &&
        nextContextId !== fontPickerContextId
      ) {
        fontPickerShowAll = false;
      }
      fontPickerContextId = nextContextId;
    }
    updateFontPickerToggle(targetSelect);
    const elements = getFontPickerElements();
    const panel = elements && elements.panel;
    if (panel && !panel.hidden) {
      buildFontPicker(targetSelect, {
        keepOpen: true,
        skipClose: true,
        focusSearch: false,
        preserveScroll: true,
      });
    }
  }

  function canonicalizeFontValue(fontValue, baseFamily) {
    const familyApi = getFontFamilyApi();
    if (!familyApi) return fontValue;
    const localFonts = Array.isArray(window.localFonts) ? window.localFonts : [];
    let canonicalFamily = baseFamily;
    if (typeof familyApi.resolveCanonicalFamily === 'function') {
      canonicalFamily = familyApi.resolveCanonicalFamily(canonicalFamily, localFonts);
    }
    if (!canonicalFamily && typeof fontValue === 'string') {
      const primary = fontValue.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      canonicalFamily = familyApi.resolveCanonicalFamily(primary, localFonts);
    }
    return canonicalFamily
      ? familyApi.replacePrimaryFamily(fontValue, canonicalFamily)
      : fontValue;
  }

  function initFontPicker(select) {
    const elements = getFontPickerElements();
    if (!elements || !select) return;
    const { container, toggle } = elements;
    if (!container || !toggle) return;
    if (container.dataset.fontPickerInit === '1') return;
    container.dataset.fontPickerInit = '1';
    toggle.addEventListener('click', function (event) {
      if (fontPickerIgnoreClick) {
        fontPickerIgnoreClick = false;
        return;
      }
      event.preventDefault();
      const panel = container.querySelector('.font-picker-panel');
      if (!panel) return;
      if (panel.hidden) {
        refreshFontPickerAfterCoverage(select);
        openFontPicker(container);
        buildFontPicker(select, {
          keepOpen: true,
          skipClose: true,
          focusSearch: false,
        });
      }
      else closeFontPicker(container);
    });
    toggle.addEventListener('pointerdown', function (event) {
      if (
        event.pointerType === 'mouse' &&
        typeof event.button === 'number' &&
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      toggle.focus();
      const panel = container.querySelector('.font-picker-panel');
      if (!panel) return;
      if (panel.hidden) {
        refreshFontPickerAfterCoverage(select);
        openFontPicker(container);
        buildFontPicker(select, {
          keepOpen: true,
          skipClose: true,
          focusSearch: false,
        });
      }
      else closeFontPicker(container);
      fontPickerIgnoreClick = true;
    });
    toggle.addEventListener('keydown', function (event) {
      const panel = container.querySelector('.font-picker-panel');
      if (!panel) return;
      if (event.defaultPrevented) return;
      const isModifier = event.ctrlKey || event.metaKey || event.altKey;
      const key = event.key;
      if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        refreshFontPickerAfterCoverage(select);
        openFontPicker(container);
        buildFontPicker(select, {
          keepOpen: true,
          skipClose: true,
          focusSearch: true,
        });
        return;
      }
      if (key === 'Backspace') {
        event.preventDefault();
        if (fontPickerSearchTerm.length) {
          fontPickerSearchTerm = fontPickerSearchTerm.slice(0, -1);
        }
        openFontPicker(container);
        buildFontPicker(select, {
          keepOpen: true,
          skipClose: true,
          focusSearch: true,
        });
        return;
      }
      if (!isModifier && key.length === 1) {
        if (/^[\w\s]$/i.test(key)) {
          event.preventDefault();
          fontPickerSearchTerm += key;
          openFontPicker(container);
          buildFontPicker(select, {
            keepOpen: true,
            skipClose: true,
            focusSearch: true,
          });
        }
      }
    });
    if (elements.favorite) {
      elements.favorite.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const option = select.options[select.selectedIndex];
        if (!option) return;
        const optionId = ensureOptionId(option);
        if (!optionId) return;
        const updated = toggleFavorite(optionId);
        const panel = container.querySelector('.font-picker-panel');
        const isOpen = panel && !panel.hidden;
        buildFontPicker(select, {
          keepOpen: isOpen,
          skipClose: true,
          favorites: updated,
          focusSearch: false,
        });
      });
    }
    select.addEventListener('change', function () {
      updateFontPickerToggle(select);
      buildFontPicker(select, { focusSearch: false });
    });

    const textInput = document.getElementById('propText');
    if (
      textInput &&
      textInput.dataset.fontCompatibilityInit !== '1'
    ) {
      textInput.dataset.fontCompatibilityInit = '1';
      textInput.addEventListener('input', function () {
        refreshFontPickerAfterCoverage(select);
        updateFontPickerToggle(select);
        const currentPanel = container.querySelector('.font-picker-panel');
        if (!currentPanel || currentPanel.hidden) return;
        buildFontPicker(select, {
          keepOpen: true,
          skipClose: true,
          focusSearch: false,
          preserveScroll: false,
        });
      });
    }

    window.addEventListener('soapy:locale-change', function () {
      updateFontPickerToggle(select);
      const currentPanel = container.querySelector('.font-picker-panel');
      if (!currentPanel || currentPanel.hidden) return;
      buildFontPicker(select, {
        keepOpen: true,
        skipClose: true,
        focusSearch: false,
        preserveScroll: true,
      });
    });
  }

  function insertFontFaces(fonts, createFontFaceCss) {
    if (!fonts.length) return;
    let style = document.getElementById('localFontsStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'localFontsStyle';
      document.head.appendChild(style);
    }
    style.textContent = fonts.map(createFontFaceCss).join('\n');
  }

  function populateFontDropdown(fonts) {
    const select = document.getElementById('propFont');
    if (!select) return;

    let existingGroup = select.querySelector('optgroup[data-local-fonts]');
    if (existingGroup) {
      existingGroup.textContent = '';
    } else {
      existingGroup = document.createElement('optgroup');
      existingGroup.label = 'Local Fonts';
      existingGroup.setAttribute('data-local-fonts', 'true');
      select.appendChild(existingGroup);
    }

    fontCoverageById = new Map();
    const familyApi = getFontFamilyApi();
    const favorites = familyApi
      ? familyApi.migrateFavoriteIds(getFavoriteSet(), fonts)
      : getFavoriteSet();
    persistFavoriteSet(favorites);
    fonts.forEach(function (font) {
      const value = composeFontValue(font.family, font.fallback);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = font.label;
      option.dataset.localFont = font.id;
      if (font.weight) option.dataset.fontWeight = String(font.weight);
      if (font.style) option.dataset.fontStyle = font.style;
      if (font.baseFamily) option.dataset.fontBaseFamily = font.baseFamily;
      if (font.descriptor) option.dataset.fontDescriptor = font.descriptor;
      if (font.groupId) option.dataset.fontGroupId = font.groupId;
      if (Array.isArray(font.weightOptions)) {
        option.dataset.fontWeights = JSON.stringify(font.weightOptions);
      }
      if (font.defaultWeight) option.dataset.fontDefaultWeight = font.defaultWeight;
      if (font.regularWeight) option.dataset.fontRegularWeight = font.regularWeight;
      if (font.nearestBoldWeight) {
        option.dataset.fontNearestBoldWeight = font.nearestBoldWeight;
      }
      if (Array.isArray(font.faceVariants)) {
        option.dataset.fontFaceVariants = JSON.stringify(font.faceVariants);
      }
      if (Array.isArray(font.legacyIds) && font.legacyIds.length) {
        option.dataset.fontLegacyIds = font.legacyIds.join('|');
      }
      if (Array.isArray(font.coverageRanges) && font.coverageRanges.length) {
        fontCoverageById.set(font.id, font.coverageRanges);
      }
      existingGroup.appendChild(option);
    });
    fontPickerOptionDataCache = null;
    styleSelectOptions(select);
    initFontPicker(select);
    buildFontPicker(select);
  }

  let readDirectoryFonts = function () {
    return [];
  };
  let createFontFaceCss = defaultCreateFontFaceCss;

  const req = resolveRequire();
  if (req) {
    try {
      const fs = req('fs');
      const path = req('path');
      const url = req('url');
      let loaderPath = null;
      if (document.currentScript && document.currentScript.src) {
        try {
          const scriptUrl = new URL(
            document.currentScript.src,
            window.location.href,
          );
          const protocol = scriptUrl.protocol;
          if (
            protocol === 'file:' ||
            protocol === 'http:' ||
            protocol === 'https:'
          ) {
            if (typeof url.fileURLToPath === 'function') {
              const scriptPath = url.fileURLToPath(scriptUrl);
              loaderPath = path.join(path.dirname(scriptPath), 'loader.js');
            } else {
              const pathname = decodeURIComponent(scriptUrl.pathname || '');
              loaderPath = path.join(
                path.dirname(path.normalize(pathname)),
                'loader.js',
              );
            }
          }
        } catch (resolutionError) {
          console.warn(
            `[local-fonts] Unable to resolve loader path from script tag: ${resolutionError.message}`,
          );
        }
      }
      if (!loaderPath) {
        const baseDir =
          (typeof __dirname === 'string' && __dirname) ||
          (typeof process !== 'undefined' &&
          process &&
          typeof process.cwd === 'function'
            ? process.cwd()
            : '.');
        const fallbackLoaderPaths = [
          path.join(baseDir, 'app', 'renderer', 'src', 'fonts', 'local-fonts', 'loader.js'),
          path.join(baseDir, 'renderer', 'src', 'fonts', 'local-fonts', 'loader.js'),
          path.join(baseDir, 'src', 'fonts', 'local-fonts', 'loader.js'),
          path.join(baseDir, 'app', 'renderer', 'scripts', 'local-fonts', 'loader.js'),
          path.join(baseDir, 'renderer', 'scripts', 'local-fonts', 'loader.js'),
          path.join(baseDir, 'scripts', 'local-fonts', 'loader.js'),
        ];
        loaderPath =
          fallbackLoaderPaths.find(function (candidate) {
            try {
              return fs.existsSync(candidate);
            } catch {
              return false;
            }
          }) || fallbackLoaderPaths[0];
      }
      const loader = req(loaderPath);
      if (loader && typeof loader.readLocalFontEntries === 'function') {
        readDirectoryFonts = function () {
          try {
            const result = loader.readLocalFontEntries();
            return Array.isArray(result) ? result : [];
          } catch (error) {
            console.warn(
              `[local-fonts] Error reading font directory: ${error.message}`,
            );
            return [];
          }
        };
      }
      if (loader && typeof loader.createFontFaceCss === 'function') {
        createFontFaceCss = loader.createFontFaceCss;
      }
    } catch (error) {
      console.warn(
        `[local-fonts] Unable to load loader module: ${error.message}`,
      );
    }
  } else {
    console.info(
      '[local-fonts] Using manifest fonts (Node integration not available in this environment).',
    );
  }

  let useAsyncUserFonts = false;
  let asyncUserFonts = [];
  let fontHydrationAllowed = false;
  let fontApplyPending = false;

  function normalizeAsyncUserFonts(fonts) {
    return Array.isArray(fonts) ? fonts : [];
  }

  function applyAsyncUserFonts(fonts) {
    asyncUserFonts = normalizeAsyncUserFonts(fonts);
    applyFonts();
  }

  function requestAsyncUserFonts() {
    if (
      !window.electronApi ||
      typeof window.electronApi.getUserFontsAsync !== 'function'
    )
      return;
    window.electronApi
      .getUserFontsAsync()
      .then(function (fonts) {
        applyAsyncUserFonts(fonts);
      })
      .catch(function () {
        asyncUserFonts = [];
      });
  }

  function assembleFonts() {
    const manifestFonts = readManifestFonts();
    const directoryFonts = useAsyncUserFonts
      ? asyncUserFonts
      : readDirectoryFonts();
    return sortFonts(dedupeFonts(manifestFonts.concat(directoryFonts)));
  }

  function applyFonts() {
    if (!fontHydrationAllowed) {
      fontApplyPending = true;
      return;
    }
    try {
      const rawFonts = assembleFonts();
      const familyApi = getFontFamilyApi();
      const faces = familyApi ? familyApi.canonicalizeFaces(rawFonts) : rawFonts;
      const pickerFonts = familyApi
        ? familyApi.buildPickerEntries(faces)
        : faces;
      insertFontFaces(faces, createFontFaceCss);
      populateFontDropdown(pickerFonts);
      schedulePreload(faces);
      window.localFonts = faces;
      window.localFontPickerFonts = pickerFonts;
      applyLoadedFontCoverage();
      fontApplyPending = false;
    } catch (error) {
      console.warn(`[local-fonts] Error while loading fonts: ${error.message}`);
    }
  }

  window.SoapyPanels = window.SoapyPanels || {};
  window.SoapyPanels.fonts = window.SoapyPanels.fonts || {};
  window.SoapyPanels.fonts.syncFontPickerFromSelect = syncFontPickerFromSelect;
  window.SoapyPanels.fonts.canonicalizeFontValue = canonicalizeFontValue;
  window.SoapyPanels.fonts.ensureCoverageLoaded = ensureFontCoverageLoaded;

  if (
    typeof window !== 'undefined' &&
    window.electronApi &&
    typeof window.electronApi.getUserFontsAsync === 'function'
  ) {
    useAsyncUserFonts = true;
    requestAsyncUserFonts();
    if (typeof window.electronApi.onUserFontsChanged === 'function') {
      window.electronApi.onUserFontsChanged(function (fonts) {
        applyAsyncUserFonts(fonts);
      });
    }
  } else if (
    typeof window !== 'undefined' &&
    window.electronApi &&
    typeof window.electronApi.getUserFonts === 'function'
  ) {
    readDirectoryFonts = function () {
      try {
        const fonts = window.electronApi.getUserFonts();
        return Array.isArray(fonts) ? fonts : [];
      } catch {
        return [];
      }
    };
    if (typeof window.electronApi.onUserFontsChanged === 'function') {
      window.electronApi.onUserFontsChanged(function () {
        applyFonts();
      });
    }
  }

  function scheduleInitialFontHydration() {
    function hydrateDuringIdle() {
      const hydrate = function () {
        fontHydrationAllowed = true;
        if (fontApplyPending || !Array.isArray(window.localFonts)) applyFonts();
      };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(hydrate, { timeout: 750 });
      } else {
        setTimeout(hydrate, 0);
      }
    }

    const startup = window.SoapyPanels && window.SoapyPanels.startup;
    if (startup && startup.whenInteractive) {
      startup.whenInteractive.then(hydrateDuringIdle);
    } else {
      hydrateDuringIdle();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInitialFontHydration, {
      once: true,
    });
  } else {
    scheduleInitialFontHydration();
  }
})();
