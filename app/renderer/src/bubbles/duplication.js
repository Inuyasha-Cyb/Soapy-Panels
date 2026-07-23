(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.bubbleDuplication = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function idsEqualLoose(a, b) {
    if (a == null || b == null) return false;
    return String(a) === String(b);
  }

  function isExtraTailBubble(bubble) {
    return !!(bubble && (bubble.tailOnly === true || bubble.type === "soloTail"));
  }

  function getBubbleById(bubbles, id) {
    if (id == null || !Array.isArray(bubbles)) return null;
    for (var i = 0; i < bubbles.length; i++) {
      var candidate = bubbles[i];
      if (candidate && idsEqualLoose(candidate.id, id)) return candidate;
    }
    return null;
  }

  function getExtraTailAttachmentTargetId(extraTailBubble) {
    if (!isExtraTailBubble(extraTailBubble)) return null;
    if (
      extraTailBubble.extraTailAutoTargetId != null &&
      extraTailBubble.extraTailAutoTargetId !== ""
    ) {
      return String(extraTailBubble.extraTailAutoTargetId);
    }
    if (Array.isArray(extraTailBubble.mergedWith)) {
      for (var i = 0; i < extraTailBubble.mergedWith.length; i++) {
        var mergedId = extraTailBubble.mergedWith[i];
        if (mergedId != null && mergedId !== "") return String(mergedId);
      }
    }
    return null;
  }

  function getExtraTailLinksForBubble(bubbles, targetBubble) {
    if (!targetBubble || targetBubble.id == null || !Array.isArray(bubbles)) return [];
    var matches = [];
    for (var i = 0; i < bubbles.length; i++) {
      var candidate = bubbles[i];
      if (!isExtraTailBubble(candidate)) continue;
      if (idsEqualLoose(candidate.id, targetBubble.id)) continue;
      var targetsBubble =
        idsEqualLoose(candidate.extraTailAutoTargetId, targetBubble.id) ||
        (Array.isArray(candidate.mergedWith) &&
          candidate.mergedWith.some(function (mergedId) {
            return idsEqualLoose(mergedId, targetBubble.id);
          }));
      if (targetsBubble) matches.push(candidate);
    }
    return matches;
  }

  function collectDuplicateComponentBubbles(bubbles, selectedBubble) {
    if (!Array.isArray(bubbles) || !selectedBubble || selectedBubble.id == null) {
      return selectedBubble ? [selectedBubble] : [];
    }

    var queue = [selectedBubble];
    var selectedById = Object.create(null);

    while (queue.length) {
      var current = queue.shift();
      if (!current || current.id == null) continue;
      var currentKey = String(current.id);
      if (selectedById[currentKey]) continue;
      selectedById[currentKey] = true;

      if (Array.isArray(current.mergedWith)) {
        for (var i = 0; i < current.mergedWith.length; i++) {
          var mergedBubble = getBubbleById(bubbles, current.mergedWith[i]);
          if (mergedBubble) queue.push(mergedBubble);
        }
      }

      for (var j = 0; j < bubbles.length; j++) {
        var candidate = bubbles[j];
        if (!candidate || candidate.id == null) continue;
        if (idsEqualLoose(candidate.id, current.id)) continue;
        if (
          Array.isArray(candidate.mergedWith) &&
          candidate.mergedWith.some(function (mergedId) {
            return idsEqualLoose(mergedId, current.id);
          })
        ) {
          queue.push(candidate);
        }
      }

      if (isExtraTailBubble(current)) {
        var attachmentId = getExtraTailAttachmentTargetId(current);
        var attachmentTarget = getBubbleById(bubbles, attachmentId);
        if (attachmentTarget) queue.push(attachmentTarget);
      } else {
        var linkedExtraTails = getExtraTailLinksForBubble(bubbles, current);
        for (var k = 0; k < linkedExtraTails.length; k++) {
          queue.push(linkedExtraTails[k]);
        }
      }
    }

    var ordered = [];
    for (var index = 0; index < bubbles.length; index++) {
      var bubble = bubbles[index];
      if (!bubble || bubble.id == null) continue;
      if (selectedById[String(bubble.id)]) ordered.push(bubble);
    }
    return ordered.length ? ordered : [selectedBubble];
  }

  function getBubbleTailList(bubble) {
    if (!bubble) return [];
    var tails = Array.isArray(bubble.tails) ? bubble.tails.slice() : [];
    if (bubble.tail && tails.indexOf(bubble.tail) < 0) tails.push(bubble.tail);
    return tails;
  }

  function getSoloConnectorTargetIds(bubble) {
    if (!bubble) return [];
    return getBubbleTailList(bubble)
      .filter(function (tail) {
        return !!(
          tail &&
          tail.enabled !== false &&
          tail.style === "connector" &&
          tail.connectorSolo === true &&
          tail.endTargetId != null &&
          tail.endTargetId !== ""
        );
      })
      .map(function (tail) {
        return String(tail.endTargetId);
      });
  }

  function collectDuplicateReferenceBubbles(bubbles, selectedBubble) {
    var initial = collectDuplicateComponentBubbles(bubbles, selectedBubble);
    if (!Array.isArray(bubbles) || !initial.length) return initial;

    var selectedById = Object.create(null);
    var queue = initial.slice();
    while (queue.length) {
      var current = queue.shift();
      if (!current || current.id == null) continue;
      var currentKey = String(current.id);
      if (selectedById[currentKey]) continue;
      selectedById[currentKey] = true;

      var linkedMovementMembers = collectDuplicateComponentBubbles(bubbles, current);
      for (var movementIndex = 0;
        movementIndex < linkedMovementMembers.length;
        movementIndex++
      ) {
        var movementMember = linkedMovementMembers[movementIndex];
        if (
          movementMember &&
          movementMember.id != null &&
          !selectedById[String(movementMember.id)]
        ) {
          queue.push(movementMember);
        }
      }

      var targetIds = getSoloConnectorTargetIds(current);
      for (var targetIndex = 0; targetIndex < targetIds.length; targetIndex++) {
        var target = getBubbleById(bubbles, targetIds[targetIndex]);
        if (target && !selectedById[String(target.id)]) queue.push(target);
      }

      for (var sourceIndex = 0; sourceIndex < bubbles.length; sourceIndex++) {
        var source = bubbles[sourceIndex];
        if (!source || source.id == null || selectedById[String(source.id)]) continue;
        if (getSoloConnectorTargetIds(source).indexOf(currentKey) >= 0) {
          queue.push(source);
        }
      }
    }

    return bubbles.filter(function (bubble) {
      return !!(
        bubble &&
        bubble.id != null &&
        selectedById[String(bubble.id)]
      );
    });
  }

  function translateBubbleComponent(bubbles, selectedBubble, dx, dy) {
    var members = collectDuplicateComponentBubbles(bubbles, selectedBubble);
    var offsetX = typeof dx === "number" && isFinite(dx) ? dx : 0;
    var offsetY = typeof dy === "number" && isFinite(dy) ? dy : 0;

    for (var i = 0; i < members.length; i++) {
      var bubble = members[i];
      if (!bubble) continue;
      if (typeof bubble.x === "number" && isFinite(bubble.x)) bubble.x += offsetX;
      if (typeof bubble.y === "number" && isFinite(bubble.y)) bubble.y += offsetY;
    }

    return members;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function remapBubbleReference(id, bubbleIdMap) {
    if (id == null || !bubbleIdMap) return null;
    var key = String(id);
    return Object.prototype.hasOwnProperty.call(bubbleIdMap, key) ? bubbleIdMap[key] : null;
  }

  function hasVisibleBubbleText(bubble) {
    if (!bubble || isExtraTailBubble(bubble)) return false;
    var text = typeof bubble.text === "string" ? bubble.text.trim() : "";
    if (!text) return false;
    var textOpacity =
      typeof bubble.textA === "number" && isFinite(bubble.textA) ? bubble.textA : 1;
    return textOpacity > 0;
  }

  function getDuplicateSelectionScore(bubble, isOriginallySelected) {
    if (!bubble) return -Infinity;

    var score = 0;
    if (!isExtraTailBubble(bubble)) score += 100;
    if (hasVisibleBubbleText(bubble)) {
      var textLength = typeof bubble.text === "string" ? bubble.text.trim().length : 0;
      score += 1000 + Math.min(textLength, 100);
    }
    if (bubble.isTextOnly === true) score += 25;
    if (isOriginallySelected) score += 1;
    return score;
  }

  function chooseDuplicateSelectedId(sourceBubbles, clones, selectedBubble) {
    if (!Array.isArray(sourceBubbles) || !Array.isArray(clones) || !clones.length) return null;

    var selectedSourceIndex = -1;
    for (var i = 0; i < sourceBubbles.length; i++) {
      if (idsEqualLoose(sourceBubbles[i] && sourceBubbles[i].id, selectedBubble && selectedBubble.id)) {
        selectedSourceIndex = i;
        break;
      }
    }

    if (selectedSourceIndex < 0) {
      return clones[0] && clones[0].id ? clones[0].id : null;
    }

    var selectedSource = sourceBubbles[selectedSourceIndex];
    var selectedClone = clones[selectedSourceIndex];

    if (!selectedSource) {
      return selectedClone && selectedClone.id ? selectedClone.id : null;
    }

    var selectedHasVisibleText = hasVisibleBubbleText(selectedSource);
    var selectedIsExtraTail = isExtraTailBubble(selectedSource);

    if (!selectedIsExtraTail && selectedHasVisibleText) {
      return selectedClone && selectedClone.id ? selectedClone.id : null;
    }

    var bestIndex = selectedSourceIndex;
    var bestScore = getDuplicateSelectionScore(selectedSource, true);

    for (var candidateIndex = 0; candidateIndex < sourceBubbles.length; candidateIndex++) {
      if (candidateIndex === selectedSourceIndex) continue;
      var candidateScore = getDuplicateSelectionScore(sourceBubbles[candidateIndex], false);
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestIndex = candidateIndex;
      }
    }

    var bestClone = clones[bestIndex];
    return bestClone && bestClone.id ? bestClone.id : selectedClone && selectedClone.id ? selectedClone.id : null;
  }

  function createTailSourceEntries(clone) {
    var entries = [];
    var seenKeys = Object.create(null);
    var nextAnonymousTailIndex = 0;

    function pushTail(tail) {
      if (!tail || typeof tail !== "object") return;
      var key =
        typeof tail.id === "string" && tail.id
          ? tail.id
          : "__tail_" + nextAnonymousTailIndex++;
      if (seenKeys[key]) return;
      seenKeys[key] = true;
      entries.push({ key: key, tail: tail });
    }

    if (Array.isArray(clone.tails) && clone.tails.length) {
      for (var i = 0; i < clone.tails.length; i++) pushTail(clone.tails[i]);
    }
    if (clone.tail && typeof clone.tail === "object") pushTail(clone.tail);
    if (!entries.length) pushTail({});
    return entries;
  }

  function cloneBubbleForDuplicate(sourceBubble, bubbleIdMap, options) {
    var clone = deepClone(sourceBubble);
    var offsetX =
      typeof options.offsetX === "number" && isFinite(options.offsetX) ? options.offsetX : 20;
    var offsetY =
      typeof options.offsetY === "number" && isFinite(options.offsetY) ? options.offsetY : 20;
    var sourceIdKey = sourceBubble && sourceBubble.id != null ? String(sourceBubble.id) : null;
    if (sourceIdKey && Object.prototype.hasOwnProperty.call(bubbleIdMap, sourceIdKey)) {
      clone.id = bubbleIdMap[sourceIdKey];
    }

    if (typeof clone.x === "number" && isFinite(clone.x)) clone.x += offsetX;
    if (typeof clone.y === "number" && isFinite(clone.y)) clone.y += offsetY;

    clone.mergedWith = Array.isArray(clone.mergedWith)
      ? clone.mergedWith
          .map(function (id) {
            return remapBubbleReference(id, bubbleIdMap);
          })
          .filter(function (id) {
            return id != null;
          })
      : [];

    if (clone.extraTailAutoTargetId != null) {
      clone.extraTailAutoTargetId = remapBubbleReference(clone.extraTailAutoTargetId, bubbleIdMap);
    }
    if (clone.extraTailAutoColorSourceId != null) {
      clone.extraTailAutoColorSourceId = remapBubbleReference(
        clone.extraTailAutoColorSourceId,
        bubbleIdMap,
      );
    }

    var tailSources = createTailSourceEntries(clone);
    var activeTailKey =
      typeof clone.activeTailId === "string" && clone.activeTailId
        ? clone.activeTailId
        : clone.tail && typeof clone.tail.id === "string" && clone.tail.id
          ? clone.tail.id
          : tailSources[0].key;
    var activeTailIndex = 0;
    for (var i = 0; i < tailSources.length; i++) {
      if (tailSources[i].key === activeTailKey) {
        activeTailIndex = i;
        break;
      }
    }

    var nextCreateBubbleTailId =
      typeof options.createBubbleTailId === "function"
        ? options.createBubbleTailId
        : function () {
            return "tail-" + options.uid();
          };

    clone.tails = tailSources.map(function (entry, index) {
      var tailClone = deepClone(entry.tail);
      tailClone.id = nextCreateBubbleTailId();
      if (index === activeTailIndex) activeTailIndex = index;
      if (tailClone.endTargetId != null) {
        var remappedTargetId = remapBubbleReference(tailClone.endTargetId, bubbleIdMap);
        if (remappedTargetId) tailClone.endTargetId = remappedTargetId;
      }
      return tailClone;
    });

    clone.tail = clone.tails[activeTailIndex] || clone.tails[0] || null;
    clone.activeTailId = clone.tail && clone.tail.id ? clone.tail.id : null;

    if (typeof options.ensureTextStyles === "function") options.ensureTextStyles(clone);
    if (typeof options.ensureTailLocal === "function") options.ensureTailLocal(clone);

    return clone;
  }

  function duplicateBubbleGraph(bubbles, selectedBubble, options) {
    var opts = options || {};
    if (!Array.isArray(bubbles) || !selectedBubble || typeof opts.uid !== "function") {
      return { clones: [], selectedId: null };
    }

    var sourceBubbles = collectDuplicateReferenceBubbles(bubbles, selectedBubble);
    var bubbleIdMap = Object.create(null);
    for (var i = 0; i < sourceBubbles.length; i++) {
      var sourceBubble = sourceBubbles[i];
      if (!sourceBubble || sourceBubble.id == null) continue;
      bubbleIdMap[String(sourceBubble.id)] = opts.uid();
    }

    var clones = [];
    for (var j = 0; j < sourceBubbles.length; j++) {
      clones.push(cloneBubbleForDuplicate(sourceBubbles[j], bubbleIdMap, opts));
    }

    var selectedId = chooseDuplicateSelectedId(sourceBubbles, clones, selectedBubble);

    return {
      clones: clones,
      selectedId: selectedId || (clones[0] && clones[0].id) || null,
      sourceBubbles: sourceBubbles,
    };
  }

  function findBubbleByIdLoose(bubbles, id) {
    if (!Array.isArray(bubbles) || id == null) return null;
    for (var i = 0; i < bubbles.length; i++) {
      if (idsEqualLoose(bubbles[i] && bubbles[i].id, id)) return bubbles[i];
    }
    return null;
  }

  function createClipboardBubblePayload(bubbles, selectedBubble) {
    if (!selectedBubble) return null;
    return {
      kind: "bubble-component",
      selectedId: selectedBubble.id != null ? selectedBubble.id : null,
      bubbles: deepClone(collectDuplicateReferenceBubbles(bubbles, selectedBubble)),
    };
  }

  function duplicateClipboardPayload(clipboardPayload, options) {
    if (!clipboardPayload) return { clones: [], selectedId: null, sourceBubbles: [] };

    var sourceBubbles = null;
    var selectedBubble = null;

    if (Array.isArray(clipboardPayload.bubbles) && clipboardPayload.bubbles.length) {
      sourceBubbles = deepClone(clipboardPayload.bubbles);
      selectedBubble =
        findBubbleByIdLoose(sourceBubbles, clipboardPayload.selectedId) || sourceBubbles[0];
    } else if (clipboardPayload.id != null) {
      sourceBubbles = [deepClone(clipboardPayload)];
      selectedBubble = sourceBubbles[0];
    }

    if (!Array.isArray(sourceBubbles) || !sourceBubbles.length || !selectedBubble) {
      return { clones: [], selectedId: null, sourceBubbles: [] };
    }

    return duplicateBubbleGraph(sourceBubbles, selectedBubble, options);
  }

  return {
    collectDuplicateComponentBubbles: collectDuplicateComponentBubbles,
    collectDuplicateReferenceBubbles: collectDuplicateReferenceBubbles,
    translateBubbleComponent: translateBubbleComponent,
    duplicateBubbleGraph: duplicateBubbleGraph,
    createClipboardBubblePayload: createClipboardBubblePayload,
    duplicateClipboardPayload: duplicateClipboardPayload,
    _private: {
      idsEqualLoose: idsEqualLoose,
      isExtraTailBubble: isExtraTailBubble,
      getBubbleById: getBubbleById,
      getExtraTailAttachmentTargetId: getExtraTailAttachmentTargetId,
      getExtraTailLinksForBubble: getExtraTailLinksForBubble,
      getSoloConnectorTargetIds: getSoloConnectorTargetIds,
      collectDuplicateReferenceBubbles: collectDuplicateReferenceBubbles,
      translateBubbleComponent: translateBubbleComponent,
      hasVisibleBubbleText: hasVisibleBubbleText,
      chooseDuplicateSelectedId: chooseDuplicateSelectedId,
      cloneBubbleForDuplicate: cloneBubbleForDuplicate,
      findBubbleByIdLoose: findBubbleByIdLoose,
    },
  };
});
