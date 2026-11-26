(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoapyPanels.project.recovery = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createRecovery({
    api,
    lifecycle,
    snapshots,
    isBusy = () => false,
    status = () => {},
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    idleMs = 5000,
    maxMs = 30000,
    retryMs = 30000,
  }) {
    let session = null;
    let sessionPromise = null;
    let timer = null;
    let firstChange = null;
    let inFlight = null;
    let epoch = 0;
    let stopped = false;
    let written = '';
    let backups = [];
    let retryPending = false;
    let pausedCode = '';
    function quotaKey(error) {
      const code =
        error &&
        (error.code || /\[(RECOVERY_[A-Z_]+)\]/.exec(error.message || '')?.[1]);
      const keys = {
        RECOVERY_SIZE_LIMIT: 'sizeLimit',
        RECOVERY_STORAGE_LIMIT: 'storageLimit',
        RECOVERY_SESSION_LIMIT: 'sessionLimit',
      };
      return keys[code] ? { code, key: keys[code] } : null;
    }
    function failure(error) {
      const quota = quotaKey(error);
      if (quota) {
        pausedCode = quota.code;
        retryPending = false;
        cancelTimer();
        status(quota.key, error);
      } else {
        status('unavailable', error);
        retryPending = true;
        schedule(retryMs);
      }
    }
    async function ensureSession() {
      if (session) return session;
      if (!sessionPromise) sessionPromise = api.recoveryStart();
      try {
        session = await sessionPromise;
        return session;
      } finally {
        sessionPromise = null;
      }
    }
    function cancelTimer() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    }
    function schedule(delay) {
      cancelTimer();
      if (!stopped)
        timer = setTimer(() => {
          timer = null;
          void flush();
        }, delay);
    }
    function changed() {
      if (stopped || pausedCode) return;
      if (firstChange === null) firstChange = now();
      if (retryPending) return;
      schedule(Math.max(0, Math.min(idleMs, maxMs - (now() - firstChange))));
    }
    async function clearBackups() {
      for (const id of backups.slice()) {
        await api.recoveryDiscard(id);
        backups = backups.filter((value) => value !== id);
      }
    }
    async function flush() {
      if (stopped || pausedCode) return;
      if (inFlight) return inFlight;
      if (lifecycle.isTransitioning() || isBusy()) {
        schedule(250);
        return;
      }
      cancelTimer();
      let capture;
      try {
        capture = lifecycle.capture();
      } catch (error) {
        failure(error);
        return;
      }
      const key = capture.generation + ':' + capture.revision;
      if (!lifecycle.needsRecovery()) {
        firstChange = null;
        if (written) await saved(capture);
        return;
      }
      if (key === written) {
        firstChange = null;
        return;
      }
      const currentEpoch = epoch;
      firstChange = null;
      status('saving');
      inFlight = (async () => {
        const id = await ensureSession();
        const blob = await snapshots.toBlob(capture.content);
        if (stopped || epoch !== currentEpoch) return;
        const project = JSON.parse(await blob.text());
        if (stopped || epoch !== currentEpoch) return;
        const success = await api.recoveryWrite(id, {
          version: 1,
          generation: capture.generation,
          revision: capture.revision,
          name: capture.name,
          excludedVideoCount: capture.excludedVideoCount,
          project,
        });
        if (stopped || epoch !== currentEpoch) return;
        if (success) {
          await clearBackups();
          if (stopped || epoch !== currentEpoch) return;
          written = key;
          status('updated');
        }
        retryPending = false;
      })()
        .catch((error) => {
          if (epoch !== currentEpoch || stopped) return;
          failure(error);
        })
        .finally(() => {
          inFlight = null;
          if (
            !stopped &&
            !pausedCode &&
            epoch === currentEpoch &&
            !retryPending
          ) {
            lifecycle.observe();
            const current = lifecycle.identity();
            if (
              lifecycle.needsRecovery() &&
              current.generation + ':' + current.revision !== written
            )
              changed();
          }
        });
      return inFlight;
    }
    async function saved(capture) {
      if (stopped || capture.generation !== lifecycle.identity().generation)
        return;
      // Fence conversion work before installing a durable revision floor.
      const savedEpoch = ++epoch;
      cancelTimer();
      if (inFlight) await inFlight;
      try {
        if (sessionPromise || (!session && !pausedCode)) await ensureSession();
        if (stopped || epoch !== savedEpoch) return;
        if (session)
          await api.recoveryClear(session, {
            generation: capture.generation,
            revision: capture.revision,
          });
        if (stopped || epoch !== savedEpoch) return;
        await clearBackups();
        if (stopped || epoch !== savedEpoch) return;
        written = '';
        firstChange = null;
        retryPending = false;
        pausedCode = '';
        status('');
      } catch (error) {
        if (stopped || epoch !== savedEpoch) return;
        if (quotaKey(error)) {
          failure(error);
          return;
        }
        status('unavailable', error);
        retryPending = true;
        timer = setTimer(() => {
          timer = null;
          void saved(capture);
        }, retryMs);
      }
      if (lifecycle.needsRecovery()) changed();
    }
    async function replace() {
      pausedCode = '';
      epoch++;
      cancelTimer();
      if (inFlight) await inFlight;
      try {
        if (session) await api.recoveryDiscard(session);
        await clearBackups();
        session = null;
        await ensureSession();
        status('');
      } catch (error) {
        failure(error);
        session = null;
      }
      written = '';
      firstChange = null;
      retryPending = false;
    }
    async function close() {
      stopped = true;
      epoch++;
      cancelTimer();
      if (inFlight) await inFlight;
      if (sessionPromise) await ensureSession().catch(() => {});
      if (session) await api.recoveryDiscard(session);
      session = null;
      await clearBackups();
    }
    return {
      start: async () => {
        try {
          return await ensureSession();
        } catch (error) {
          failure(error);
          throw error;
        }
      },
      settle: () => inFlight || Promise.resolve(),
      retry: async () => {
        if (stopped) return;
        pausedCode = '';
        retryPending = false;
        cancelTimer();
        try {
          await ensureSession();
          if (stopped) return;
          if (!lifecycle.needsRecovery()) status('');
          await flush();
        } catch (error) {
          if (!stopped) failure(error);
        }
      },
      changed,
      flush,
      saved,
      replace,
      close,
      retainClaim: (id) => {
        backups.push(id);
      },
      resume() {
        stopped = false;
        written = '';
        retryPending = false;
        changed();
      },
      state: () => ({ session, written, inFlight: !!inFlight, pausedCode }),
    };
  }
  return { createRecovery };
});
