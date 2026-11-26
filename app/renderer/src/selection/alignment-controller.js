(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports)
    module.exports = api(require('./alignment-geometry'));
  else {
    root.SoapyPanels.selection = root.SoapyPanels.selection || {};
    root.SoapyPanels.selection.alignmentController = api(
      root.SoapyPanels.selection.alignmentGeometry,
    );
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  return function (geometry) {
    const STORAGE_KEY = 'sp.alignmentGuides';
    const modes = ['off', 'guides', 'snap'];
    function createController({ storage, onGuides = () => {} } = {}) {
      let mode = 'guides';
      try {
        const saved = storage && storage.getItem(STORAGE_KEY);
        if (modes.includes(saved)) mode = saved;
      } catch {
        /* Defaults work without storage. */
      }
      let active = null;
      let preparations = 0;
      let guides = [];
      let evaluations = 0;
      function clear() {
        active = null;
        guides = [];
        onGuides([], null);
      }
      function begin({ bubbles, movingIds, canvas, pointerId, selectionId }) {
        clear();
        const prepared = geometry.prepareTargets(bubbles, movingIds, canvas);
        preparations++;
        if (!prepared.movingBounds) return false;
        active = { prepared, pointerId, selectionId, previous: {}, canvas };
        return true;
      }
      function update({ dx, dy, scale, bypass, pointerId, selectionId }) {
        if (!active) return { dx, dy };
        if (
          pointerId !== active.pointerId ||
          selectionId !== active.selectionId
        ) {
          clear();
          return { dx, dy };
        }
        if (mode === 'off') {
          active.previous = {};
          guides = [];
          onGuides([], null);
          return { dx, dy };
        }
        const result = geometry.resolve({
          movingBounds: active.prepared.movingBounds,
          translation: { dx, dy },
          prepared: active.prepared,
          scale,
          previous: active.previous,
          snap: mode === 'snap',
          bypass,
        });
        active.previous = result.state;
        guides = result.guides;
        evaluations = result.evaluations;
        onGuides(guides, { scale, canvas: active.canvas });
        return result.translation;
      }
      return {
        begin,
        update,
        clear,
        end(pointerId) {
          if (active && active.pointerId === pointerId) clear();
        },
        selectionChanged(id) {
          if (active && active.selectionId !== id) clear();
        },
        setMode(value) {
          mode = modes.includes(value) ? value : 'guides';
          if (active) active.previous = {};
          guides = [];
          onGuides([], null);
          try {
            if (storage) storage.setItem(STORAGE_KEY, mode);
          } catch {
            /* Preference is optional. */
          }
          return mode;
        },
        getMode: () => mode,
        inspect: () => ({
          mode,
          active: !!active,
          pointerId: active && active.pointerId,
          selectionId: active && active.selectionId,
          preparations,
          evaluations,
          guides: guides.map((g) => ({ ...g })),
        }),
      };
    }
    return { createController, STORAGE_KEY };
  };
});
