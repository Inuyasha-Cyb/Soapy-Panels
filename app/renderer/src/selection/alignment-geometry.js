(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SoapyPanels.selection = root.SoapyPanels.selection || {};
    root.SoapyPanels.selection.alignmentGeometry = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const compareId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const valid = (b) =>
    b && [b.l, b.t, b.r, b.b].every(Number.isFinite) && b.r > b.l && b.b > b.t;
  function bodyBounds(bubble) {
    if (!bubble || bubble.tailOnly === true || bubble.type === 'soloTail')
      return null;
    const { x, y, w, h } = bubble;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    const radians =
      ((Number.isFinite(bubble.rot) ? bubble.rot : 0) * Math.PI) / 180;
    const width =
      Math.abs(Math.cos(radians)) * w + Math.abs(Math.sin(radians)) * h;
    const height =
      Math.abs(Math.sin(radians)) * w + Math.abs(Math.cos(radians)) * h;
    return {
      l: x + w / 2 - width / 2,
      r: x + w / 2 + width / 2,
      t: y + h / 2 - height / 2,
      b: y + h / 2 + height / 2,
    };
  }
  function union(bounds) {
    const list = bounds.filter(valid);
    if (!list.length) return null;
    return list.reduce((a, b) => ({
      l: Math.min(a.l, b.l),
      t: Math.min(a.t, b.t),
      r: Math.max(a.r, b.r),
      b: Math.max(a.b, b.b),
    }));
  }
  function translate(b, dx, dy) {
    return { l: b.l + dx, r: b.r + dx, t: b.t + dy, b: b.b + dy };
  }
  const start = (b, axis) => (axis === 'x' ? b.l : b.t);
  const end = (b, axis) => (axis === 'x' ? b.r : b.b);
  const anchors = (b, axis) => [
    start(b, axis),
    (start(b, axis) + end(b, axis)) / 2,
    end(b, axis),
  ];
  const overlaps = (a, b, axis) =>
    Math.min(end(a, axis), end(b, axis)) >
    Math.max(start(a, axis), start(b, axis));

  function prepareTargets(bubbles, movingIds, canvas) {
    const byId = new Map(
      bubbles.filter((b) => b && b.id != null).map((b) => [String(b.id), b]),
    );
    const parent = new Map([...byId.keys()].map((id) => [id, id]));
    function find(id) {
      let node = id;
      while (parent.get(node) !== node) node = parent.get(node);
      while (parent.get(id) !== id) {
        const next = parent.get(id);
        parent.set(id, node);
        id = next;
      }
      return node;
    }
    function join(a, b) {
      if (byId.has(b)) parent.set(find(a), find(b));
    }
    for (const [id, b] of byId) {
      for (const linked of Array.isArray(b.mergedWith) ? b.mergedWith : [])
        join(id, String(linked));
      if (
        (b.tailOnly === true || b.type === 'soloTail') &&
        b.extraTailAutoTargetId != null
      )
        join(id, String(b.extraTailAutoTargetId));
    }
    const groups = new Map();
    for (const [id, b] of byId) {
      const key = find(id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id, bounds: bodyBounds(b) });
    }
    const moving = new Set(movingIds.map(String));
    const targets = [];
    for (const members of groups.values()) {
      if (members.some((member) => moving.has(member.id))) continue;
      const bounds = union(members.map((member) => member.bounds));
      if (bounds)
        targets.push({
          id: members.map((member) => member.id).sort(compareId)[0],
          bounds,
        });
    }
    const canvasBounds =
      canvas && canvas.w > 0 && canvas.h > 0
        ? { l: 0, t: 0, r: canvas.w, b: canvas.h }
        : null;
    const sorted = {};
    const lines = {};
    for (const axis of ['x', 'y']) {
      sorted[axis] = targets
        .slice()
        .sort(
          (a, b) =>
            start(a.bounds, axis) - start(b.bounds, axis) ||
            compareId(a.id, b.id),
        );
      lines[axis] = [];
      for (const target of targets.concat(
        canvasBounds
          ? [{ id: '@canvas', bounds: canvasBounds, canvas: true }]
          : [],
      )) {
        anchors(target.bounds, axis).forEach((value, anchor) => {
          lines[axis].push({
            value,
            anchor,
            target,
            priority: target.canvas
              ? anchor === 1
                ? 0
                : 1
              : anchor === 1
                ? 2
                : 3,
          });
        });
      }
      lines[axis].sort(
        (a, b) =>
          a.value - b.value ||
          a.priority - b.priority ||
          compareId(a.target.id, b.target.id),
      );
    }
    return {
      movingBounds: union([...moving].map((id) => bodyBounds(byId.get(id)))),
      targets,
      sorted,
      lines,
    };
  }

  function resolve({
    movingBounds,
    translation,
    prepared,
    scale = {},
    previous = {},
    snap = true,
    bypass = false,
  }) {
    const dx = Number.isFinite(translation.dx) ? translation.dx : 0;
    const dy = Number.isFinite(translation.dy) ? translation.dy : 0;
    if (!valid(movingBounds))
      return { translation: { dx, dy }, guides: [], state: {}, evaluations: 0 };
    const raw = translate(movingBounds, dx, dy);
    const selected = {};
    let evaluations = 0;
    for (const axis of ['x', 'y']) {
      const factor =
        Number.isFinite(scale[axis === 'x' ? 'sx' : 'sy']) &&
        scale[axis === 'x' ? 'sx' : 'sy'] > 0
          ? scale[axis === 'x' ? 'sx' : 'sy']
          : 1;
      const enter = 6 / factor,
        release = 9 / factor;
      let nearest = null,
        held = null;
      function consider(candidate) {
        evaluations++;
        const distance = Math.abs(candidate.correction);
        if (previous[axis] === candidate.key && distance <= release + 1e-9)
          held = candidate;
        if (distance > enter + 1e-9) return;
        if (
          !nearest ||
          distance < Math.abs(nearest.correction) - 1e-9 ||
          (Math.abs(distance - Math.abs(nearest.correction)) <= 1e-9 &&
            (candidate.priority < nearest.priority ||
              (candidate.priority === nearest.priority &&
                compareId(candidate.key, nearest.key) < 0)))
        )
          nearest = candidate;
      }
      // Binary-search each moving anchor; only nearby static anchors are candidates.
      anchors(raw, axis).forEach((value, movingAnchor) => {
        const list = prepared.lines[axis];
        let low = 0,
          high = list.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (list[mid].value < value - release) low = mid + 1;
          else high = mid;
        }
        for (
          let i = low;
          i < list.length && list[i].value <= value + release;
          i++
        ) {
          const line = list[i];
          consider({
            key: `${axis}:align:${line.target.id}:${line.anchor}:${movingAnchor}`,
            priority: line.priority,
            correction: line.value - value,
            kind: 'alignment',
            axis,
            coordinate: line.value,
            target: line.target.bounds,
          });
        }
      });
      const other = axis === 'x' ? 'y' : 'x';
      const row = prepared.sorted[axis].filter((target) =>
        overlaps(target.bounds, raw, other),
      );
      const size = end(raw, axis) - start(raw, axis);
      const prefixEnd = [];
      for (let i = 0; i < row.length; i++)
        prefixEnd[i] = Math.max(
          i ? prefixEnd[i - 1] : -Infinity,
          end(row[i].bounds, axis),
        );
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i],
          b = row[i + 1];
        const gap = start(b.bounds, axis) - end(a.bounds, axis);
        evaluations++;
        if (gap < 0) continue;
        function spacing(kind, position, value) {
          consider({
            key: `${axis}:spacing:${a.id}:${b.id}:${kind}`,
            priority: 4,
            kind: 'spacing',
            axis,
            correction: position - start(raw, axis),
            gap: value,
            placement: kind,
            neighbors: [a.bounds, b.bounds],
          });
        }
        const middle = end(a.bounds, axis) + (gap - size) / 2;
        if (gap >= size && prefixEnd[i] <= middle)
          spacing('between', middle, (gap - size) / 2);
        const before = start(a.bounds, axis) - gap - size;
        if (i === 0 || prefixEnd[i - 1] <= before)
          spacing('before', before, gap);
        const after = end(b.bounds, axis) + gap;
        if (
          prefixEnd[i + 1] <= after &&
          (i + 2 === row.length ||
            after + size <= start(row[i + 2].bounds, axis))
        )
          spacing('after', after, gap);
      }
      selected[axis] = held || nearest;
    }
    const preview = translate(
      raw,
      selected.x ? selected.x.correction : 0,
      selected.y ? selected.y.correction : 0,
    );
    const guides = Object.values(selected)
      .filter(Boolean)
      .map((candidate) => ({ ...candidate, moving: preview }));
    return {
      translation:
        snap && !bypass
          ? {
              dx: dx + (selected.x ? selected.x.correction : 0),
              dy: dy + (selected.y ? selected.y.correction : 0),
            }
          : { dx, dy },
      guides,
      state: {
        x: selected.x && selected.x.key,
        y: selected.y && selected.y.key,
      },
      evaluations,
    };
  }
  return { bodyBounds, union, prepareTargets, resolve };
});
