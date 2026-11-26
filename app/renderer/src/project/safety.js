(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SoapyPanels = root.SoapyPanels || {};
    root.SoapyPanels.project = root.SoapyPanels.project || {};
    root.SoapyPanels.project.safety = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createSafetyDialogs(deps) {
    const {
      $,
      tr,
      document,
      window,
      requestAnimationFrame,
      getSessionOnlyVideoCount,
      hasUnsavedProjectChanges,
    } = deps;
    const projectSafetyOverlayEl = $('#projectSafetyOverlay');
    const projectSafetyDialogEl = $('#projectSafetyDialog');
    const projectSafetyTitleEl = $('#projectSafetyTitle');
    const projectSafetyDescriptionEl = $('#projectSafetyDescription');
    const projectSafetyCancelEl = projectSafetyOverlayEl
      ? projectSafetyOverlayEl.querySelector('[data-project-safety-cancel]')
      : null;
    const projectSafetyContinueEl = projectSafetyOverlayEl
      ? projectSafetyOverlayEl.querySelector('[data-project-safety-continue]')
      : null;
    const projectSafetyDialogState = {
      open: false,
      resolve: null,
      returnFocus: null,
    };

    function getProjectSafetyFocusableElements() {
      if (!projectSafetyDialogEl) return [];
      return Array.prototype.slice
        .call(
          projectSafetyDialogEl.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        )
        .filter(function (element) {
          return !element.hidden;
        });
    }

    function closeProjectSafetyDialog(confirmed) {
      if (!projectSafetyDialogState.open) return;
      const resolve = projectSafetyDialogState.resolve;
      const returnFocus = projectSafetyDialogState.returnFocus;
      projectSafetyDialogState.open = false;
      projectSafetyDialogState.resolve = null;
      projectSafetyDialogState.returnFocus = null;
      if (projectSafetyOverlayEl) {
        projectSafetyOverlayEl.hidden = true;
        projectSafetyOverlayEl.setAttribute('aria-hidden', 'true');
      }
      if (returnFocus && typeof returnFocus.focus === 'function') {
        try {
          returnFocus.focus();
        } catch {
          /* Optional UI operation failed. */
        }
      }
      if (typeof resolve === 'function') resolve(confirmed === true);
    }

    function handleProjectSafetyDialogKeydown(event) {
      if (!projectSafetyDialogState.open || !event) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeProjectSafetyDialog(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getProjectSafetyFocusableElements();
      if (!focusable.length) {
        event.preventDefault();
        if (projectSafetyDialogEl) projectSafetyDialogEl.focus();
        return;
      }
      const currentIndex = focusable.indexOf(document.activeElement);
      const direction = event.shiftKey ? -1 : 1;
      const nextIndex =
        currentIndex < 0
          ? 0
          : (currentIndex + direction + focusable.length) % focusable.length;
      event.preventDefault();
      focusable[nextIndex].focus();
    }

    function showProjectSafetyDialog(options) {
      options = options || {};
      const title = String(options.title || '');
      const description = String(options.description || '');
      const continueLabel = String(
        options.continueLabel || tr('projectSafety.continue'),
      );
      if (
        !projectSafetyOverlayEl ||
        !projectSafetyDialogEl ||
        !projectSafetyTitleEl ||
        !projectSafetyDescriptionEl ||
        !projectSafetyCancelEl ||
        !projectSafetyContinueEl
      ) {
        return Promise.resolve(window.confirm(title + '\n\n' + description));
      }
      if (projectSafetyDialogState.open) return Promise.resolve(false);
      projectSafetyTitleEl.textContent = title;
      projectSafetyDescriptionEl.textContent = description;
      projectSafetyContinueEl.textContent = continueLabel;
      projectSafetyDialogState.open = true;
      projectSafetyDialogState.returnFocus = document.activeElement || null;
      projectSafetyOverlayEl.hidden = false;
      projectSafetyOverlayEl.setAttribute('aria-hidden', 'false');
      return new Promise(function (resolve) {
        projectSafetyDialogState.resolve = resolve;
        requestAnimationFrame(function () {
          if (projectSafetyDialogState.open && projectSafetyCancelEl) {
            projectSafetyCancelEl.focus();
          }
        });
      });
    }

    function getProjectSafetyActionLabel(action) {
      if (action === 'new') return tr('projectSafety.newContinue');
      if (action === 'open') return tr('projectSafety.openContinue');
      return tr('projectSafety.closeContinue');
    }

    function getProjectSafetyVideoBodyKey(action) {
      if (action === 'new') return 'projectSafety.newBody';
      if (action === 'open') return 'projectSafety.openBody';
      return 'projectSafety.closeBody';
    }

    function confirmSaveWithoutSessionVideos() {
      const videoCount = getSessionOnlyVideoCount();
      if (!videoCount) return Promise.resolve(true);
      return showProjectSafetyDialog({
        title: tr('projectSafety.saveTitle'),
        description: tr('projectSafety.saveBody', { count: videoCount }),
        continueLabel: tr('projectSafety.saveContinue'),
      });
    }

    function confirmDiscardUnsavedChanges(action) {
      const hasUnsavedChanges = hasUnsavedProjectChanges();
      const videoCount = getSessionOnlyVideoCount();
      if (!hasUnsavedChanges && !videoCount) return Promise.resolve(true);
      let description = videoCount
        ? tr(getProjectSafetyVideoBodyKey(action), { count: videoCount })
        : tr('projectSafety.unsavedBody');
      if (videoCount && hasUnsavedChanges) {
        description += '\n\n' + tr('projectSafety.unsavedAlso');
      }
      return showProjectSafetyDialog({
        title: videoCount
          ? tr('projectSafety.discardTitle')
          : tr('projectSafety.unsavedTitle'),
        description: description,
        continueLabel: getProjectSafetyActionLabel(action),
      });
    }

    if (projectSafetyCancelEl) {
      projectSafetyCancelEl.addEventListener('click', function () {
        closeProjectSafetyDialog(false);
      });
    }
    if (projectSafetyContinueEl) {
      projectSafetyContinueEl.addEventListener('click', function () {
        closeProjectSafetyDialog(true);
      });
    }
    if (projectSafetyOverlayEl) {
      projectSafetyOverlayEl.addEventListener('click', function (event) {
        if (event.target === projectSafetyOverlayEl)
          closeProjectSafetyDialog(false);
      });
    }
    if (projectSafetyDialogEl) {
      projectSafetyDialogEl.addEventListener(
        'keydown',
        handleProjectSafetyDialogKeydown,
      );
    }

    return {
      confirmSaveWithoutSessionVideos,
      confirmDiscardUnsavedChanges,
      showProjectSafetyDialog,
      closeProjectSafetyDialog,
      projectSafetyDialogState,
    };
  }
  return { createSafetyDialogs };
});
