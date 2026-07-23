const historyStackHelpers = (() => {
  function resolveSnapshot(snapshotOrFactory) {
    return typeof snapshotOrFactory === 'function'
      ? snapshotOrFactory()
      : snapshotOrFactory;
  }

  function isSnapshot(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function createHistoryStack(options = {}) {
    const maxEntries =
      Number.isFinite(options.maxEntries) && options.maxEntries > 0
        ? Math.floor(options.maxEntries)
        : 200;
    const setTimer =
      typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    const clearTimer =
      typeof options.clearTimeout === 'function'
        ? options.clearTimeout
        : clearTimeout;

    let past = [];
    let future = [];
    let pendingTimer = null;
    let pendingSnapshot = null;

    function trimPast() {
      while (past.length > maxEntries) past.shift();
    }

    function hasPending() {
      return pendingTimer !== null || pendingSnapshot !== null;
    }

    function clearPendingTimer() {
      if (pendingTimer === null) return;
      clearTimer(pendingTimer);
      pendingTimer = null;
    }

    function clearPendingSnapshot() {
      clearPendingTimer();
      pendingSnapshot = null;
    }

    function pushSnapshot(snapshot, options = {}) {
      if (!isSnapshot(snapshot)) return false;
      if (past.length && past[past.length - 1] === snapshot) return false;
      past.push(snapshot);
      trimPast();
      if (options.clearFuture !== false) future = [];
      return true;
    }

    function commit(snapshotOrFactory) {
      clearPendingSnapshot();
      return pushSnapshot(resolveSnapshot(snapshotOrFactory));
    }

    function schedule(snapshotFactory, delay = 300) {
      clearPendingTimer();
      pendingSnapshot = snapshotFactory;
      future = [];
      pendingTimer = setTimer(() => {
        const provider = pendingSnapshot;
        pendingTimer = null;
        pendingSnapshot = null;
        pushSnapshot(resolveSnapshot(provider));
      }, delay);
    }

    function flushPending() {
      if (!hasPending()) return false;
      const provider = pendingSnapshot;
      clearPendingTimer();
      pendingSnapshot = null;
      return pushSnapshot(resolveSnapshot(provider));
    }

    function cancelPending() {
      clearPendingSnapshot();
    }

    function reset(snapshotOrFactory) {
      clearPendingSnapshot();
      past = [];
      future = [];
      const snapshot = resolveSnapshot(snapshotOrFactory);
      if (isSnapshot(snapshot)) past.push(snapshot);
    }

    function undo() {
      flushPending();
      if (past.length < 2) return null;
      future.push(past.pop());
      return past[past.length - 1] || null;
    }

    function redo() {
      cancelPending();
      if (!future.length) return null;
      const snapshot = future.pop();
      if (!past.length || past[past.length - 1] !== snapshot) {
        past.push(snapshot);
        trimPast();
      }
      return snapshot;
    }

    function getState() {
      return {
        past: past.slice(),
        future: future.slice(),
        pending: hasPending(),
      };
    }

    return {
      commit,
      schedule,
      flushPending,
      cancelPending,
      reset,
      undo,
      redo,
      getState,
      canUndo: () => past.length > 1 || hasPending(),
      canRedo: () => future.length > 0,
    };
  }

  return {
    createHistoryStack,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = historyStackHelpers;
} else {
  const root = typeof self !== 'undefined' ? self : window;
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.history = root.SoapyPanels.history || {};
  root.SoapyPanels.history.stack = historyStackHelpers;
}
