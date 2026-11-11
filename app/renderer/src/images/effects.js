(function (root, factory) {
  const api = factory();
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

    const EFFECT_TYPES = [
      "grayscale",
      "threshold",
      "posterize",
      "duotone",
      "gradientMap",
    ];

    const SRGB_TO_LINEAR = new Float64Array(256);
    for (let lutIndex = 0; lutIndex < 256; lutIndex++) {
      SRGB_TO_LINEAR[lutIndex] = srgbUnitToLinear(lutIndex / 255);
    }

    const BAYER_4X4 = [
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
      const numeric = Number(value);
      return isFinite(numeric) ? numeric : fallback;
    }

    function normalizeHexColor(value, fallback) {
      const fallbackValue = typeof fallback === "string" ? fallback.toLowerCase() : "#000000";
      if (typeof value !== "string") return fallbackValue;
      const raw = value.trim().toLowerCase();
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
      const type = EFFECT_TYPES.indexOf(value.type) !== -1 ? value.type : null;
      if (!type) return null;
      const normalized = defaultsForType(type);
      normalized.amount = clamp(finiteOr(value.amount, 1), 0, 1);
      const params = value.params && typeof value.params === "object" ? value.params : {};

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
      const normalized = normalizeEffect(value);
      return normalized ? JSON.stringify(normalized) : "none";
    }

    function srgbUnitToLinear(value) {
      const v = clamp(value, 0, 1);
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    function linearToSrgbUnit(value) {
      const v = clamp(value, 0, 1);
      return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    }

    function linearToByte(value) {
      return Math.round(clamp(linearToSrgbUnit(value), 0, 1) * 255);
    }

    function perceptualLuminanceFromLinear(r, g, b) {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return clamp(linearToSrgbUnit(y), 0, 1);
    }

    function linearRgbToOklab(r, g, b) {
      const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
      const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
      const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
      const lRoot = Math.cbrt(Math.max(0, l));
      const mRoot = Math.cbrt(Math.max(0, m));
      const sRoot = Math.cbrt(Math.max(0, s));
      return {
        l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
        a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
        b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
      };
    }

    function oklabToLinearRgb(l, a, b) {
      const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
      const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
      const sRoot = l - 0.0894841775 * a - 1.291485548 * b;
      const lValue = lRoot * lRoot * lRoot;
      const mValue = mRoot * mRoot * mRoot;
      const sValue = sRoot * sRoot * sRoot;
      return {
        r: clamp(4.0767416621 * lValue - 3.3077115913 * mValue + 0.2309699292 * sValue, 0, 1),
        g: clamp(-1.2684380046 * lValue + 2.6097574011 * mValue - 0.3413193965 * sValue, 0, 1),
        b: clamp(-0.0041960863 * lValue - 0.7034186147 * mValue + 1.707614701 * sValue, 0, 1),
      };
    }

    function hexToOklab(value) {
      const hex = normalizeHexColor(value, "#000000");
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return linearRgbToOklab(SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b]);
    }

    function mixOklab(left, right, t) {
      const amount = clamp(t, 0, 1);
      return oklabToLinearRgb(
        left.l + (right.l - left.l) * amount,
        left.a + (right.a - left.a) * amount,
        left.b + (right.b - left.b) * amount,
      );
    }

    function buildGradientLut(effect) {
      const params = effect.params;
      const lut = new Array(256);
      const shadow = hexToOklab(params.shadow);
      const highlight = hexToOklab(params.highlight);
      if (effect.type === "duotone") {
        const balance = params.balance;
        const gamma = balance > 0 && balance < 1
          ? Math.log(0.5) / Math.log(balance)
          : 1;
        for (let i = 0; i < 256; i++) {
          const q = i / 255;
          const mappedAmount = balance <= 0
            ? (q <= 0 ? 0 : 1)
            : balance >= 1
              ? (q >= 1 ? 1 : 0)
              : Math.pow(q, gamma);
          lut[i] = mixOklab(shadow, highlight, mappedAmount);
        }
        return lut;
      }

      const midtone = hexToOklab(params.midtone);
      const midpoint = params.midpoint;
      for (let j = 0; j < 256; j++) {
        const value = j / 255;
        if (value <= midpoint) {
          lut[j] = mixOklab(shadow, midtone, value / midpoint);
        } else {
          lut[j] = mixOklab(midtone, highlight, (value - midpoint) / (1 - midpoint));
        }
      }
      return lut;
    }

    function computeOtsuThreshold(data) {
      const histogram = new Float64Array(256);
      let totalWeight = 0;
      let weightedSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alphaWeight = data[i + 3] / 255;
        if (!(alphaWeight > 0)) continue;
        const luminance = perceptualLuminanceFromLinear(
          SRGB_TO_LINEAR[data[i]],
          SRGB_TO_LINEAR[data[i + 1]],
          SRGB_TO_LINEAR[data[i + 2]],
        );
        const bucket = Math.round(luminance * 255);
        histogram[bucket] += alphaWeight;
        totalWeight += alphaWeight;
        weightedSum += bucket * alphaWeight;
      }
      if (!(totalWeight > 0)) return 0.5;

      let backgroundWeight = 0;
      let backgroundSum = 0;
      let bestVariance = -1;
      let bestThreshold = 128;
      for (let t = 0; t < 256; t++) {
        backgroundWeight += histogram[t];
        if (!(backgroundWeight > 0)) continue;
        const foregroundWeight = totalWeight - backgroundWeight;
        if (!(foregroundWeight > 0)) break;
        backgroundSum += t * histogram[t];
        const backgroundMean = backgroundSum / backgroundWeight;
        const foregroundMean = (weightedSum - backgroundSum) / foregroundWeight;
        const delta = backgroundMean - foregroundMean;
        const variance = backgroundWeight * foregroundWeight * delta * delta;
        if (variance > bestVariance) {
          bestVariance = variance;
          bestThreshold = t;
        }
      }
      return bestThreshold / 255;
    }

    function smoothstep(edge0, edge1, value) {
      if (edge0 === edge1) return value >= edge1 ? 1 : 0;
      const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    }

    function blendLinear(original, target, amount) {
      return original + (target - original) * amount;
    }

    // Small bounded cache: slider drags must not retain every historical palette.
    const gradientCache = new Map();
    function cachedGradientLut(effect) {
      const key = JSON.stringify([effect.type, effect.params]);
      if (gradientCache.has(key)) return gradientCache.get(key);
      const lut = buildGradientLut(effect);
      gradientCache.set(key, lut);
      if (gradientCache.size > 16) gradientCache.delete(gradientCache.keys().next().value);
      return lut;
    }

    function processImageData(imageData, value) {
      if (!imageData || !imageData.data) return imageData;
      const effect = normalizeEffect(value);
      if (!effect || effect.amount <= 0) return imageData;

      const data = imageData.data;
      const width = Math.max(1, Number(imageData.width) || 1);
      const amount = effect.amount;
      const gradientLut =
        effect.type === "duotone" || effect.type === "gradientMap"
          ? cachedGradientLut(effect)
          : null;
      const threshold =
        effect.type === "threshold" && effect.params.auto
          ? computeOtsuThreshold(data)
          : effect.type === "threshold"
            ? effect.params.level
            : 0.5;

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const originalR = SRGB_TO_LINEAR[data[i]];
        const originalG = SRGB_TO_LINEAR[data[i + 1]];
        const originalB = SRGB_TO_LINEAR[data[i + 2]];
        const luminance = perceptualLuminanceFromLinear(originalR, originalG, originalB);
        let targetR = originalR;
        let targetG = originalG;
        let targetB = originalB;

        if (effect.type === "grayscale") {
          const grayLinear = srgbUnitToLinear(luminance);
          targetR = grayLinear;
          targetG = grayLinear;
          targetB = grayLinear;
        } else if (effect.type === "threshold") {
          const softness = effect.params.softness;
          const bw = softness > 0
            ? smoothstep(threshold - softness / 2, threshold + softness / 2, luminance)
            : luminance > threshold
              ? 1
              : 0;
          const bwLinear = srgbUnitToLinear(bw);
          targetR = bwLinear;
          targetG = bwLinear;
          targetB = bwLinear;
        } else if (effect.type === "posterize") {
          const lab = linearRgbToOklab(originalR, originalG, originalB);
          const levels = effect.params.levels;
          const pixelIndex = i / 4;
          const x = pixelIndex % width;
          const y = Math.floor(pixelIndex / width);
          const bayer = (BAYER_4X4[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5;
          const shifted = clamp(lab.l + bayer * effect.params.dither / Math.max(1, levels - 1), 0, 1);
          const quantized = Math.round(shifted * (levels - 1)) / (levels - 1);
          const posterized = oklabToLinearRgb(quantized, lab.a, lab.b);
          targetR = posterized.r;
          targetG = posterized.g;
          targetB = posterized.b;
        } else if (gradientLut) {
          const mapped = gradientLut[Math.round(luminance * 255)];
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
