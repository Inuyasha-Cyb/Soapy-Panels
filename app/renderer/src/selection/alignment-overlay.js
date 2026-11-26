(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoapyPanels.selection.alignmentOverlay = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createOverlay({
    element,
    document,
    requestFrame,
    cancelFrame,
    formatGap,
  }) {
    const ns = 'http://www.w3.org/2000/svg';
    let pending = null,
      frame = null;
    function node(name, attributes, text) {
      const item = document.createElementNS(ns, name);
      for (const [key, value] of Object.entries(attributes))
        item.setAttribute(key, String(value));
      if (text !== undefined) item.textContent = text;
      return item;
    }
    function clear() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      pending = null;
      element.replaceChildren();
      element.style.display = 'none';
    }
    function paint() {
      frame = null;
      if (!pending) return;
      const { guides, scale, canvas } = pending;
      const sx = scale.sx > 0 ? scale.sx : 1,
        sy = scale.sy > 0 ? scale.sy : 1;
      element.setAttribute('viewBox', `0 0 ${canvas.w} ${canvas.h}`);
      element.setAttribute('preserveAspectRatio', 'none');
      element.style.display = '';
      const lines = document.createDocumentFragment(),
        labels = document.createDocumentFragment();
      function line(x1, y1, x2, y2, kind) {
        lines.append(
          node('line', {
            x1,
            y1,
            x2,
            y2,
            class: `alignment-guide-line ${kind}`,
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      }
      function label(x, y, text) {
        const clampedX = Math.min(
          Math.max(x, 24 / sx),
          Math.max(24 / sx, canvas.w - 24 / sx),
        );
        const clampedY = Math.min(
          Math.max(y, 14 / sy),
          Math.max(14 / sy, canvas.h - 6 / sy),
        );
        labels.append(
          node(
            'text',
            {
              transform: `translate(${clampedX} ${clampedY}) scale(${1 / sx} ${1 / sy})`,
              class: 'alignment-guide-label',
              'text-anchor': 'middle',
            },
            text,
          ),
        );
      }
      for (const guide of guides) {
        const m = guide.moving;
        if (guide.kind === 'alignment') {
          const b = guide.target;
          if (guide.axis === 'x')
            line(
              guide.coordinate,
              Math.min(m.t, b.t) - 8 / sy,
              guide.coordinate,
              Math.max(m.b, b.b) + 8 / sy,
              'alignment',
            );
          else
            line(
              Math.min(m.l, b.l) - 8 / sx,
              guide.coordinate,
              Math.max(m.r, b.r) + 8 / sx,
              guide.coordinate,
              'alignment',
            );
          continue;
        }
        const [a, b] = guide.neighbors;
        const sequence =
          guide.placement === 'before'
            ? [m, a, b]
            : guide.placement === 'after'
              ? [a, b, m]
              : [a, m, b];
        for (let i = 0; i < 2; i++) {
          const from = sequence[i],
            to = sequence[i + 1];
          if (guide.axis === 'x') {
            const y = Math.min(
              Math.max(from.b, to.b) + 14 / sy,
              canvas.h - 18 / sy,
            );
            line(from.r, y, to.l, y, 'spacing');
            for (const x of [from.r, to.l])
              line(x, y - 4 / sy, x, y + 4 / sy, 'spacing');
            label((from.r + to.l) / 2, y - 6 / sy, formatGap(guide.gap));
          } else {
            const x = Math.min(
              Math.max(from.r, to.r) + 14 / sx,
              canvas.w - 28 / sx,
            );
            line(x, from.b, x, to.t, 'spacing');
            for (const y of [from.b, to.t])
              line(x - 4 / sx, y, x + 4 / sx, y, 'spacing');
            label(x + 22 / sx, (from.b + to.t) / 2, formatGap(guide.gap));
          }
        }
      }
      // Labels are always painted after every line, not interleaved with brackets.
      element.replaceChildren(lines, labels);
    }
    return {
      clear,
      render(guides, meta) {
        if (!guides.length || !meta) {
          clear();
          return;
        }
        pending = { guides, ...meta };
        if (frame === null) frame = requestFrame(paint);
      },
    };
  }
  return { createOverlay };
});
