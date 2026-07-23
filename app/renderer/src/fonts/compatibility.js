'use strict';

(function initFontCompatibility(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.fontCompatibility = api;
})(typeof window !== 'undefined' ? window : null, function createFontCompatibility() {
  const LETTER_OR_MARK = /[\p{L}\p{M}]/u;

  function isVariationSelector(codePoint) {
    return (
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
      (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
    );
  }

  function normalizeText(value) {
    const text = String(value == null ? '' : value);
    try {
      return text.normalize('NFC');
    } catch {
      return text;
    }
  }

  function extractRelevantCodePoints(value) {
    const codePoints = new Set();
    for (const character of normalizeText(value)) {
      const codePoint = character.codePointAt(0);
      if (isVariationSelector(codePoint)) continue;
      if (LETTER_OR_MARK.test(character)) codePoints.add(codePoint);
    }
    return Array.from(codePoints).sort(function (a, b) {
      return a - b;
    });
  }

  function coverageContainsCodePoint(ranges, codePoint) {
    if (!Array.isArray(ranges)) return false;
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const range = ranges[middle];
      if (!Array.isArray(range) || range.length < 2) return false;
      if (codePoint < range[0]) high = middle - 1;
      else if (codePoint > range[1]) low = middle + 1;
      else return true;
    }
    return false;
  }

  function classifyCoverage(ranges, codePoints) {
    const required = Array.isArray(codePoints) ? codePoints : [];
    if (!required.length) return 'compatible';
    if (!Array.isArray(ranges) || !ranges.length) return 'unknown';
    for (const codePoint of required) {
      if (!coverageContainsCodePoint(ranges, codePoint)) return 'incompatible';
    }
    return 'compatible';
  }

  function supportsText(ranges, value) {
    const status = classifyCoverage(ranges, extractRelevantCodePoints(value));
    return status === 'unknown' ? null : status === 'compatible';
  }

  return {
    classifyCoverage,
    coverageContainsCodePoint,
    extractRelevantCodePoints,
    isVariationSelector,
    normalizeText,
    supportsText,
  };
});
