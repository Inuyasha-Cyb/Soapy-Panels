/* eslint-disable no-var */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.text = root.SoapyPanels.text || {};
  root.SoapyPanels.text.wrapping = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var WRAP_LINES_CACHE_MAX = 300;
  var wrapLinesCache = new Map();
  var WORD_WRAP_SCRIPT_REGEX =
    /[\u3400-\u9fff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u0e00-\u0e7f\u0e80-\u0eff\u1780-\u17ff\u1000-\u109f]/;
  var EAST_ASIAN_TYPOGRAPHY_REGEX =
    /[\u3400-\u9fff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u3001\u3002\u300c\u300d\u300e\u300f\u3010\u3011\u3014\u3015\u3016\u3017\u3018\u3019\u301d\u301f\uff08\uff09\uff3b\uff3d\uff5b\uff5d]/;
  var KINSOKU_LINE_START_PROHIBITED =
    '、。，．・：；？！)]）］｝〕〉》」』】〙〗〟’”｠»ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶー〜ゝゞヽヾ々';
  var KINSOKU_LINE_END_PROHIBITED = '([{（［｛〔〈《「『【〘〖〝‘“｟«';
  var wrapIntlSegmenterCache = { word: null, grapheme: null };

  function measureTextWidthWithSpacing(c, text, letterSpacing) {
    if (!text) return 0;

    var str = String(text);

    var total = 0;

    for (var i = 0; i < str.length; ) {
      var code = str.charCodeAt(i);

      var glyph = str[i];

      var consumed = 1;

      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var nextCode = str.charCodeAt(i + 1);

        if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
          glyph += str[i + 1];

          consumed = 2;
        }
      }

      total += c.measureText(glyph).width || 0;

      if (i + consumed < str.length) {
        total += letterSpacing;
      }

      i += consumed;
    }

    return total;
  }

  function splitSurrogateGlyphs(text) {
    var str = typeof text === 'string' ? text : '';
    var glyphs = [];

    for (var i = 0; i < str.length; ) {
      var code = str.charCodeAt(i);
      var glyph = str[i];
      var consumed = 1;

      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var nextCode = str.charCodeAt(i + 1);

        if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
          glyph += str[i + 1];
          consumed = 2;
        }
      }

      glyphs.push(glyph);
      i += consumed;
    }

    return glyphs;
  }

  function getWrapSegmenter(granularity) {
    if (
      !granularity ||
      !Object.prototype.hasOwnProperty.call(wrapIntlSegmenterCache, granularity)
    )
      return null;

    var cached = wrapIntlSegmenterCache[granularity];
    if (cached !== null) return cached;

    if (
      typeof Intl === 'undefined' ||
      !Intl ||
      typeof Intl.Segmenter !== 'function'
    ) {
      wrapIntlSegmenterCache[granularity] = false;
      return null;
    }

    try {
      cached = new Intl.Segmenter(undefined, { granularity: granularity });
      wrapIntlSegmenterCache[granularity] = cached;
      return cached;
    } catch {
      wrapIntlSegmenterCache[granularity] = false;
      return null;
    }
  }

  function segmentTextForWrap(text, granularity, omitWhitespace) {
    var str = typeof text === 'string' ? text : '';
    if (!str) return [];

    var segmenter = getWrapSegmenter(granularity);
    if (!segmenter) return null;

    var iterator = segmenter.segment(str);
    if (!iterator) return null;

    var segments = [];

    for (var entry of iterator) {
      var segment =
        entry && typeof entry.segment === 'string' ? entry.segment : '';

      if (!segment) continue;
      if (omitWhitespace && !/\S/.test(segment)) continue;

      segments.push(segment);
    }

    return segments;
  }

  function getGraphemeSegments(text) {
    var str = typeof text === 'string' ? text : '';
    if (!str) return [];

    var segments = segmentTextForWrap(str, 'grapheme', false);
    if (segments && segments.length) return segments;

    return splitSurrogateGlyphs(str);
  }

  function shouldPreferUnicodeWrapping(paragraph) {
    if (typeof paragraph !== 'string' || !paragraph) return false;
    if (/\s/.test(paragraph)) return false;

    return WORD_WRAP_SCRIPT_REGEX.test(paragraph);
  }

  function shouldApplyEastAsianLineBreakRules(paragraph) {
    return (
      typeof paragraph === 'string' &&
      paragraph.length > 0 &&
      EAST_ASIAN_TYPOGRAPHY_REGEX.test(paragraph)
    );
  }

  function isKinsokuLineStartProhibited(glyph) {
    return !!(
      glyph &&
      typeof glyph === 'string' &&
      KINSOKU_LINE_START_PROHIBITED.indexOf(glyph) !== -1
    );
  }

  function isKinsokuLineEndProhibited(glyph) {
    return !!(
      glyph &&
      typeof glyph === 'string' &&
      KINSOKU_LINE_END_PROHIBITED.indexOf(glyph) !== -1
    );
  }

  function getFirstGrapheme(text) {
    var glyphs = getGraphemeSegments(text);
    return glyphs.length ? glyphs[0] : '';
  }

  function getLastGrapheme(text) {
    var glyphs = getGraphemeSegments(text);
    return glyphs.length ? glyphs[glyphs.length - 1] : '';
  }

  function removeFirstGrapheme(text) {
    var glyph = getFirstGrapheme(text);
    return glyph ? text.slice(glyph.length) : text;
  }

  function removeLastGrapheme(text) {
    var glyph = getLastGrapheme(text);
    return glyph ? text.slice(0, text.length - glyph.length) : text;
  }

  function rebalanceWrappedLineOverflow(
    lines,
    startIndex,
    getLineLimit,
    c,
    letterSpacing,
  ) {
    if (!lines || !lines.length) return;

    for (var i = Math.max(0, startIndex || 0); i < lines.length; i++) {
      while (
        lines[i] &&
        measureTextWidthWithSpacing(c, lines[i], letterSpacing) >
          getLineLimit(i)
      ) {
        var glyphs = getGraphemeSegments(lines[i]);
        if (glyphs.length <= 1) break;

        var moved = glyphs[glyphs.length - 1];
        lines[i] = glyphs.slice(0, glyphs.length - 1).join('');

        if (lines[i + 1] == null) lines[i + 1] = '';
        lines[i + 1] = moved + lines[i + 1];
      }
    }
  }

  function applyEastAsianLineBreakRules(
    paragraph,
    paragraphLines,
    c,
    maxFirstLine,
    maxW,
    letterSpacing,
  ) {
    if (
      !shouldApplyEastAsianLineBreakRules(paragraph) ||
      !paragraphLines ||
      paragraphLines.length <= 1
    ) {
      return paragraphLines;
    }

    function getLineLimit(index) {
      return index === 0 ? maxFirstLine : maxW;
    }

    rebalanceWrappedLineOverflow(
      paragraphLines,
      0,
      getLineLimit,
      c,
      letterSpacing,
    );

    for (var i = 0; i < paragraphLines.length - 1; i++) {
      while (paragraphLines[i]) {
        var trailingGlyph = getLastGrapheme(paragraphLines[i]);
        if (!isKinsokuLineEndProhibited(trailingGlyph)) break;

        var glyphCount = getGraphemeSegments(paragraphLines[i]).length;
        if (glyphCount <= 1) break;

        paragraphLines[i] = removeLastGrapheme(paragraphLines[i]);
        paragraphLines[i + 1] = trailingGlyph + (paragraphLines[i + 1] || '');

        rebalanceWrappedLineOverflow(
          paragraphLines,
          i + 1,
          getLineLimit,
          c,
          letterSpacing,
        );
      }
    }

    for (var li = 1; li < paragraphLines.length; li++) {
      while (paragraphLines[li]) {
        var leadingGlyph = getFirstGrapheme(paragraphLines[li]);
        if (!isKinsokuLineStartProhibited(leadingGlyph)) break;

        var prev = paragraphLines[li - 1] || '';
        var merged = prev + leadingGlyph;
        if (
          measureTextWidthWithSpacing(c, merged, letterSpacing) >
          getLineLimit(li - 1)
        ) {
          break;
        }

        paragraphLines[li - 1] = merged;
        paragraphLines[li] = removeFirstGrapheme(paragraphLines[li]);

        if (!paragraphLines[li]) {
          paragraphLines.splice(li, 1);
          li -= 1;
          break;
        }
      }
    }

    return paragraphLines.filter(function (line) {
      return line != null && line.length > 0;
    });
  }

  function getWrapUnits(paragraph) {
    if (typeof paragraph !== 'string' || !paragraph) return [];
    if (/\s/.test(paragraph)) return null;

    var wordSegments = segmentTextForWrap(paragraph, 'word', true);
    if (wordSegments && wordSegments.length > 1) {
      return wordSegments;
    }

    if (shouldPreferUnicodeWrapping(paragraph)) {
      var graphemes = getGraphemeSegments(paragraph);
      if (graphemes.length > 1) return graphemes;
    }

    if (wordSegments && wordSegments.length) return wordSegments;

    return null;
  }

  function wrapLines(c, t, maxW, letterSpacing, firstLineIndent) {
    var text = typeof t === 'string' ? t : '';
    if (!text) return [];

    var fontKey = c && typeof c.font === 'string' ? c.font : '';
    var spacingKey = isFinite(letterSpacing) ? letterSpacing : 0;
    var widthKey = isFinite(maxW) ? maxW : 0;
    var indentKey = isFinite(firstLineIndent) ? firstLineIndent : 0;
    var cacheKey =
      fontKey +
      '|' +
      widthKey +
      '|' +
      spacingKey +
      '|' +
      indentKey +
      '|' +
      text;
    if (wrapLinesCache.has(cacheKey)) {
      var cachedLines = wrapLinesCache.get(cacheKey);
      if (cachedLines) return cachedLines;
    }

    var indent = Math.max(
      0,
      typeof firstLineIndent === 'number' ? firstLineIndent : 0,
    );
    var maxFirstLine = Math.max(1, maxW - indent);

    var paragraphs = text.split(/\r\n|\r|\n/);
    var lines = [];

    function currentLimit(isFirstLineOfParagraph) {
      return isFirstLineOfParagraph ? maxFirstLine : maxW;
    }

    function pushParagraph(paragraph) {
      if (paragraph.length === 0) {
        lines.push('');
        return;
      }

      var paragraphLines = [];

      var wrapUnits = getWrapUnits(paragraph);
      if (wrapUnits && wrapUnits.length) {
        var current = '';
        var isFirstUnitLine = true;

        for (var ui = 0; ui < wrapUnits.length; ui++) {
          var unit = wrapUnits[ui];
          if (!unit) continue;

          var testUnit = current ? current + unit : unit;
          var unitLimit = currentLimit(isFirstUnitLine);

          if (
            measureTextWidthWithSpacing(c, testUnit, letterSpacing) <=
              unitLimit ||
            !current
          ) {
            current = testUnit;
          } else {
            paragraphLines.push(current);
            current = unit;
            isFirstUnitLine = false;
          }
        }

        if (current) paragraphLines.push(current);
        paragraphLines = applyEastAsianLineBreakRules(
          paragraph,
          paragraphLines,
          c,
          maxFirstLine,
          maxW,
          letterSpacing,
        );
        for (var pli = 0; pli < paragraphLines.length; pli++) {
          lines.push(paragraphLines[pli]);
        }
        return;
      }

      var words = paragraph.split(' ');
      var cur = '';
      var isFirstLine = true;

      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var test = cur ? cur + ' ' + w : w;
        var limit = currentLimit(isFirstLine);

        if (
          measureTextWidthWithSpacing(c, test, letterSpacing) <= limit ||
          !cur
        ) {
          cur = test;
        } else {
          paragraphLines.push(cur);
          cur = w;
          isFirstLine = false;
        }
      }

      if (cur) paragraphLines.push(cur);
      paragraphLines = applyEastAsianLineBreakRules(
        paragraph,
        paragraphLines,
        c,
        maxFirstLine,
        maxW,
        letterSpacing,
      );
      for (var wi = 0; wi < paragraphLines.length; wi++) {
        lines.push(paragraphLines[wi]);
      }
    }

    for (var pi = 0; pi < paragraphs.length; pi++) {
      pushParagraph(paragraphs[pi]);
    }

    wrapLinesCache.set(cacheKey, lines);
    if (wrapLinesCache.size > WRAP_LINES_CACHE_MAX) {
      var oldestKey = wrapLinesCache.keys().next().value;
      if (oldestKey != null) wrapLinesCache.delete(oldestKey);
    }

    return lines;
  }

  function splitVerticalText(t) {
    var text = typeof t === 'string' ? t : '';
    if (!text) return [''];

    var lines = [];
    var parts = text.split(/(\r\n|\r|\n)/);

    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi];
      if (!part) continue;

      if (/^(?:\r\n|\r|\n)$/.test(part)) {
        lines.push('');
        continue;
      }

      var glyphs = getGraphemeSegments(part);
      for (var gi = 0; gi < glyphs.length; gi++) {
        lines.push(glyphs[gi]);
      }
    }

    if (!lines.length) lines.push('');
    return lines;
  }

  return {
    wrapLines: wrapLines,
    splitVerticalText: splitVerticalText,
    getGraphemeSegments: getGraphemeSegments,
    measureTextWidthWithSpacing: measureTextWidthWithSpacing,
  };
});
