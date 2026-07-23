"use strict";

const MAX_UNICODE_CODE_POINT = 0x10ffff;

function compressCodePoints(values) {
  if (!values || typeof values[Symbol.iterator] !== "function") return [];

  const sorted = Array.from(
    new Set(
      Array.from(values).filter(
        (value) =>
          Number.isInteger(value) &&
          value >= 0 &&
          value <= MAX_UNICODE_CODE_POINT,
      ),
    ),
  ).sort((a, b) => a - b);

  const ranges = [];
  let start = null;
  let end = null;

  for (const codePoint of sorted) {
    if (start === null) {
      start = codePoint;
      end = codePoint;
      continue;
    }
    if (codePoint === end + 1) {
      end = codePoint;
      continue;
    }
    ranges.push([start, end]);
    start = codePoint;
    end = codePoint;
  }

  if (start !== null) ranges.push([start, end]);
  return ranges;
}

function getFontCoverageRanges(font) {
  if (!font || !font.characterSet) return null;
  const ranges = compressCodePoints(font.characterSet);
  return ranges.length ? ranges : null;
}

function isValidCoverageRanges(ranges) {
  if (!Array.isArray(ranges) || !ranges.length) return false;
  let previousEnd = -1;
  for (const range of ranges) {
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Number.isInteger(range[0]) ||
      !Number.isInteger(range[1]) ||
      range[0] < 0 ||
      range[1] < range[0] ||
      range[1] > MAX_UNICODE_CODE_POINT ||
      range[0] <= previousEnd
    ) {
      return false;
    }
    previousEnd = range[1];
  }
  return true;
}

module.exports = {
  MAX_UNICODE_CODE_POINT,
  compressCodePoints,
  getFontCoverageRanges,
  isValidCoverageRanges,
};
