(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.SoapyPanels = root.SoapyPanels || {};
    root.SoapyPanels.images = root.SoapyPanels.images || {};
    root.SoapyPanels.images.previewScheduler = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // A single dispatcher keeps captures out of the worker's unbounded message queue.
  // Map replacement preserves FIFO position, so busy layers cannot starve others.
  function createScheduler() {
    const pending = new Map();
    let active = false;
    let paused = false;
    function pump() {
      if (active || paused || !pending.size) return;
      const [key, job] = pending.entries().next().value;
      pending.delete(key);
      active = true;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
        active = false;
        pump();
      });
    }
    return {
      schedule(key, run) {
        if (pending.has(key)) pending.get(key).resolve(null);
        const result = new Promise((resolve, reject) => pending.set(key, { run, resolve, reject }));
        pump();
        return result;
      },
      cancel(key) {
        if (pending.has(key)) pending.get(key).resolve(null);
        pending.delete(key);
      },
      setPaused(value) { paused = !!value; pump(); },
      snapshot() { return { active: Number(active), pending: pending.size, paused }; },
    };
  }

  function frameDue(previousMediaTime, mediaTime, playing, force) {
    const elapsed = mediaTime - previousMediaTime;
    return force || !playing || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 1000 / 30 - 1;
  }

  function createQuality(cap) {
    const steps = [1280, 960, 720, 540, 360].filter(value => value <= cap);
    if (!steps.length) steps.push(Math.max(1, cap));
    let index = 0;
    let slow = 0;
    let fast = 0;
    return {
      dimension(source, display, paused) {
        return Math.max(1, Math.ceil(Math.min(source, display, paused ? cap : steps[index])));
      },
      observe(milliseconds) {
        slow = milliseconds > 1000 / 30 ? slow + 1 : 0;
        // Only step up when the measured cost can afford the larger pixel count.
        const growth = index > 0 ? (steps[index - 1] / steps[index]) ** 2 : 1;
        fast = milliseconds < 20 && milliseconds * growth < 26 ? fast + 1 : 0;
        if (slow >= 5 && index < steps.length - 1) { index++; slow = fast = 0; }
        if (fast >= 90 && index > 0) { index--; slow = fast = 0; }
      },
      current() { return steps[index]; },
    };
  }

  function createMetrics(limit = 600) {
    let enabled = false;
    const samples = Object.create(null);
    return {
      enable(value = true) { enabled = !!value; },
      get enabled() { return enabled; },
      record(name, value) {
        if (!enabled || !Number.isFinite(value)) return;
        const list = samples[name] || (samples[name] = []);
        list.push(value);
        if (list.length > limit) list.shift();
      },
      reset() { for (const key of Object.keys(samples)) delete samples[key]; },
      snapshot() {
        const result = {};
        for (const [key, list] of Object.entries(samples)) {
          const sorted = list.slice().sort((a, b) => a - b);
          result[key] = { count: list.length, mean: list.reduce((a, b) => a + b, 0) / list.length,
            p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted[sorted.length - 1] };
        }
        return result;
      },
    };
  }
  return { createScheduler, createQuality, createMetrics, frameDue };
});
