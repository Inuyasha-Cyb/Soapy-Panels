const nodePerformance = require("node:perf_hooks").performance;

const STARTUP_METRICS_ENV_VAR = "SOAPY_STARTUP_METRICS";

function createStartupMetrics(options = {}) {
  const enabled = options.enabled === true;
  const now = typeof options.now === "function" ? options.now : () => nodePerformance.now();
  const timeOrigin = Number.isFinite(options.timeOrigin)
    ? options.timeOrigin
    : nodePerformance.timeOrigin;
  const log = typeof options.log === "function" ? options.log : null;
  const marks = Object.create(null);

  function mark(name) {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key || Object.prototype.hasOwnProperty.call(marks, key)) {
      return marks[key] ?? null;
    }
    const value = Math.max(0, now());
    marks[key] = value;
    if (enabled && log) log(`startup mark=${key} elapsedMs=${Math.round(value)}`);
    return value;
  }

  function snapshot() {
    return {
      enabled,
      timeOrigin,
      marks: { ...marks },
    };
  }

  return {
    enabled,
    mark,
    snapshot,
  };
}

module.exports = {
  STARTUP_METRICS_ENV_VAR,
  createStartupMetrics,
};
