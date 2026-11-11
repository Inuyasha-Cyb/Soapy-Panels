(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SoapyPanels = root.SoapyPanels || {};
    root.SoapyPanels.project = root.SoapyPanels.project || {};
    root.SoapyPanels.project.snapshots = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createSnapshots(deps) {
    const { getState, normalizePaintMask, serializeBackgroundImages } = deps;
    function canonical(value) {
      if (Array.isArray(value)) return value.map(canonical);
      if (!value || typeof value !== 'object') return value;
      const result = {};
      Object.keys(value)
        .sort()
        .forEach((key) => {
          result[key] = canonical(value[key]);
        });
      return result;
    }
    function takeProjectSnapshot() {
      const state = getState();
      try {
        return JSON.stringify(
          canonical({
            bg: {
              color: state.bg.color,
              opacity: state.bg.opacity,
              w: state.bg.w,
              h: state.bg.h,
              gradient: state.bg.gradient || null,
              paintMask: state.bg.paintMask
                ? normalizePaintMask(state.bg.paintMask)
                : { strokes: [] },
              images: serializeBackgroundImages({ omitVideo: true }),
            },
            // Rendering supplies these defaults lazily. They are not edits.
            bubbles: state.bubbles.map((bubble) =>
              Object.assign({}, bubble, {
                textVertical: bubble.textVertical === true,
                strokeGradient: bubble.strokeGradient || null,
              }),
            ),
            savedStyles: state.savedStyles,
          }),
        );
      } catch {
        return null;
      }
    }

    // Capture values and Blob references synchronously, before any conversion awaits.
    const encodings = new Map();
    function capture() {
      const snapshot = takeProjectSnapshot();
      if (!snapshot) throw new Error('Cannot capture project');
      const data = JSON.parse(snapshot);
      const originals = new Map(
        (getState().bg.images || []).map((entry) => [entry.id, entry]),
      );
      const sources = data.bg.images.map((entry) => ({
        blob: deps.getBlob(entry.id),
        src: entry.src,
        image: originals.get(entry.id) && originals.get(entry.id).image,
      }));
      return { snapshot, data, sources };
    }
    async function toBlob(captured) {
      const data = JSON.parse(JSON.stringify(captured.data));
      const used = new Set();
      for (let index = 0; index < data.bg.images.length; index++) {
        const entry = data.bg.images[index];
        const source = captured.sources[index];
        const key = source.blob || source.src || source.image;
        used.add(key);
        if (typeof entry.src === 'string' && entry.src.startsWith('data:'))
          continue;
        if (!encodings.has(key)) {
          const conversion = source.blob
            ? deps.blobToDataUrl(source.blob)
            : deps.sourceToDataUrl(source.src);
          encodings.set(
            key,
            Promise.resolve(conversion).catch((error) => {
              encodings.delete(key);
              throw error;
            }),
          );
        }
        entry.src = await encodings.get(key);
        if (
          !entry.src &&
          entry.mediaKind !== 'gif' &&
          source.image &&
          deps.document
        ) {
          const canvas = deps.document.createElement('canvas');
          canvas.width =
            entry.naturalWidth ||
            source.image.naturalWidth ||
            source.image.width;
          canvas.height =
            entry.naturalHeight ||
            source.image.naturalHeight ||
            source.image.height;
          if (canvas.width && canvas.height) {
            canvas
              .getContext('2d')
              .drawImage(source.image, 0, 0, canvas.width, canvas.height);
            entry.src = canvas.toDataURL('image/png');
            encodings.set(key, Promise.resolve(entry.src));
          }
        }
        if (!entry.src || !entry.src.startsWith('data:')) {
          encodings.delete(key);
          throw new Error('Project media could not be embedded');
        }
      }
      for (const key of encodings.keys())
        if (!used.has(key)) encodings.delete(key);
      data.bg.image = data.bg.images.length ? data.bg.images[0].src : null;
      return new Blob([JSON.stringify(data)], { type: deps.mimeType });
    }
    return { takeProjectSnapshot, capture, toBlob };
  }
  return { createSnapshots };
});
