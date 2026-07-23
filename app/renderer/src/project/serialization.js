const projectColorEffects = (() => {
  if (typeof module !== 'undefined' && module.exports) {
    return require('../images/effects');
  }
  if (
    typeof window !== 'undefined' &&
    window.SoapyPanels &&
    window.SoapyPanels.images
  ) {
    return window.SoapyPanels.images.effects || null;
  }
  return null;
})();

const projectSerialization = (() => {
  const PROJECT_FILE_CONTRACT = Object.freeze({
    preferredExtension: '.soapy',
    legacyExtensions: Object.freeze(['.json']),
    mimeType: 'application/json',
    suggestedName: 'bubble_project.soapy',
  });

  function toNumberOrDefault(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  function clampOpacity(value, fallback) {
    const numeric = toNumberOrDefault(value, fallback);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric < 0) return 0;
    if (numeric > 1) return 1;
    return numeric;
  }

  function isStickerSource(value) {
    if (typeof value !== 'string') return false;
    return value.toLowerCase().indexOf('assets/stickers/') !== -1;
  }

  function isVideoSource(value, mimeType) {
    if (
      typeof mimeType === 'string' &&
      mimeType.toLowerCase().split(';')[0].trim() === 'video/mp4'
    ) {
      return true;
    }
    if (typeof value !== 'string') return false;
    return /^data:video\/mp4(?:;|,)/i.test(value) || /\.mp4(?:$|[?#])/i.test(value);
  }

  function isSessionOnlyVideoEntry(item) {
    if (!item || typeof item !== 'object') return false;
    return item.mediaKind === 'video' || isVideoSource(item.src, item.mimeType);
  }

  function countSessionOnlyVideos(source) {
    const list = Array.isArray(source) ? source : [];
    let count = 0;
    for (const item of list) {
      if (isSessionOnlyVideoEntry(item)) count += 1;
    }
    return count;
  }

  function isGifSource(value, mimeType) {
    if (
      typeof mimeType === 'string' &&
      mimeType.toLowerCase().split(';')[0].trim() === 'image/gif'
    ) {
      return true;
    }
    if (typeof value !== 'string') return false;
    return /^data:image\/gif(?:;|,)/i.test(value) || /\.gif(?:$|[?#])/i.test(value);
  }

  function cloneEraseMask(mask) {
    const safe = { strokes: [] };
    const strokes = mask && Array.isArray(mask.strokes) ? mask.strokes : [];
    for (const stroke of strokes) {
      if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length)
        continue;
      const size = Number.isFinite(stroke.size) ? Math.max(0, stroke.size) : 0;
      const strength = clampOpacity(stroke.strength, 1);
      const pts = [];
      for (const pt of stroke.points) {
        if (!pt) continue;
        const nx = Number.isFinite(pt.nx)
          ? Math.max(-0.5, Math.min(1.5, pt.nx))
          : null;
        const ny = Number.isFinite(pt.ny)
          ? Math.max(-0.5, Math.min(1.5, pt.ny))
          : null;
        if (nx === null || ny === null) continue;
        pts.push({ nx, ny });
      }
      if (!pts.length) continue;
      safe.strokes.push({ points: pts, size, strength });
    }
    return safe;
  }

  function normalizePaintColor(value) {
    if (typeof value !== 'string') return '#ff2d55';
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
    return '#ff2d55';
  }

  function clonePaintMask(mask) {
    const safe = { strokes: [] };
    const strokes = mask && Array.isArray(mask.strokes) ? mask.strokes : [];
    for (const stroke of strokes) {
      if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length)
        continue;
      const size = Number.isFinite(stroke.size) ? Math.max(0, stroke.size) : 0;
      const strength = clampOpacity(stroke.strength, 1);
      const color = normalizePaintColor(stroke.color);
      const pts = [];
      for (const pt of stroke.points) {
        if (!pt) continue;
        const nx = Number.isFinite(pt.nx)
          ? Math.max(-0.5, Math.min(1.5, pt.nx))
          : null;
        const ny = Number.isFinite(pt.ny)
          ? Math.max(-0.5, Math.min(1.5, pt.ny))
          : null;
        if (nx === null || ny === null) continue;
        pts.push({ nx, ny });
      }
      if (!pts.length) continue;
      safe.strokes.push({ points: pts, size, strength, color });
    }
    return safe;
  }

  function cloneBackgroundImages(source) {
    const list = Array.isArray(source) ? source : [];
    const images = [];
    for (const item of list) {
      if (!item) continue;
      if (isSessionOnlyVideoEntry(item)) continue;
      const entry = {
        id: typeof item.id === 'string' ? item.id : undefined,
        src: typeof item.src === 'string' ? item.src : null,
        name: typeof item.name === 'string' ? item.name : undefined,
      };
      entry.naturalWidth = toNumberOrDefault(item.naturalWidth, 0);
      entry.naturalHeight = toNumberOrDefault(item.naturalHeight, 0);
      entry.width = toNumberOrDefault(item.width, entry.naturalWidth);
      entry.height = toNumberOrDefault(item.height, entry.naturalHeight);
      entry.x = toNumberOrDefault(item.x, 0);
      entry.y = toNumberOrDefault(item.y, 0);
      entry.opacity = clampOpacity(item.opacity, 1);
      entry.rot = toNumberOrDefault(item.rot, 0);
      const stickerId =
        typeof item.stickerId === 'string' ? item.stickerId : undefined;
      const isSticker =
        item.isSticker === true || !!stickerId || isStickerSource(entry.src);
      if (isSticker) entry.isSticker = true;
      if (stickerId) entry.stickerId = stickerId;
      if (item.flipX === true) entry.flipX = true;
      const animatedGif = item.mediaKind === 'gif' || isGifSource(item.src, item.mimeType);
      if (animatedGif) entry.mediaKind = 'gif';
      if (typeof item.mimeType === 'string') entry.mimeType = item.mimeType;
      if (Number.isFinite(item.frameCount)) entry.frameCount = item.frameCount;
      if (Number.isFinite(item.durationMs)) entry.durationMs = item.durationMs;
      if (item.renderAboveBubbles === true) entry.renderAboveBubbles = true;
      const colorEffect =
        projectColorEffects &&
        typeof projectColorEffects.normalizeEffect === 'function'
          ? projectColorEffects.normalizeEffect(item.colorEffect)
          : null;
      if (colorEffect) entry.colorEffect = colorEffect;
      entry.eraseMask = cloneEraseMask(item.eraseMask);
      entry.paintMask = clonePaintMask(item.paintMask);
      images.push(entry);
    }
    return images;
  }

  function cloneBackground(source) {
    const bg = source || {};
    const color = typeof bg.color === 'string' ? bg.color : '#000';
    const opacity = clampOpacity(bg.opacity, 0);
    const w = toNumberOrDefault(bg.w, 1280);
    const h = toNumberOrDefault(bg.h, 720);
    const gradient =
      bg && typeof bg.gradient === 'object' && bg.gradient !== null
        ? bg.gradient
        : null;
    const images = cloneBackgroundImages(bg.images);
    if (!images.length) {
      const legacySrc =
        typeof bg.image === 'string'
          ? bg.image
          : typeof bg.imageSrc === 'string'
            ? bg.imageSrc
            : null;
      if (legacySrc && !isVideoSource(legacySrc, bg.mimeType)) {
        images.push({
          id: typeof bg.imageId === 'string' ? bg.imageId : undefined,
          src: legacySrc,
          naturalWidth: toNumberOrDefault(bg.imageNaturalWidth, w),
          naturalHeight: toNumberOrDefault(bg.imageNaturalHeight, h),
          width: toNumberOrDefault(bg.imageNaturalWidth, w),
          height: toNumberOrDefault(bg.imageNaturalHeight, h),
          x: toNumberOrDefault(bg.x, 0),
          y: toNumberOrDefault(bg.y, 0),
          opacity: clampOpacity(bg.opacity, 1),
          rot: toNumberOrDefault(bg.rot, 0),
          isSticker: isStickerSource(legacySrc),
        });
      }
    }
    return {
      color,
      opacity,
      w,
      h,
      gradient,
      paintMask: clonePaintMask(bg.paintMask),
      images,
    };
  }

  function snapshotState(state) {
    const current = state || {};
    const bg = cloneBackground(current.bg);
    const bubbles = Array.isArray(current.bubbles) ? current.bubbles : [];
    const savedStyles = Array.isArray(current.savedStyles)
      ? current.savedStyles
      : [];
    return {
      bg,
      bubbles,
      savedStyles,
    };
  }

  function stringifySnapshot(state) {
    return JSON.stringify(snapshotState(state));
  }

  function parseSnapshot(json) {
    const data = json ? JSON.parse(json) : {};
    const snap = snapshotState(data);
    const legacyImages = [];
    if (
      data &&
      data.bg &&
      typeof data.bg.image === 'string' &&
      !isVideoSource(data.bg.image, data.bg.mimeType)
    ) {
      legacyImages.push(data.bg.image);
    }
    if (
      data &&
      data.bg &&
      typeof data.bg.imageSrc === 'string' &&
      !isVideoSource(data.bg.imageSrc, data.bg.mimeType)
    ) {
      legacyImages.push(data.bg.imageSrc);
    }
    if (legacyImages.length && (!snap.bg.images || !snap.bg.images.length)) {
      snap.bg.images = legacyImages.map((src) => ({
        id: typeof data.bg.imageId === 'string' ? data.bg.imageId : undefined,
        src,
        naturalWidth: toNumberOrDefault(data.bg.imageNaturalWidth, snap.bg.w),
        naturalHeight: toNumberOrDefault(data.bg.imageNaturalHeight, snap.bg.h),
        width: toNumberOrDefault(data.bg.imageNaturalWidth, snap.bg.w),
        height: toNumberOrDefault(data.bg.imageNaturalHeight, snap.bg.h),
        x: toNumberOrDefault(data.bg.x, 0),
        y: toNumberOrDefault(data.bg.y, 0),
        opacity: clampOpacity(data.bg.opacity, 1),
        rot: toNumberOrDefault(data.bg.rot, 0),
      }));
    }
    return snap;
  }

  function normalizeProjectData(data) {
    const source = data || {};
    const snap = snapshotState(source);
    const bgSource = source.bg || {};
    const images = cloneBackgroundImages(snap.bg.images);
    let fallbackImage = null;
    if (
      typeof bgSource.image === 'string' &&
      bgSource.image &&
      !isVideoSource(bgSource.image, bgSource.mimeType)
    ) {
      fallbackImage = bgSource.image;
    } else if (
      typeof bgSource.imageSrc === 'string' &&
      bgSource.imageSrc &&
      !isVideoSource(bgSource.imageSrc, bgSource.mimeType)
    ) {
      fallbackImage = bgSource.imageSrc;
    } else if (images.length && typeof images[0].src === 'string') {
      fallbackImage = images[0].src;
    }
    return {
      bg: {
        color: snap.bg.color,
        opacity: snap.bg.opacity,
        w: snap.bg.w,
        h: snap.bg.h,
        gradient: snap.bg.gradient,
        paintMask: snap.bg.paintMask,
        images,
        image: fallbackImage || null,
        imageSrc: fallbackImage || null,
      },
      bubbles: snap.bubbles,
      savedStyles: snap.savedStyles,
    };
  }

  return {
    PROJECT_FILE_CONTRACT,
    snapshotState,
    stringifySnapshot,
    parseSnapshot,
    normalizeProjectData,
    countSessionOnlyVideos,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = projectSerialization;
} else {
  const root = typeof self !== 'undefined' ? self : window;
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.project = root.SoapyPanels.project || {};
  root.SoapyPanels.project.serialization = projectSerialization;
  root.projectSerialization = projectSerialization;
}
