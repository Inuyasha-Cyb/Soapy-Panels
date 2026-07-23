const tailCurveHelpers = (() => {
  const DEFAULTS = {
    minT: 0.05,
    maxT: 0.95,
    maxOffset: 600,
    minPointGap: 0.025,
    maxPoints: 5,
    t: 0.5,
    offset: 0,
    smoothing: 70,
  };

  function toFiniteNumber(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max, fallback) {
    const numeric = toFiniteNumber(value, fallback);
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
  }

  function sanitizeSmoothing(value, fallback = DEFAULTS.smoothing) {
    return clamp(value, 0, 100, fallback);
  }

  function sanitizePointId(value, fallbackIndex = 0) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    return `curve-point-${fallbackIndex + 1}`;
  }

  function createTailCurvePoint(id, left, right, smoothing = null) {
    return {
      id: sanitizePointId(id),
      left: sanitizeTailCurveEntry(left),
      right: sanitizeTailCurveEntry(right),
      smoothing:
        smoothing === undefined || smoothing === null || smoothing === ''
          ? null
          : sanitizeSmoothing(smoothing),
    };
  }

  function syncTailCurveLegacyAliases(curve) {
    const target = curve && typeof curve === 'object' ? curve : {};
    const points = Array.isArray(target.points) ? target.points : [];
    const first = points[0] || createTailCurvePoint(
      'curve-point-1',
      target.left,
      target.right,
    );
    target.left = sanitizeTailCurveEntry(first.left);
    target.right = sanitizeTailCurveEntry(first.right);
    if (points.length) {
      points[0].left = { ...target.left };
      points[0].right = { ...target.right };
    }
    return target;
  }

  function defaultTailCurve() {
    const point = createTailCurvePoint(
      'curve-point-1',
      { t: DEFAULTS.t, offset: DEFAULTS.offset },
      { t: DEFAULTS.t, offset: DEFAULTS.offset },
    );
    return syncTailCurveLegacyAliases({
      left: { ...point.left },
      right: { ...point.right },
      points: [point],
      smoothing: DEFAULTS.smoothing,
      independentSides: false,
    });
  }

  function sanitizeTailCurveEntry(entry, options = {}) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const fallback = options.fallback && typeof options.fallback === 'object'
      ? options.fallback
      : {};
    const fallbackT = toFiniteNumber(fallback.t, DEFAULTS.t);
    const fallbackOffset = toFiniteNumber(fallback.offset, DEFAULTS.offset);
    return {
      t: clamp(source.t, DEFAULTS.minT, DEFAULTS.maxT, fallbackT),
      offset: clamp(
        source.offset,
        -DEFAULTS.maxOffset,
        DEFAULTS.maxOffset,
        fallbackOffset,
      ),
    };
  }

  function clampTailCurveEntry(entry, maxOffset) {
    const limit = clamp(maxOffset, 0, DEFAULTS.maxOffset, DEFAULTS.maxOffset);
    const sanitized = sanitizeTailCurveEntry(entry);
    return {
      t: sanitized.t,
      offset: clamp(sanitized.offset, -limit, limit, 0),
    };
  }

  function normalizePointPositions(points) {
    const list = points
      .slice(0, DEFAULTS.maxPoints)
      .sort((a, b) => {
        const at = (a.left.t + a.right.t) / 2;
        const bt = (b.left.t + b.right.t) / 2;
        return at - bt;
      });
    const count = list.length;
    for (let index = 0; index < count; index += 1) {
      const previous = index > 0 ? list[index - 1] : null;
      const baseMin = DEFAULTS.minT + index * DEFAULTS.minPointGap;
      const max =
        DEFAULTS.maxT - (count - index - 1) * DEFAULTS.minPointGap;
      const point = list[index];
      const leftMin = previous
        ? Math.max(baseMin, previous.left.t + DEFAULTS.minPointGap)
        : baseMin;
      const rightMin = previous
        ? Math.max(baseMin, previous.right.t + DEFAULTS.minPointGap)
        : baseMin;
      point.left.t = clamp(
        point.left.t,
        leftMin,
        max,
        (leftMin + max) / 2,
      );
      point.right.t = clamp(
        point.right.t,
        rightMin,
        max,
        (rightMin + max) / 2,
      );
    }
    return list;
  }

  function normalizeTailCurve(curve) {
    const source = curve && typeof curve === 'object' ? curve : {};
    const fallbackLeft = sanitizeTailCurveEntry(source.left);
    const fallbackRight = sanitizeTailCurveEntry(source.right);
    const sourcePoints =
      Array.isArray(source.points) && source.points.length
        ? source.points
        : [{
          id: 'curve-point-1',
          left: fallbackLeft,
          right: fallbackRight,
        }];
    const usedIds = new Set();
    const points = normalizePointPositions(
      sourcePoints.map((point, index) => {
        const item = point && typeof point === 'object' ? point : {};
        let id = sanitizePointId(item.id, index);
        if (usedIds.has(id)) id = `${id}-${index + 1}`;
        usedIds.add(id);
        return createTailCurvePoint(
          id,
          item.left || (index === 0 ? fallbackLeft : undefined),
          item.right || (index === 0 ? fallbackRight : undefined),
          item.smoothing,
        );
      }),
    );
    return syncTailCurveLegacyAliases({
      left: fallbackLeft,
      right: fallbackRight,
      points,
      smoothing: sanitizeSmoothing(source.smoothing),
      independentSides: source.independentSides === true,
    });
  }

  function getTailCurvePoints(curve) {
    if (!curve || typeof curve !== 'object') {
      return defaultTailCurve().points;
    }
    if (Array.isArray(curve.points) && curve.points.length) {
      return curve.points;
    }
    const normalized = normalizeTailCurve(curve);
    curve.left = normalized.left;
    curve.right = normalized.right;
    curve.points = normalized.points;
    curve.smoothing = normalized.smoothing;
    curve.independentSides = normalized.independentSides;
    return curve.points;
  }

  function getEffectivePointSmoothing(curve, point) {
    const normalized = normalizeTailCurve(curve);
    if (
      point &&
      point.smoothing !== undefined &&
      point.smoothing !== null &&
      point.smoothing !== ''
    ) {
      return sanitizeSmoothing(point.smoothing, normalized.smoothing);
    }
    return normalized.smoothing;
  }

  function pointDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function safeInterval(value) {
    return value > 1e-4 ? value : 1e-4;
  }

  function clampControlDistance(control, anchor, maxDistance) {
    const dx = control.x - anchor.x;
    const dy = control.y - anchor.y;
    const distance = Math.hypot(dx, dy);
    if (!(distance > maxDistance) || !(distance > 1e-4)) return control;
    const scale = maxDistance / distance;
    return {
      x: anchor.x + dx * scale,
      y: anchor.y + dy * scale,
    };
  }

  function buildCentripetalSplineCommands(knots, smoothingValues) {
    if (!Array.isArray(knots) || knots.length < 2) return [];
    const commands = [];
    const values = Array.isArray(smoothingValues) ? smoothingValues : [];
    for (let index = 0; index < knots.length - 1; index += 1) {
      const p0 = knots[Math.max(0, index - 1)];
      const p1 = knots[index];
      const p2 = knots[index + 1];
      const p3 = knots[Math.min(knots.length - 1, index + 2)];
      const t0 = 0;
      const t1 = t0 + Math.sqrt(Math.max(pointDistance(p0, p1), 1e-4));
      const t2 = t1 + Math.sqrt(Math.max(pointDistance(p1, p2), 1e-4));
      const t3 = t2 + Math.sqrt(Math.max(pointDistance(p2, p3), 1e-4));
      const dt10 = safeInterval(t1 - t0);
      const dt20 = safeInterval(t2 - t0);
      const dt21 = safeInterval(t2 - t1);
      const dt31 = safeInterval(t3 - t1);
      const dt32 = safeInterval(t3 - t2);
      const segmentDt = dt21;
      const tangent1 = {
        x: (
          (p1.x - p0.x) / dt10 -
          (p2.x - p0.x) / dt20 +
          (p2.x - p1.x) / dt21
        ) * segmentDt,
        y: (
          (p1.y - p0.y) / dt10 -
          (p2.y - p0.y) / dt20 +
          (p2.y - p1.y) / dt21
        ) * segmentDt,
      };
      const tangent2 = {
        x: (
          (p2.x - p1.x) / dt21 -
          (p3.x - p1.x) / dt31 +
          (p3.x - p2.x) / dt32
        ) * segmentDt,
        y: (
          (p2.y - p1.y) / dt21 -
          (p3.y - p1.y) / dt31 +
          (p3.y - p2.y) / dt32
        ) * segmentDt,
      };
      const smooth1 = sanitizeSmoothing(values[index], DEFAULTS.smoothing) / 100;
      const smooth2 =
        sanitizeSmoothing(values[index + 1], DEFAULTS.smoothing) / 100;
      const segmentLength = Math.max(pointDistance(p1, p2), 1);
      const maxControlDistance = segmentLength * 0.75;
      const cp1 = clampControlDistance({
        x: p1.x + tangent1.x * smooth1 / 3,
        y: p1.y + tangent1.y * smooth1 / 3,
      }, p1, maxControlDistance);
      const cp2 = clampControlDistance({
        x: p2.x - tangent2.x * smooth2 / 3,
        y: p2.y - tangent2.y * smooth2 / 3,
      }, p2, maxControlDistance);
      commands.push({
        start: { x: p1.x, y: p1.y },
        cp1,
        cp2,
        end: { x: p2.x, y: p2.y },
      });
    }
    return commands;
  }

  function evaluateCubic(command, t) {
    if (!command) return null;
    const amount = clamp(t, 0, 1, 0);
    const u = 1 - amount;
    const uu = u * u;
    const tt = amount * amount;
    return {
      x:
        uu * u * command.start.x +
        3 * uu * amount * command.cp1.x +
        3 * u * tt * command.cp2.x +
        tt * amount * command.end.x,
      y:
        uu * u * command.start.y +
        3 * uu * amount * command.cp1.y +
        3 * u * tt * command.cp2.y +
        tt * amount * command.end.y,
    };
  }

  function reverseSplineCommands(commands) {
    if (!Array.isArray(commands)) return [];
    return commands.slice().reverse().map((command) => ({
      start: { ...command.end },
      cp1: { ...command.cp2 },
      cp2: { ...command.cp1 },
      end: { ...command.start },
    }));
  }

  function applyNormalizedTailCurve(target, normalized) {
    const destination = target && typeof target === 'object' ? target : {};
    const existingPoints = Array.isArray(destination.points)
      ? destination.points
      : [];
    const existingById = new Map();
    for (const point of existingPoints) {
      if (point && typeof point.id === 'string' && point.id) {
        existingById.set(point.id, point);
      }
    }

    destination.points = normalized.points.map((normalizedPoint) => {
      const point = existingById.get(normalizedPoint.id) || {};
      point.id = normalizedPoint.id;
      point.left = { ...normalizedPoint.left };
      point.right = { ...normalizedPoint.right };
      point.smoothing = normalizedPoint.smoothing;
      return point;
    });
    destination.left = { ...normalized.left };
    destination.right = { ...normalized.right };
    destination.smoothing = normalized.smoothing;
    destination.independentSides = normalized.independentSides;
    return destination;
  }

  function ensureTailCurve(tail) {
    const target = tail && typeof tail === 'object' ? tail : {};
    const current =
      target.curve && typeof target.curve === 'object'
        ? target.curve
        : null;
    const normalized = normalizeTailCurve(current);
    target.curve = current
      ? applyNormalizedTailCurve(current, normalized)
      : normalized;
    return target.curve;
  }

  function supportsTailCurvature(style) {
    const normalized = style || 'regular';
    return (
      normalized === 'regular' ||
      normalized === 'wavy' ||
      normalized === 'inset' ||
      normalized === 'connector'
    );
  }

  function bubbleSupportsTailCurvature(bubble) {
    if (!bubble || typeof bubble !== 'object') return false;
    if (bubble.isTextOnly) return false;
    const tail = bubble.tail;
    if (!tail || tail.enabled !== true) return false;
    const style = tail.style || 'regular';
    if (style === 'connector') return tail.connectorSolo === true;
    if (bubble.type === 'arrow') return false;
    if (
      bubble.type === 'thought' ||
      bubble.type === 'thought2' ||
      bubble.type === 'thought3' ||
      bubble.type === 'thought4'
    )
      return false;
    return supportsTailCurvature(style);
  }

  return {
    DEFAULTS,
    toFiniteNumber,
    clamp,
    defaultTailCurve,
    sanitizeTailCurveEntry,
    clampTailCurveEntry,
    sanitizeSmoothing,
    createTailCurvePoint,
    syncTailCurveLegacyAliases,
    normalizeTailCurve,
    normalizePointPositions,
    getTailCurvePoints,
    getEffectivePointSmoothing,
    buildCentripetalSplineCommands,
    evaluateCubic,
    reverseSplineCommands,
    applyNormalizedTailCurve,
    ensureTailCurve,
    supportsTailCurvature,
    bubbleSupportsTailCurvature,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = tailCurveHelpers;
} else {
  const root = typeof self !== 'undefined' ? self : window;
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.tails = root.SoapyPanels.tails || {};
  root.SoapyPanels.tails.curve = tailCurveHelpers;
}
