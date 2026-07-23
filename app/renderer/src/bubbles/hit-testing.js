const bubbleHitTestingHelpers = (() => {
  function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function rotatePoint(px, py, cx, cy, angleRad) {
    const sin = Math.sin(angleRad);
    const cos = Math.cos(angleRad);
    const dx = px - cx;
    const dy = py - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  }

  function getRotatedBubbleBounds(bubble, pad = 0) {
    if (!bubble || typeof bubble !== 'object') return null;
    const x = toFiniteNumber(bubble.x, NaN);
    const y = toFiniteNumber(bubble.y, NaN);
    const w = toFiniteNumber(bubble.w, NaN);
    const h = toFiniteNumber(bubble.h, NaN);
    if (!(Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0)) return null;

    const hitPad = Math.max(0, toFiniteNumber(pad, 0));
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rot = (toFiniteNumber(bubble.rot, 0) * Math.PI) / 180;

    if (!rot) {
      return {
        l: x - hitPad,
        t: y - hitPad,
        r: x + w + hitPad,
        b: y + h + hitPad,
      };
    }

    const sin = Math.sin(rot);
    const cos = Math.cos(rot);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    function includePoint(px, py) {
      const dx = px - cx;
      const dy = py - cy;
      const rx = cx + dx * cos - dy * sin;
      const ry = cy + dx * sin + dy * cos;
      if (rx < left) left = rx;
      if (ry < top) top = ry;
      if (rx > right) right = rx;
      if (ry > bottom) bottom = ry;
    }

    includePoint(x, y);
    includePoint(x + w, y);
    includePoint(x + w, y + h);
    includePoint(x, y + h);

    return {
      l: left - hitPad,
      t: top - hitPad,
      r: right + hitPad,
      b: bottom + hitPad,
    };
  }

  function pointInBounds(px, py, bounds) {
    return !!(
      bounds &&
      Number.isFinite(px) &&
      Number.isFinite(py) &&
      px >= bounds.l &&
      px <= bounds.r &&
      py >= bounds.t &&
      py <= bounds.b
    );
  }

  function isPointNearRotatedBubbleBounds(bubble, px, py, pad = 0) {
    return pointInBounds(px, py, getRotatedBubbleBounds(bubble, pad));
  }

  return {
    getRotatedBubbleBounds,
    isPointNearRotatedBubbleBounds,
    pointInBounds,
    rotatePoint,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = bubbleHitTestingHelpers;
} else {
  const root = typeof self !== 'undefined' ? self : window;
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.bubbles = root.SoapyPanels.bubbles || {};
  root.SoapyPanels.bubbles.hitTesting = bubbleHitTestingHelpers;
}
