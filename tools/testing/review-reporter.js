const { sanitizeValue } = require("./review-common");

function normalizeError(error) {
  if (!error) return null;
  const assertion = [error, error.cause, error.error].find(
    (candidate) =>
      candidate &&
      (Object.hasOwn(candidate, "actual") || Object.hasOwn(candidate, "expected")),
  ) || error;
  return {
    name: error.name || "Error",
    code: error.code,
    failureType: error.failureType,
    message: error.message || String(error),
    stack: assertion.stack || error.stack || "",
    operator: assertion.operator,
    actual: Object.hasOwn(assertion, "actual") ? sanitizeValue(assertion.actual) : null,
    expected: Object.hasOwn(assertion, "expected")
      ? sanitizeValue(assertion.expected)
      : null,
    hasActual: Object.hasOwn(assertion, "actual"),
    hasExpected: Object.hasOwn(assertion, "expected"),
    raw: sanitizeValue(error),
  };
}

module.exports = async function* reviewReporter(source) {
  for await (const event of source) {
    const data = event && event.data ? event.data : {};
    const details = data.details || {};
    const record = {
      type: event.type,
      name: data.name || "",
      file: data.file || "",
      line: data.line || null,
      column: data.column || null,
      nesting: data.nesting || 0,
      testNumber: data.testNumber || null,
      kind: details.type || null,
      durationMs:
        details.duration_ms == null ? null : Number(details.duration_ms),
      error: normalizeError(details.error),
      message:
        event.type === "test:stdout" || event.type === "test:stderr"
          ? String(data.message || "")
          : undefined,
    };
    yield `${JSON.stringify(record)}\n`;
  }
};
