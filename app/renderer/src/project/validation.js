(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.project = root.SoapyPanels.project || {};
  root.SoapyPanels.project.validation = api;
})(
  typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : globalThis,
  function () {
  const PROJECT_RESOURCE_LIMITS = Object.freeze({
    maxFileBytes: 256 * 1024 * 1024,
    maxCanvasDimension: 16384,
    maxBubbles: 2000,
    maxBackgroundImages: 1000,
    maxSavedStyles: 1000,
    maxTailsPerBubble: 64,
    maxDepth: 64,
    maxMaskStrokes: 100000,
    maxPoints: 1000000,
    maxBubbleTextCharacters: 1024 * 1024,
    maxCollectionEntries: 1500000,
  });

  const PROJECT_VALIDATION_CODES = Object.freeze({
    TOO_LARGE: "PROJECT_TOO_LARGE",
    TOO_COMPLEX: "PROJECT_TOO_COMPLEX",
    UNSAFE_CANVAS: "PROJECT_UNSAFE_CANVAS",
    MALFORMED: "PROJECT_MALFORMED",
  });

  function projectValidationError(code, message) {
    const error = new Error(message);
    error.name = "ProjectValidationError";
    error.code = code;
    return error;
  }

  function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.MALFORMED,
        `${label} must be an object.`,
      );
    }
  }

  function requireArrayWithin(value, maximum, label) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.MALFORMED,
        `${label} must be an array.`,
      );
    }
    if (value.length > maximum) {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.TOO_COMPLEX,
        `${label} exceeds the supported limit.`,
      );
    }
    return value;
  }

  function validateProjectFileBeforeRead(file, limits = PROJECT_RESOURCE_LIMITS) {
    const size = file && typeof file.size === "number" ? file.size : null;
    if (size !== null && (!Number.isFinite(size) || size < 0)) {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.MALFORMED,
        "Project file size is invalid.",
      );
    }
    if (size !== null && size > limits.maxFileBytes) {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.TOO_LARGE,
        "Project file exceeds the supported size limit.",
      );
    }
    return true;
  }

  function validateCanvas(bg, limits) {
    for (const field of ["w", "h"]) {
      const value = bg[field];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > limits.maxCanvasDimension
      ) {
        throw projectValidationError(
          PROJECT_VALIDATION_CODES.UNSAFE_CANVAS,
          "Project canvas dimensions are outside the supported range.",
        );
      }
    }
  }

  function validateProjectData(data, limits = PROJECT_RESOURCE_LIMITS) {
    requireObject(data, "Project root");
    requireObject(data.bg, "Project background");
    validateCanvas(data.bg, limits);

    const bubbles = requireArrayWithin(
      data.bubbles,
      limits.maxBubbles,
      "Project bubbles",
    );
    requireArrayWithin(
      data.bg.images,
      limits.maxBackgroundImages,
      "Project background images",
    );
    requireArrayWithin(
      data.savedStyles,
      limits.maxSavedStyles,
      "Project saved styles",
    );

    for (const bubble of bubbles) {
      if (!bubble || typeof bubble !== "object" || Array.isArray(bubble)) continue;
      if (
        typeof bubble.text === "string" &&
        bubble.text.length > limits.maxBubbleTextCharacters
      ) {
        throw projectValidationError(
          PROJECT_VALIDATION_CODES.TOO_COMPLEX,
          "A project text entry exceeds the supported limit.",
        );
      }
      requireArrayWithin(
        bubble.tails,
        limits.maxTailsPerBubble,
        "Bubble tails",
      );
    }

    let collectionEntries = 0;
    let strokeCount = 0;
    let pointCount = 0;
    const visited = new WeakSet();
    const stack = [{ value: data, depth: 0, key: "" }];

    while (stack.length) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== "object") continue;
      if (current.depth > limits.maxDepth) {
        throw projectValidationError(
          PROJECT_VALIDATION_CODES.TOO_COMPLEX,
          "Project nesting exceeds the supported limit.",
        );
      }
      if (visited.has(value)) {
        throw projectValidationError(
          PROJECT_VALIDATION_CODES.MALFORMED,
          "Project contains a circular value.",
        );
      }
      visited.add(value);

      if (Array.isArray(value)) {
        collectionEntries += value.length;
        if (current.key === "strokes") strokeCount += value.length;
        if (current.key === "points") pointCount += value.length;
        for (let index = 0; index < value.length; index += 1) {
          stack.push({ value: value[index], depth: current.depth + 1, key: "" });
        }
      } else {
        const keys = Object.keys(value);
        collectionEntries += keys.length;
        for (const key of keys) {
          stack.push({ value: value[key], depth: current.depth + 1, key });
        }
      }

      if (
        collectionEntries > limits.maxCollectionEntries ||
        strokeCount > limits.maxMaskStrokes ||
        pointCount > limits.maxPoints
      ) {
        throw projectValidationError(
          PROJECT_VALIDATION_CODES.TOO_COMPLEX,
          "Project contents exceed the supported complexity limits.",
        );
      }
    }

    return data;
  }

  function parseAndValidateProjectText(text, limits = PROJECT_RESOURCE_LIMITS) {
    if (typeof text !== "string") {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.MALFORMED,
        "Project contents must be text.",
      );
    }
    if (text.length > limits.maxFileBytes) {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.TOO_LARGE,
        "Project text exceeds the supported size limit.",
      );
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.MALFORMED,
        "Project contains malformed JSON.",
      );
    }
    return validateProjectData(data, limits);
  }

  async function readAndValidateProjectFile(file, readText, limits = PROJECT_RESOURCE_LIMITS) {
    validateProjectFileBeforeRead(file, limits);
    if (typeof readText !== "function") {
      throw projectValidationError(
        PROJECT_VALIDATION_CODES.MALFORMED,
        "Project file reader is unavailable.",
      );
    }
    const text = await readText(file);
    return parseAndValidateProjectText(text, limits);
  }

  return {
    PROJECT_RESOURCE_LIMITS,
    PROJECT_VALIDATION_CODES,
    parseAndValidateProjectText,
    readAndValidateProjectFile,
    validateProjectData,
    validateProjectFileBeforeRead,
  };
  },
);
