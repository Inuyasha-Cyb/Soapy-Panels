(function (root, factory) {
  var api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.bubbles = root.SoapyPanels.bubbles || {};
  root.SoapyPanels.bubbles.savedStyles = api;
})(typeof self !== "undefined" ? self : this, function () {
  var ACTIVE_TAIL_INDEX_FIELD = "savedStyleActiveTailIndex";
  var BUBBLE_INSTANCE_FIELDS = {
    id: true,
    x: true,
    y: true,
    tail: true,
    tails: true,
    activeTailId: true,
    mergedWith: true,
    mergeStyle: true,
    eraseMask: true,
    paintMask: true,
    renderAboveStickers: true,
    extraTailAutoTargetId: true,
    extraTailAutoColorSourceId: true,
    extraTailAutoFollowSourceStyle: true,
    extraTailAutoLastStyleSig: true,
    textHighlightSelectionPending: true,
  };

  function deepClone(value) {
    if (value == null || typeof value !== "object") return value;
    return JSON.parse(JSON.stringify(value));
  }

  function stripRuntimeFields(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex++) {
        stripRuntimeFields(value[arrayIndex]);
      }
      return value;
    }
    Object.keys(value).forEach(function (key) {
      if (key.charAt(0) === "_") {
        delete value[key];
        return;
      }
      stripRuntimeFields(value[key]);
    });
    return value;
  }

  function sanitizeTail(tail, options) {
    var target = stripRuntimeFields(deepClone(tail || {}));
    delete target.id;
    target.endTargetId = null;
    target.endAx = null;
    target.endAy = null;
    target.connectorSolo = target.style === "connector";

    if (target.curve && Array.isArray(target.curve.points)) {
      target.curve.points.forEach(function (point, index) {
        if (!point || typeof point !== "object") return;
        if (options && typeof options.createCurvePointId === "function") {
          point.id = options.createCurvePointId(index, point);
        } else {
          delete point.id;
        }
      });
    }
    return target;
  }

  function getRawTailEntries(source) {
    var entries = [];

    function pushTail(tail) {
      if (!tail || typeof tail !== "object") return;
      var tailId = typeof tail.id === "string" && tail.id ? tail.id : null;
      for (var index = 0; index < entries.length; index++) {
        if (
          entries[index].tail === tail ||
          (tailId && entries[index].id === tailId)
        ) {
          return;
        }
      }
      entries.push({ tail: tail, id: tailId });
    }

    if (source && Array.isArray(source.tails)) {
      source.tails.forEach(pushTail);
    }
    if (source && source.tail) {
      var directTailId =
        typeof source.tail.id === "string" && source.tail.id
          ? source.tail.id
          : null;
      var directTailSignature = JSON.stringify(sanitizeTail(source.tail));
      var hasMirroredDirectTail = entries.some(function (entry) {
        if (entry.tail === source.tail) return true;
        if (directTailId && entry.id === directTailId) return true;
        return (
          !directTailId &&
          JSON.stringify(sanitizeTail(entry.tail)) === directTailSignature
        );
      });
      if (!hasMirroredDirectTail) pushTail(source.tail);
    }
    return entries;
  }

  function resolveActiveRawTailIndex(source, entries) {
    if (!entries.length) return 0;
    var savedIndex = Number(source && source[ACTIVE_TAIL_INDEX_FIELD]);
    if (Number.isFinite(savedIndex)) {
      return Math.max(0, Math.min(entries.length - 1, Math.floor(savedIndex)));
    }

    var activeId =
      source && typeof source.activeTailId === "string"
        ? source.activeTailId
        : source &&
            source.tail &&
            typeof source.tail.id === "string"
          ? source.tail.id
          : null;
    if (activeId) {
      for (var idIndex = 0; idIndex < entries.length; idIndex++) {
        if (entries[idIndex].id === activeId) return idIndex;
      }
    }
    if (source && source.tail) {
      for (var refIndex = 0; refIndex < entries.length; refIndex++) {
        if (entries[refIndex].tail === source.tail) return refIndex;
      }
      var directTailSignature = JSON.stringify(sanitizeTail(source.tail));
      for (var signatureIndex = 0; signatureIndex < entries.length; signatureIndex++) {
        if (
          JSON.stringify(sanitizeTail(entries[signatureIndex].tail)) ===
          directTailSignature
        ) {
          return signatureIndex;
        }
      }
    }
    return 0;
  }

  function buildSanitizedTailCollection(source, options) {
    var rawEntries = getRawTailEntries(source);
    if (!rawEntries.length) rawEntries.push({ tail: {}, id: null });
    var activeRawIndex = resolveActiveRawTailIndex(source, rawEntries);
    var sanitized = rawEntries.map(function (entry) {
      return sanitizeTail(entry.tail, options);
    });

    return {
      tails: sanitized,
      activeIndex: activeRawIndex || 0,
    };
  }

  function createSavedStyleSnapshot(bubble) {
    var source = bubble && typeof bubble === "object" ? bubble : {};
    var snapshot = stripRuntimeFields(deepClone(source));
    Object.keys(BUBBLE_INSTANCE_FIELDS).forEach(function (field) {
      delete snapshot[field];
    });

    var collection = buildSanitizedTailCollection(source);
    snapshot.tails = collection.tails;
    snapshot.tail = deepClone(
      collection.tails[collection.activeIndex] || collection.tails[0] || {},
    );
    snapshot[ACTIVE_TAIL_INDEX_FIELD] = collection.activeIndex;
    return snapshot;
  }

  function mergeStyleProperties(target, source) {
    if (!target || !source) return target;
    Object.keys(source).forEach(function (key) {
      if (
        BUBBLE_INSTANCE_FIELDS[key] ||
        key === ACTIVE_TAIL_INDEX_FIELD ||
        key.charAt(0) === "_"
      ) {
        return;
      }
      var value = source[key];
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        target[key] &&
        typeof target[key] === "object" &&
        !Array.isArray(target[key])
      ) {
        mergeStyleProperties(target[key], value);
      } else {
        target[key] = deepClone(value);
      }
    });
    return target;
  }

  function applySavedStyleToBubble(baseBubble, template, options) {
    if (!baseBubble || typeof baseBubble !== "object") return baseBubble;
    var opts = options || {};
    var nextUid =
      typeof opts.uid === "function"
        ? opts.uid
        : function () {
            return Math.random().toString(36).slice(2);
          };
    var source = template && typeof template === "object" ? template : {};
    var styleSnapshot = createSavedStyleSnapshot(source);
    mergeStyleProperties(baseBubble, styleSnapshot);

    var collection = buildSanitizedTailCollection(source);
    baseBubble.tails = collection.tails.map(function (tail) {
      var nextTail = deepClone(tail);
      nextTail.id =
        typeof opts.createBubbleTailId === "function"
          ? opts.createBubbleTailId()
          : "tail-" + nextUid();
      if (nextTail.curve && Array.isArray(nextTail.curve.points)) {
        nextTail.curve.points.forEach(function (point) {
          if (point && typeof point === "object") {
            point.id = "curve-point-" + nextUid();
          }
        });
      }
      return nextTail;
    });
    baseBubble.tail =
      baseBubble.tails[collection.activeIndex] || baseBubble.tails[0] || null;
    baseBubble.activeTailId =
      baseBubble.tail && baseBubble.tail.id ? baseBubble.tail.id : null;
    baseBubble.mergedWith = [];
    baseBubble.mergeStyle = "legacy";
    baseBubble.eraseMask = { strokes: [] };
    delete baseBubble.paintMask;
    delete baseBubble.extraTailAutoTargetId;
    delete baseBubble.extraTailAutoColorSourceId;
    delete baseBubble.extraTailAutoFollowSourceStyle;
    delete baseBubble.extraTailAutoLastStyleSig;
    baseBubble.textHighlightSelectionPending = false;
    return baseBubble;
  }

  return {
    ACTIVE_TAIL_INDEX_FIELD: ACTIVE_TAIL_INDEX_FIELD,
    createSavedStyleSnapshot: createSavedStyleSnapshot,
    applySavedStyleToBubble: applySavedStyleToBubble,
  };
});
