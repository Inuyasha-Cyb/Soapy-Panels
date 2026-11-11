(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoapyPanels.project.lifecycle = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createLifecycle({ snapshots, getVideoCount = () => 0 }) {
    let warningBaseline = null;
    let fileBaseline = null;
    let observed = null;
    let observedVideos = 0;
    let generation = 0;
    let revision = 0;
    let name = '';
    let transitioning = false;
    let recovery = null;
    function observe() {
      if (transitioning) return false;
      const value = snapshots.takeProjectSnapshot();
      const videos = getVideoCount();
      if (!value || (value === observed && videos === observedVideos))
        return false;
      observed = value;
      observedVideos = videos;
      revision++;
      if (recovery) recovery.changed();
      return true;
    }
    function initialize() {
      observed =
        warningBaseline =
        fileBaseline =
          snapshots.takeProjectSnapshot();
      observedVideos = getVideoCount();
    }
    function capture() {
      observe();
      return {
        generation,
        revision,
        name,
        excludedVideoCount: getVideoCount(),
        content: snapshots.capture(),
      };
    }
    async function saved(captured, savedName) {
      if (!captured || captured.generation !== generation) return;
      warningBaseline = fileBaseline = captured.content.snapshot;
      if (savedName) name = savedName;
      observe();
      if (recovery) await recovery.saved(captured);
    }
    async function replace(nextName) {
      generation++;
      revision = 0;
      name = nextName || '';
      initialize();
      if (recovery) await recovery.replace();
    }
    async function newProject(confirm, reset) {
      if (transitioning || !(await confirm('new'))) return false;
      transitioning = true;
      try {
        await reset();
        await replace('');
        return true;
      } finally {
        transitioning = false;
      }
    }
    async function recover(envelope, restore) {
      transitioning = true;
      try {
        await restore(envelope.project);
        generation++;
        revision = 1;
        name = envelope.name || '';
        observed = snapshots.takeProjectSnapshot();
        // A recovered document is always unsaved, even when it is empty.
        warningBaseline = fileBaseline = null;
      } finally {
        transitioning = false;
      }
    }
    return {
      initialize,
      observe,
      capture,
      saved,
      replace,
      newProject,
      recover,
      markWarningSaved() {
        warningBaseline = snapshots.takeProjectSnapshot();
      },
      hasUnsavedChanges() {
        return snapshots.takeProjectSnapshot() !== warningBaseline;
      },
      needsRecovery() {
        return snapshots.takeProjectSnapshot() !== fileBaseline;
      },
      setTransitioning(value) {
        transitioning = value;
      },
      isTransitioning: () => transitioning,
      identity: () => ({ generation, revision, name }),
      setRecovery(value) {
        recovery = value;
      },
    };
  }
  function createCloseCoordinator({
    canClose = () => true,
    confirm,
    cleanup,
    allowUnload,
    acknowledge,
    closeBrowser,
    onFailure,
  }) {
    let pending = false;
    return async function close(nativeRequest) {
      if (pending) return;
      pending = true;
      let approved = false;
      try {
        if (!canClose() || !(await confirm('close'))) return;
        await cleanup();
        allowUnload();
        approved = true;
        if (!nativeRequest) closeBrowser();
      } catch (error) {
        onFailure(error);
      } finally {
        pending = false;
        if (nativeRequest) await acknowledge(approved);
      }
    };
  }
  return { createLifecycle, createCloseCoordinator };
});
