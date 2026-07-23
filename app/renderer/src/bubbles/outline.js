const bubbleOutlineHelpers = (() => {
  const DEFAULTS = {
    color: '#000000',
    color2: '#000000',
    opacity: 1,
    width: 3,
    style: 'solid',
    dash: 12,
    gap: 8,
    doubleEnabled: false,
    doubleSplit: 50,
    offset: 0,
  };

  function toNumberOrDefault(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max, fallback) {
    const numeric = toNumberOrDefault(value, fallback);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
  }

  function clampOpacity(value, fallback = DEFAULTS.opacity) {
    return clamp(value, 0, 1, fallback);
  }

  function clampOutlineWidth(value, fallback = DEFAULTS.width) {
    return clamp(value, 0, 40, fallback);
  }

  function clampDash(value, fallback = DEFAULTS.dash) {
    return clamp(value, 1, 400, fallback);
  }

  function clampGap(value, fallback = DEFAULTS.gap) {
    return clamp(value, 0, 400, fallback);
  }

  function clampDoubleOutlineSplit(value, fallback = DEFAULTS.doubleSplit) {
    const percent = clamp(value, 1, 99, fallback);
    return Math.round(percent);
  }

  function clampOutlineOffset(value, fallback = DEFAULTS.offset) {
    const offset = clamp(value, -100, 0, fallback);
    return Math.round(offset * 100) / 100;
  }

  function normalizeHexColor(value, fallback = DEFAULTS.color) {
    if (typeof value !== 'string') return fallback;
    const raw = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      return (
        '#' +
        raw[1] +
        raw[1] +
        raw[2] +
        raw[2] +
        raw[3] +
        raw[3]
      ).toLowerCase();
    }
    return fallback;
  }

  function normalizeOutlineStyle(value) {
    return value === 'broken' ? 'broken' : 'solid';
  }

  function normalizeBubbleOutline(bubble) {
    const target = bubble && typeof bubble === 'object' ? bubble : {};
    target.stroke = normalizeHexColor(target.stroke, DEFAULTS.color);
    target.stroke2 = normalizeHexColor(
      target.stroke2,
      target.stroke || DEFAULTS.color,
    );
    target.strokeA = clampOpacity(target.strokeA, DEFAULTS.opacity);
    target.strokeW = clampOutlineWidth(target.strokeW, DEFAULTS.width);
    target.strokeStyle = normalizeOutlineStyle(target.strokeStyle);
    target.strokeDash = clampDash(target.strokeDash, DEFAULTS.dash);
    target.strokeGap = clampGap(target.strokeGap, DEFAULTS.gap);
    target.doubleOutlineEnabled = false;
    target.doubleOutlineSplit = clampDoubleOutlineSplit(
      target.doubleOutlineSplit,
      DEFAULTS.doubleSplit,
    );
    target.strokeOffset = clampOutlineOffset(
      target.strokeOffset,
      DEFAULTS.offset,
    );
    if (!target.strokeGradient || typeof target.strokeGradient !== 'object') {
      target.strokeGradient = null;
    }
    return target;
  }

  function resolveBubbleOutline(bubble) {
    const normalized = normalizeBubbleOutline(
      bubble && typeof bubble === 'object' ? { ...bubble } : {},
    );
    const dashArray =
      normalized.strokeStyle === 'broken'
        ? [normalized.strokeDash, normalized.strokeGap]
        : [];
    const width = clampOutlineWidth(normalized.strokeW, DEFAULTS.width);
    const doubleEnabled = false;
    const split = clampDoubleOutlineSplit(
      normalized.doubleOutlineSplit,
      DEFAULTS.doubleSplit,
    );
    const legacyInnerWidth = doubleEnabled
      ? Math.max(0, width * (split / 100))
      : width;
    const outerWidth = doubleEnabled
      ? width + Math.max(0, width - legacyInnerWidth)
      : width;
    return {
      color: normalized.stroke,
      color2: normalizeHexColor(normalized.stroke2, normalized.stroke),
      opacity: clampOpacity(normalized.strokeA, DEFAULTS.opacity),
      width,
      style: normalized.strokeStyle,
      dash: normalized.strokeDash,
      gap: normalized.strokeGap,
      dashArray,
      gradient: doubleEnabled ? null : normalized.strokeGradient || null,
      doubleEnabled,
      split,
      innerWidth: width,
      outerWidth,
      maxWidth: width,
      offset: clampOutlineOffset(normalized.strokeOffset, DEFAULTS.offset),
      inherited: false,
    };
  }

  return {
    DEFAULTS,
    clampOpacity,
    clampOutlineWidth,
    clampDash,
    clampGap,
    clampDoubleOutlineSplit,
    clampOutlineOffset,
    normalizeHexColor,
    normalizeOutlineStyle,
    normalizeBubbleOutline,
    resolveBubbleOutline,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = bubbleOutlineHelpers;
} else {
  const root = typeof self !== 'undefined' ? self : window;
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.bubbles = root.SoapyPanels.bubbles || {};
  root.SoapyPanels.bubbles.outline = bubbleOutlineHelpers;
}
