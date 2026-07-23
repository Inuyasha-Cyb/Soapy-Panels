const tailBubbleOutlineHelpers =
  typeof require !== 'undefined'
    ? (() => {
        try {
          return require('../bubbles/outline');
        } catch (_err) {
          return null;
        }
      })()
    : typeof self !== 'undefined' &&
        self.SoapyPanels &&
        self.SoapyPanels.bubbles &&
        self.SoapyPanels.bubbles.outline
      ? self.SoapyPanels.bubbles.outline
      : typeof window !== 'undefined' &&
          window.SoapyPanels &&
          window.SoapyPanels.bubbles &&
          window.SoapyPanels.bubbles.outline
        ? window.SoapyPanels.bubbles.outline
        : null;

const tailOutlineHelpers = (() => {
  const DEFAULTS = {
    enabled: false,
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
    roundness: 0,
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

  function clampRoundness(value, fallback = DEFAULTS.roundness) {
    return clamp(value, 0, 1, fallback);
  }

  function clampDoubleOutlineSplit(
    value,
    fallback = DEFAULTS.doubleSplit,
  ) {
    if (
      tailBubbleOutlineHelpers &&
      typeof tailBubbleOutlineHelpers.clampDoubleOutlineSplit === 'function'
    ) {
      return tailBubbleOutlineHelpers.clampDoubleOutlineSplit(value, fallback);
    }
    return Math.round(clamp(value, 1, 99, fallback));
  }

  function clampOutlineOffset(value, fallback = DEFAULTS.offset) {
    if (
      tailBubbleOutlineHelpers &&
      typeof tailBubbleOutlineHelpers.clampOutlineOffset === 'function'
    ) {
      return tailBubbleOutlineHelpers.clampOutlineOffset(value, fallback);
    }
    return Math.round(clamp(value, -100, 100, fallback) * 100) / 100;
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

  function supportsRoundness(style) {
    const normalized = style || 'regular';
    return normalized === 'regular' || normalized === 'wavy';
  }

  function normalizeTailOutline(tail, options = {}) {
    const target = tail && typeof tail === 'object' ? tail : {};
    const hasExplicitRoundedState = typeof target.rounded === 'boolean';
    const roundedFallback = target.rounded === true ? 1 : DEFAULTS.roundness;
    const style = options.style || target.style || 'regular';

    target.outlineEnabled = target.outlineEnabled === true;
    target.outlineColor = normalizeHexColor(target.outlineColor, DEFAULTS.color);
    target.outline2 = normalizeHexColor(
      target.outline2,
      target.outlineColor || DEFAULTS.color2,
    );
    target.outlineOpacity = clampOpacity(target.outlineOpacity, DEFAULTS.opacity);
    target.outlineWidth = clampOutlineWidth(target.outlineWidth, DEFAULTS.width);
    target.outlineStyle = normalizeOutlineStyle(target.outlineStyle);
    target.outlineDash = clampDash(target.outlineDash, DEFAULTS.dash);
    target.outlineGap = clampGap(target.outlineGap, DEFAULTS.gap);
    target.outlineDoubleEnabled = false;
    target.outlineDoubleSplit = clampDoubleOutlineSplit(
      target.outlineDoubleSplit,
      DEFAULTS.doubleSplit,
    );
    target.outlineOffset = clampOutlineOffset(
      target.outlineOffset,
      DEFAULTS.offset,
    );
    if (
      !target.outlineGradient ||
      typeof target.outlineGradient !== 'object'
    ) {
      target.outlineGradient = null;
    }
    target.roundness = supportsRoundness(style)
      ? clampRoundness(target.roundness, roundedFallback)
      : 0;
    target.rounded = supportsRoundness(style)
      ? target.rounded === true ||
        (!hasExplicitRoundedState && target.roundness > 0)
      : false;

    return target;
  }

  function getBubbleOutline(bubble) {
    if (
      tailBubbleOutlineHelpers &&
      typeof tailBubbleOutlineHelpers.resolveBubbleOutline === 'function'
    ) {
      const resolved = tailBubbleOutlineHelpers.resolveBubbleOutline(bubble || {});
      return {
        ...resolved,
        inherited: true,
      };
    }
    const source = bubble && typeof bubble === 'object' ? bubble : {};
    const style = normalizeOutlineStyle(source.strokeStyle);
    const dash = clampDash(source.strokeDash, DEFAULTS.dash);
    const gap = clampGap(source.strokeGap, DEFAULTS.gap);
    const width = toNumberOrDefault(source.strokeW, 0);
    const normalizedWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
    const split = clampDoubleOutlineSplit(
      source.doubleOutlineSplit,
      DEFAULTS.doubleSplit,
    );
    const doubleEnabled = false;
    const legacyInnerWidth =
      doubleEnabled && normalizedWidth > 0
        ? Math.max(0, normalizedWidth * (split / 100))
        : normalizedWidth;
    const outerWidth =
      doubleEnabled && normalizedWidth > 0
        ? normalizedWidth + Math.max(0, normalizedWidth - legacyInnerWidth)
        : normalizedWidth;
    return {
      color: normalizeHexColor(source.stroke, DEFAULTS.color),
      opacity: clampOpacity(source.strokeA, DEFAULTS.opacity),
      width: normalizedWidth,
      style,
      dash,
      gap,
      dashArray: style === 'broken' ? [dash, gap] : [],
      inherited: true,
      gradient: source.strokeGradient || null,
      color2: normalizeHexColor(source.stroke2, source.stroke || DEFAULTS.color2),
      doubleEnabled,
      split,
      innerWidth: normalizedWidth,
      outerWidth,
      maxWidth: normalizedWidth,
      offset: clampOutlineOffset(source.strokeOffset, DEFAULTS.offset),
    };
  }

  function resolveTailOutline(tail, bubble, options = {}) {
    const style = options.style || (tail && tail.style) || 'regular';
    const normalizedTail = normalizeTailOutline(tail || {}, { style });
    const inherited = getBubbleOutline(bubble);

    if (!normalizedTail.outlineEnabled) return inherited;

    const outlineStyle = normalizeOutlineStyle(normalizedTail.outlineStyle);
    const dash = clampDash(normalizedTail.outlineDash, DEFAULTS.dash);
    const gap = clampGap(normalizedTail.outlineGap, DEFAULTS.gap);
    const tailWidth = clampOutlineWidth(normalizedTail.outlineWidth, DEFAULTS.width);
    const tailSplit = clampDoubleOutlineSplit(
      normalizedTail.outlineDoubleSplit,
      DEFAULTS.doubleSplit,
    );
    const tailDoubleEnabled = false;
    const legacyInnerWidth = tailDoubleEnabled
      ? Math.max(0, tailWidth * (tailSplit / 100))
      : tailWidth;
    const outerWidth = tailDoubleEnabled
      ? tailWidth + Math.max(0, tailWidth - legacyInnerWidth)
      : tailWidth;
    return {
      color: normalizeHexColor(normalizedTail.outlineColor, DEFAULTS.color),
      color2: normalizeHexColor(
        normalizedTail.outline2,
        normalizedTail.outlineColor || DEFAULTS.color,
      ),
      opacity: clampOpacity(normalizedTail.outlineOpacity, DEFAULTS.opacity),
      width: tailWidth,
      style: outlineStyle,
      dash,
      gap,
      dashArray: outlineStyle === 'broken' ? [dash, gap] : [],
      inherited: false,
      gradient: normalizedTail.outlineGradient || null,
      doubleEnabled: tailDoubleEnabled,
      split: tailSplit,
      innerWidth: tailWidth,
      outerWidth,
      maxWidth: tailWidth,
      offset: clampOutlineOffset(normalizedTail.outlineOffset, DEFAULTS.offset),
    };
  }

  function snapshotTailOutlineFromBubble(tail, bubble) {
    const target = normalizeTailOutline(tail || {}, {
      style: tail && tail.style ? tail.style : 'regular',
    });
    const inherited = getBubbleOutline(bubble);
    const inheritedColor = normalizeHexColor(inherited.color, DEFAULTS.color);
    const distinctTailColor =
      inheritedColor === DEFAULTS.color ? '#ffffff' : DEFAULTS.color;
    target.outlineColor = distinctTailColor;
    target.outline2 = distinctTailColor;
    target.outlineOpacity = clampOpacity(
      inherited.opacity,
      DEFAULTS.opacity,
    );
    target.outlineWidth = clampOutlineWidth(inherited.width, DEFAULTS.width);
    target.outlineStyle = normalizeOutlineStyle(inherited.style);
    target.outlineDash = clampDash(inherited.dash, DEFAULTS.dash);
    target.outlineGap = clampGap(inherited.gap, DEFAULTS.gap);
    target.outlineGradient = null;
    target.outlineDoubleEnabled = false;
    target.outlineDoubleSplit = clampDoubleOutlineSplit(
      inherited.split,
      DEFAULTS.doubleSplit,
    );
    target.outlineOffset = clampOutlineOffset(
      inherited.offset,
      DEFAULTS.offset,
    );
    return target;
  }

  return {
    DEFAULTS,
    clampOpacity,
    clampOutlineWidth,
    clampDash,
    clampGap,
    clampDoubleOutlineSplit,
    clampOutlineOffset,
    clampRoundness,
    normalizeHexColor,
    normalizeOutlineStyle,
    supportsRoundness,
    normalizeTailOutline,
    resolveTailOutline,
    snapshotTailOutlineFromBubble,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = tailOutlineHelpers;
} else {
  const root = typeof self !== 'undefined' ? self : window;
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.tails = root.SoapyPanels.tails || {};
  root.SoapyPanels.tails.outline = tailOutlineHelpers;
}
