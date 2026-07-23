(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.images = root.SoapyPanels.images || {};
  root.SoapyPanels.images.effects = api;
})(
  typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : globalThis,
  function () {
    "use strict";

    var EFFECT_TYPES = [
      "grayscale",
      "threshold",
      "posterize",
      "duotone",
      "gradientMap",
    ];

    var SRGB_TO_LINEAR = new Float64Array(256);
    for (var lutIndex = 0; lutIndex < 256; lutIndex++) {
      SRGB_TO_LINEAR[lutIndex] = srgbUnitToLinear(lutIndex / 255);
    }

    var BAYER_4X4 = [
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5,
    ];

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function finiteOr(value, fallback) {
      if (
        value === null ||
        value === undefined ||
        typeof value === "boolean" ||
        (typeof value === "string" && !value.trim())
      ) {
        return fallback;
      }
      var numeric = Number(value);
      return isFinite(numeric) ? numeric : fallback;
    }

    function normalizeHexColor(value, fallback) {
      var fallbackValue = typeof fallback === "string" ? fallback.toLowerCase() : "#000000";
      if (typeof value !== "string") return fallbackValue;
      var raw = value.trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
      if (/^#[0-9a-f]{3}$/.test(raw)) {
        return (
          "#" +
          raw.charAt(1) + raw.charAt(1) +
          raw.charAt(2) + raw.charAt(2) +
          raw.charAt(3) + raw.charAt(3)
        );
      }
      return fallbackValue;
    }

    function defaultsForType(type) {
      if (type === "grayscale") {
        return { type: type, amount: 1, params: {} };
      }
      if (type === "threshold") {
        return {
          type: type,
          amount: 1,
          params: { auto: true, level: 0.5, softness: 0 },
        };
      }
      if (type === "posterize") {
        return {
          type: type,
          amount: 1,
          params: { levels: 6, dither: 0 },
        };
      }
      if (type === "duotone") {
        return {
          type: type,
          amount: 1,
          params: {
            shadow: "#000000",
            highlight: "#ff2d55",
            balance: 0.5,
          },
        };
      }
      if (type === "gradientMap") {
        return {
          type: type,
          amount: 1,
          params: {
            shadow: "#000000",
            midtone: "#ff2d55",
            highlight: "#ffffff",
            midpoint: 0.5,
          },
        };
      }
      return null;
    }

    function normalizeEffect(value) {
      if (!value || typeof value !== "object") return null;
      var type = EFFECT_TYPES.indexOf(value.type) !== -1 ? value.type : null;
      if (!type) return null;
      var normalized = defaultsForType(type);
      normalized.amount = clamp(finiteOr(value.amount, 1), 0, 1);
      var params = value.params && typeof value.params === "object" ? value.params : {};

      if (type === "threshold") {
        normalized.params.auto = params.auto !== false;
        normalized.params.level = clamp(finiteOr(params.level, 0.5), 0, 1);
        normalized.params.softness = clamp(finiteOr(params.softness, 0), 0, 0.25);
      } else if (type === "posterize") {
        normalized.params.levels = Math.round(clamp(finiteOr(params.levels, 6), 2, 16));
        normalized.params.dither = clamp(finiteOr(params.dither, 0), 0, 1);
      } else if (type === "duotone") {
        normalized.params.shadow = normalizeHexColor(params.shadow, "#000000");
        normalized.params.highlight = normalizeHexColor(params.highlight, "#ff2d55");
        normalized.params.balance = clamp(finiteOr(params.balance, 0.5), 0, 1);
      } else if (type === "gradientMap") {
        normalized.params.shadow = normalizeHexColor(params.shadow, "#000000");
        normalized.params.midtone = normalizeHexColor(params.midtone, "#ff2d55");
        normalized.params.highlight = normalizeHexColor(params.highlight, "#ffffff");
        normalized.params.midpoint = clamp(finiteOr(params.midpoint, 0.5), 0.01, 0.99);
      }

      return normalized;
    }

    function effectSignature(value) {
      var normalized = normalizeEffect(value);
      return normalized ? JSON.stringify(normalized) : "none";
    }

    function srgbUnitToLinear(value) {
      var v = clamp(value, 0, 1);
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    function linearToSrgbUnit(value) {
      var v = clamp(value, 0, 1);
      return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    }

    function linearToByte(value) {
      return Math.round(clamp(linearToSrgbUnit(value), 0, 1) * 255);
    }

    function perceptualLuminanceFromLinear(r, g, b) {
      var y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return clamp(linearToSrgbUnit(y), 0, 1);
    }

    function linearRgbToOklab(r, g, b) {
      var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
      var m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
      var s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
      var lRoot = Math.cbrt(Math.max(0, l));
      var mRoot = Math.cbrt(Math.max(0, m));
      var sRoot = Math.cbrt(Math.max(0, s));
      return {
        l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
        a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
        b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
      };
    }

    function oklabToLinearRgb(l, a, b) {
      var lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
      var mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
      var sRoot = l - 0.0894841775 * a - 1.291485548 * b;
      var lValue = lRoot * lRoot * lRoot;
      var mValue = mRoot * mRoot * mRoot;
      var sValue = sRoot * sRoot * sRoot;
      return {
        r: clamp(4.0767416621 * lValue - 3.3077115913 * mValue + 0.2309699292 * sValue, 0, 1),
        g: clamp(-1.2684380046 * lValue + 2.6097574011 * mValue - 0.3413193965 * sValue, 0, 1),
        b: clamp(-0.0041960863 * lValue - 0.7034186147 * mValue + 1.707614701 * sValue, 0, 1),
      };
    }

    function hexToOklab(value) {
      var hex = normalizeHexColor(value, "#000000");
      var r = parseInt(hex.slice(1, 3), 16);
      var g = parseInt(hex.slice(3, 5), 16);
      var b = parseInt(hex.slice(5, 7), 16);
      return linearRgbToOklab(SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b]);
    }

    function mixOklab(left, right, t) {
      var amount = clamp(t, 0, 1);
      return oklabToLinearRgb(
        left.l + (right.l - left.l) * amount,
        left.a + (right.a - left.a) * amount,
        left.b + (right.b - left.b) * amount,
      );
    }

    function buildGradientLut(effect) {
      var params = effect.params;
      var lut = new Array(256);
      var shadow = hexToOklab(params.shadow);
      var highlight = hexToOklab(params.highlight);
      if (effect.type === "duotone") {
        var balance = params.balance;
        var gamma = balance > 0 && balance < 1
          ? Math.log(0.5) / Math.log(balance)
          : 1;
        for (var i = 0; i < 256; i++) {
          var q = i / 255;
          var mappedAmount = balance <= 0
            ? (q <= 0 ? 0 : 1)
            : balance >= 1
              ? (q >= 1 ? 1 : 0)
              : Math.pow(q, gamma);
          lut[i] = mixOklab(shadow, highlight, mappedAmount);
        }
        return lut;
      }

      var midtone = hexToOklab(params.midtone);
      var midpoint = params.midpoint;
      for (var j = 0; j < 256; j++) {
        var value = j / 255;
        if (value <= midpoint) {
          lut[j] = mixOklab(shadow, midtone, value / midpoint);
        } else {
          lut[j] = mixOklab(midtone, highlight, (value - midpoint) / (1 - midpoint));
        }
      }
      return lut;
    }

    function computeOtsuThreshold(data) {
      var histogram = new Float64Array(256);
      var totalWeight = 0;
      var weightedSum = 0;
      for (var i = 0; i < data.length; i += 4) {
        var alphaWeight = data[i + 3] / 255;
        if (!(alphaWeight > 0)) continue;
        var luminance = perceptualLuminanceFromLinear(
          SRGB_TO_LINEAR[data[i]],
          SRGB_TO_LINEAR[data[i + 1]],
          SRGB_TO_LINEAR[data[i + 2]],
        );
        var bucket = Math.round(luminance * 255);
        histogram[bucket] += alphaWeight;
        totalWeight += alphaWeight;
        weightedSum += bucket * alphaWeight;
      }
      if (!(totalWeight > 0)) return 0.5;

      var backgroundWeight = 0;
      var backgroundSum = 0;
      var bestVariance = -1;
      var bestThreshold = 128;
      for (var t = 0; t < 256; t++) {
        backgroundWeight += histogram[t];
        if (!(backgroundWeight > 0)) continue;
        var foregroundWeight = totalWeight - backgroundWeight;
        if (!(foregroundWeight > 0)) break;
        backgroundSum += t * histogram[t];
        var backgroundMean = backgroundSum / backgroundWeight;
        var foregroundMean = (weightedSum - backgroundSum) / foregroundWeight;
        var delta = backgroundMean - foregroundMean;
        var variance = backgroundWeight * foregroundWeight * delta * delta;
        if (variance > bestVariance) {
          bestVariance = variance;
          bestThreshold = t;
        }
      }
      return bestThreshold / 255;
    }

    function smoothstep(edge0, edge1, value) {
      if (edge0 === edge1) return value >= edge1 ? 1 : 0;
      var t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    }

    function blendLinear(original, target, amount) {
      return original + (target - original) * amount;
    }

    function processImageData(imageData, value) {
      if (!imageData || !imageData.data) return imageData;
      var effect = normalizeEffect(value);
      if (!effect || effect.amount <= 0) return imageData;

      var data = imageData.data;
      var width = Math.max(1, Number(imageData.width) || 1);
      var amount = effect.amount;
      var gradientLut =
        effect.type === "duotone" || effect.type === "gradientMap"
          ? buildGradientLut(effect)
          : null;
      var threshold =
        effect.type === "threshold" && effect.params.auto
          ? computeOtsuThreshold(data)
          : effect.type === "threshold"
            ? effect.params.level
            : 0.5;

      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        var originalR = SRGB_TO_LINEAR[data[i]];
        var originalG = SRGB_TO_LINEAR[data[i + 1]];
        var originalB = SRGB_TO_LINEAR[data[i + 2]];
        var luminance = perceptualLuminanceFromLinear(originalR, originalG, originalB);
        var targetR = originalR;
        var targetG = originalG;
        var targetB = originalB;

        if (effect.type === "grayscale") {
          var grayLinear = srgbUnitToLinear(luminance);
          targetR = grayLinear;
          targetG = grayLinear;
          targetB = grayLinear;
        } else if (effect.type === "threshold") {
          var softness = effect.params.softness;
          var bw = softness > 0
            ? smoothstep(threshold - softness / 2, threshold + softness / 2, luminance)
            : luminance > threshold
              ? 1
              : 0;
          var bwLinear = srgbUnitToLinear(bw);
          targetR = bwLinear;
          targetG = bwLinear;
          targetB = bwLinear;
        } else if (effect.type === "posterize") {
          var lab = linearRgbToOklab(originalR, originalG, originalB);
          var levels = effect.params.levels;
          var pixelIndex = i / 4;
          var x = pixelIndex % width;
          var y = Math.floor(pixelIndex / width);
          var bayer = (BAYER_4X4[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5;
          var shifted = clamp(lab.l + bayer * effect.params.dither / Math.max(1, levels - 1), 0, 1);
          var quantized = Math.round(shifted * (levels - 1)) / (levels - 1);
          var posterized = oklabToLinearRgb(quantized, lab.a, lab.b);
          targetR = posterized.r;
          targetG = posterized.g;
          targetB = posterized.b;
        } else if (gradientLut) {
          var mapped = gradientLut[Math.round(luminance * 255)];
          targetR = mapped.r;
          targetG = mapped.g;
          targetB = mapped.b;
        }

        data[i] = linearToByte(blendLinear(originalR, targetR, amount));
        data[i + 1] = linearToByte(blendLinear(originalG, targetG, amount));
        data[i + 2] = linearToByte(blendLinear(originalB, targetB, amount));
      }
      return imageData;
    }

    return {
      EFFECT_TYPES: EFFECT_TYPES.slice(),
      defaultsForType: defaultsForType,
      normalizeEffect: normalizeEffect,
      effectSignature: effectSignature,
      normalizeHexColor: normalizeHexColor,
      computeOtsuThreshold: computeOtsuThreshold,
      processImageData: processImageData,
    };
  },
);
