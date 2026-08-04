'use strict';

(function exposeLocalFontFamilies(root) {
  function normalizeFamily(value) {
    return String(value || '')
      .replace(/["']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function familyKey(value) {
    return normalizeFamily(value).toLocaleLowerCase();
  }

  function normalizeWeight(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : 400;
  }

  function normalizeStyle(value) {
    const style = String(value || '').toLowerCase().trim();
    return style === 'italic' || style === 'oblique' ? style : 'normal';
  }

  const WEIGHT_LABELS = Object.freeze({
    100: 'Thin',
    200: 'Extra Light',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'Semi Bold',
    700: 'Bold',
    800: 'Extra Bold',
    900: 'Black',
  });

  function weightLabel(value) {
    const weight = normalizeWeight(value);
    return WEIGHT_LABELS[weight] || String(weight);
  }

  function isBinaryStyleVariant(font) {
    if (!font) return false;
    const weight = normalizeWeight(font.weight);
    return (
      (weight === 400 || weight === 700) &&
      ['normal', 'italic', 'oblique'].includes(normalizeStyle(font.style))
    );
  }

  function getBaseFamily(font) {
    return normalizeFamily(font && (font.baseFamily || font.family));
  }

  function resolveCanonicalFamily(value, fonts) {
    const normalized = normalizeFamily(value);
    if (!normalized) return '';
    const key = familyKey(normalized);
    const candidates = Array.isArray(fonts) ? fonts : [];
    for (const font of candidates) {
      const baseFamily = getBaseFamily(font);
      if (!baseFamily) continue;
      const aliases = [
        baseFamily,
        normalizeFamily(font.family),
        normalizeFamily(font.legacyFamily),
      ];
      if (aliases.some((alias) => alias && familyKey(alias) === key)) {
        return baseFamily;
      }
    }
    return normalized;
  }

  function cloneFont(font) {
    return Object.assign({}, font, {
      sources: Array.isArray(font.sources)
        ? font.sources.map((source) => Object.assign({}, source))
        : font.sources,
    });
  }

  function unionCoverageRanges(fonts) {
    const combinedRanges = [];
    (fonts || []).forEach((font) => {
      const fontRanges = font && font.coverageRanges;
      if (!Array.isArray(fontRanges)) return;
      fontRanges.forEach((range) => {
        if (!Array.isArray(range) || range.length < 2) return;
        const start = Number(range[0]);
        const end = Number(range[1]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        combinedRanges.push([Math.min(start, end), Math.max(start, end)]);
      });
    });
    if (!combinedRanges.length) return null;
    combinedRanges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [combinedRanges[0].slice()];
    for (let index = 1; index < combinedRanges.length; index += 1) {
      const current = combinedRanges[index];
      const previous = merged[merged.length - 1];
      if (current[0] <= previous[1] + 1) {
        previous[1] = Math.max(previous[1], current[1]);
        continue;
      }
      merged.push(current.slice());
    }
    return merged;
  }

  function canonicalizeFaces(fonts) {
    return (Array.isArray(fonts) ? fonts : []).map((font) => {
      const copy = cloneFont(font);
      const baseFamily = getBaseFamily(copy);
      const originalFamily = normalizeFamily(copy.family);
      copy.baseFamily = baseFamily || originalFamily;
      copy.family = baseFamily || originalFamily;
      if (originalFamily && originalFamily !== copy.family) {
        copy.legacyFamily = originalFamily;
      }
      return copy;
    });
  }

  function stableGroupId(baseFamily) {
    const slug = familyKey(baseFamily).replace(/[^a-z0-9]+/g, '-');
    return `family:${slug || 'local-font'}`;
  }

  function sortFacesByWeight(faces) {
    return faces.slice().sort((a, b) => {
      const weightDifference = normalizeWeight(a.weight) - normalizeWeight(b.weight);
      if (weightDifference) return weightDifference;
      const styleA = normalizeStyle(a.style);
      const styleB = normalizeStyle(b.style);
      if (styleA === styleB) return 0;
      if (styleA === 'normal') return -1;
      if (styleB === 'normal') return 1;
      return styleA.localeCompare(styleB);
    });
  }

  function chooseDefaultFace(group) {
    const normalFaces = group.filter(
      (font) => normalizeStyle(font.style) === 'normal',
    );
    const candidates = normalFaces.length ? normalFaces : group;
    return sortFacesByWeight(candidates).sort(
      (a, b) =>
        Math.abs(normalizeWeight(a.weight) - 400) -
        Math.abs(normalizeWeight(b.weight) - 400),
    )[0];
  }

  function buildWeightOptions(group) {
    const byWeight = new Map();
    group.forEach((font) => {
      const value = String(normalizeWeight(font.weight));
      if (!byWeight.has(value)) {
        byWeight.set(value, {
          value,
          label: weightLabel(value),
          faceIds: [],
          styles: [],
        });
      }
      const option = byWeight.get(value);
      if (font.id) option.faceIds.push(font.id);
      const style = normalizeStyle(font.style);
      if (!option.styles.includes(style)) option.styles.push(style);
    });
    return Array.from(byWeight.values()).sort(
      (a, b) => Number(a.value) - Number(b.value),
    );
  }

  function findNearestBoldWeight(weightOptions) {
    const weights = weightOptions
      .map((option) => Number(option.value))
      .filter((value) => Number.isFinite(value));
    if (weights.includes(700)) return '700';
    const heavier = weights.filter((value) => value >= 600);
    if (!heavier.length) return null;
    heavier.sort((a, b) => {
      const distance = Math.abs(a - 700) - Math.abs(b - 700);
      return distance || b - a;
    });
    return String(heavier[0]);
  }

  function buildPickerEntries(fonts) {
    const groups = new Map();
    (Array.isArray(fonts) ? fonts : []).forEach((font) => {
      const baseFamily = getBaseFamily(font);
      if (!baseFamily) return;
      const key = familyKey(baseFamily);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(font);
    });

    const entries = [];
    groups.forEach((group) => {
      const baseFamily = getBaseFamily(group[0]);
      const groupId = stableGroupId(baseFamily);
      const groupFaceIds = group
        .map((candidate) => candidate.id)
        .filter(Boolean);
      const representative = chooseDefaultFace(group);
      const weightOptions = buildWeightOptions(group);
      const entry = cloneFont(representative);
      entry.id = groupId;
      entry.family = baseFamily;
      entry.baseFamily = baseFamily;
      entry.groupId = groupId;
      entry.label = baseFamily;
      entry.descriptor = '';
      entry.coverageFaceIds = groupFaceIds.slice();
      entry.legacyIds = groupFaceIds.slice();
      entry.legacyFamilies = group
        .map((candidate) => normalizeFamily(candidate.legacyFamily || candidate.family))
        .filter((family) => family && family !== baseFamily);
      entry.coverageRanges = unionCoverageRanges(group);
      entry.weightOptions = weightOptions;
      entry.availableWeights = weightOptions.map((option) => option.value);
      entry.defaultWeight = String(normalizeWeight(representative.weight));
      entry.regularWeight = weightOptions.some((option) => option.value === '400')
        ? '400'
        : entry.defaultWeight;
      entry.nearestBoldWeight = findNearestBoldWeight(weightOptions);
      entry.faceVariants = group.map((font) => ({
        id: font.id,
        weight: String(normalizeWeight(font.weight)),
        style: normalizeStyle(font.style),
      }));
      entries.push(entry);
    });
    return entries;
  }

  function migrateFavoriteIds(favorites, entries) {
    const migrated = new Set(favorites instanceof Set ? favorites : []);
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (!entry || !entry.id || !Array.isArray(entry.legacyIds)) return;
      if (!entry.legacyIds.some((id) => migrated.has(id))) return;
      migrated.add(entry.id);
      entry.legacyIds.forEach((id) => migrated.delete(id));
    });
    return migrated;
  }

  function replacePrimaryFamily(fontValue, baseFamily) {
    const family = normalizeFamily(baseFamily);
    if (!family) return fontValue;
    const raw = typeof fontValue === 'string' ? fontValue.trim() : '';
    if (!raw) return family;
    const commaIndex = raw.indexOf(',');
    const fallback = commaIndex >= 0 ? raw.slice(commaIndex + 1).trim() : '';
    const quotedFamily = /\s/.test(family) ? `'${family.replace(/'/g, "\\'")}'` : family;
    return fallback ? `${quotedFamily}, ${fallback}` : quotedFamily;
  }

  const api = {
    canonicalizeFaces,
    resolveCanonicalFamily,
    buildPickerEntries,
    migrateFavoriteIds,
    replacePrimaryFamily,
    isBinaryStyleVariant,
    unionCoverageRanges,
    normalizeWeight,
    normalizeStyle,
    weightLabel,
    findNearestBoldWeight,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.fonts = root.SoapyPanels.fonts || {};
  root.SoapyPanels.fonts.families = api;
})(typeof window !== 'undefined' ? window : globalThis);


