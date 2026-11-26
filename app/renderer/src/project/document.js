(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SoapyPanels = root.SoapyPanels || {};
    root.SoapyPanels.project = root.SoapyPanels.project || {};
    root.SoapyPanels.project.document = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createDocumentOperations(deps) {
    const {
      state,
      $,
      tr,
      alert,
      window,
      document,
      projectFileContract,
      createProjectBlob,
      confirmSaveWithoutSessionVideos,
      markProjectSaved,
      projectValidation,
      confirmDiscardUnsavedChanges,
      restoreProject,
    } = deps;
    const saveBlobWithPicker =
      deps.saveBlobWithPicker || defaultSaveBlobWithPicker;
    function makeProjectFileError(name, message) {
      const error = new Error(message || name || 'Project file error');
      error.name = name || 'Error';
      return error;
    }

    function isProjectFileCancelError(error) {
      return !!error && error.name === 'AbortError';
    }

    function isRecoverableProjectHandleError(error) {
      if (!error) return false;
      return (
        [
          'NotAllowedError',
          'NotFoundError',
          'InvalidStateError',
          'SecurityError',
        ].indexOf(error.name) !== -1
      );
    }

    async function ensureProjectHandleWritable(handle) {
      if (!handle)
        throw makeProjectFileError(
          'InvalidStateError',
          'Missing project handle.',
        );
      const permissionOptions = { mode: 'readwrite' };
      if (typeof handle.queryPermission === 'function') {
        let permission = await handle.queryPermission(permissionOptions);
        if (permission === 'granted') return;
        if (typeof handle.requestPermission === 'function') {
          permission = await handle.requestPermission(permissionOptions);
        }
        if (permission !== 'granted') {
          throw makeProjectFileError(
            'NotAllowedError',
            'Project file write permission was not granted.',
          );
        }
      }
    }

    async function writeProjectBlobToHandle(handle, blob) {
      await ensureProjectHandleWritable(handle);
      if (typeof handle.createWritable !== 'function') {
        throw makeProjectFileError(
          'InvalidStateError',
          'Project handle is not writable.',
        );
      }
      const writable = await handle.createWritable();
      let completed = false;
      try {
        await writable.write(blob);
        await writable.close();
        completed = true;
      } catch (error) {
        if (!completed && writable && typeof writable.abort === 'function') {
          try {
            await writable.abort();
          } catch {
            /* Preserve the original write error. */
          }
        }
        throw error;
      }
    }

    async function defaultSaveBlobWithPicker(blob, options) {
      options = options || {};

      const suggestedName = options.suggestedName || 'download';

      const types = Array.isArray(options.types) ? options.types : [];

      const excludeAcceptAllOption =
        options.excludeAcceptAllOption !== undefined
          ? options.excludeAcceptAllOption
          : true;

      if (options.handle) {
        await writeProjectBlobToHandle(options.handle, blob);
        return { saved: true, handle: options.handle, downloaded: false };
      }

      if (typeof window !== 'undefined' && window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: suggestedName,

          types: types,

          excludeAcceptAllOption: excludeAcceptAllOption,
        });

        await writeProjectBlobToHandle(handle, blob);
        return { saved: true, handle: handle, downloaded: false };
      }

      const url = URL.createObjectURL(blob);

      try {
        const a = document.createElement('a');

        a.href = url;

        a.download = suggestedName;

        a.rel = 'noopener';

        a.style.display = 'none';

        document.body.appendChild(a);

        a.click();

        document.body.removeChild(a);
      } finally {
        URL.revokeObjectURL(url);
      }

      return { saved: true, handle: null, downloaded: true };
    }

    function getProjectSavePickerOptions() {
      const projectSaveAccept = {};
      projectSaveAccept[projectFileContract.mimeType] = [
        projectFileContract.preferredExtension,
      ];
      return {
        suggestedName: projectFileContract.suggestedName,
        types: [
          {
            description: 'Soapy Panels Project',
            accept: projectSaveAccept,
          },
        ],
        excludeAcceptAllOption: true,
      };
    }

    let projectSaveActive = false;
    let projectOpenActive = false;

    function setProjectSaveActive(active) {
      projectSaveActive = !!active;
      const saveButton = $('#mi-save');
      const saveAsButton = $('#mi-save-as');
      if (saveButton) saveButton.disabled = projectSaveActive;
      if (saveAsButton) saveAsButton.disabled = projectSaveActive;
    }

    function reportProjectSaveFailure(error) {
      try {
        (deps.console || console).error('Project save failed', error);
      } catch {
        /* Optional UI operation failed. */
      }
      alert(tr('projectSave.failed'));
    }

    async function saveProjectDocument(options) {
      options = options || {};
      if (
        projectSaveActive ||
        projectOpenActive ||
        (deps.isTransitioning && deps.isTransitioning())
      )
        return false;
      if (!projectFileContract)
        throw new Error('Project file contract is unavailable.');

      setProjectSaveActive(true);
      try {
        if (!(await confirmSaveWithoutSessionVideos())) return false;

        const capture = deps.captureProject ? deps.captureProject() : null;
        const blob = capture
          ? await deps.encodeProject(capture)
          : await createProjectBlob();
        const forcePicker = options.saveAs === true;
        const existingHandle = forcePicker ? null : state.fileHandles.project;
        const pickerOptions = getProjectSavePickerOptions();
        let result = null;

        try {
          result = await saveBlobWithPicker(
            blob,
            Object.assign({}, pickerOptions, { handle: existingHandle }),
          );
        } catch (error) {
          if (isProjectFileCancelError(error)) return false;
          if (existingHandle && isRecoverableProjectHandleError(error)) {
            state.fileHandles.project = null;
            try {
              result = await saveBlobWithPicker(blob, pickerOptions);
            } catch (replacementError) {
              if (isProjectFileCancelError(replacementError)) return false;
              reportProjectSaveFailure(replacementError);
              return false;
            }
          } else {
            reportProjectSaveFailure(error);
            return false;
          }
        }

        if (!result || result.saved !== true) return false;
        if (capture && deps.isCurrentCapture && !deps.isCurrentCapture(capture))
          return true;
        state.fileHandles.project = result.downloaded ? null : result.handle;
        if (deps.onSaved) await deps.onSaved(capture, result);
        else markProjectSaved();
        return true;
      } catch (error) {
        if (!isProjectFileCancelError(error)) reportProjectSaveFailure(error);
        return false;
      } finally {
        setProjectSaveActive(false);
      }
    }

    function saveProject() {
      return saveProjectDocument({ saveAs: false });
    }

    function saveProjectAs() {
      return saveProjectDocument({ saveAs: true });
    }

    function getProjectOpenPickerOptions() {
      const projectOpenAccept = {};
      projectOpenAccept[projectFileContract.mimeType] = [
        projectFileContract.preferredExtension,
      ].concat(projectFileContract.legacyExtensions);
      return {
        multiple: false,
        types: [
          {
            description: 'Soapy Panels Project',
            accept: projectOpenAccept,
          },
        ],
        excludeAcceptAllOption: true,
      };
    }

    function readProjectFileTextUnchecked(file) {
      if (file && typeof file.text === 'function') return file.text();
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve(reader.result);
        };
        reader.onerror = function () {
          reject(reader.error || new Error('Failed to read project file.'));
        };
        reader.readAsText(file);
      });
    }

    async function restoreSelectedProjectFile(file, handle) {
      if (
        projectOpenActive ||
        projectSaveActive ||
        (deps.isTransitioning && deps.isTransitioning())
      )
        return false;
      projectOpenActive = true;
      try {
        if (
          !projectValidation ||
          typeof projectValidation.readAndValidateProjectFile !== 'function'
        ) {
          throw new Error('Project validation is unavailable.');
        }
        const projectData = await projectValidation.readAndValidateProjectFile(
          file,
          readProjectFileTextUnchecked,
        );
        if (!(await confirmDiscardUnsavedChanges('open'))) return false;
        if (deps.beginTransition) deps.beginTransition();
        await new Promise(function (resolve, reject) {
          try {
            restoreProject(projectData, true, {
              markSaved: true,
              onComplete: function () {
                state.fileHandles.project = handle || null;
                resolve();
              },
            });
          } catch (error) {
            reject(error);
          }
        });
        if (deps.onOpened) await deps.onOpened(file && file.name);
        return true;
      } catch (error) {
        try {
          (deps.console || console).error('Project open failed', error);
        } catch {
          /* Optional UI operation failed. */
        }
        let errorKey = 'projectOpen.invalid';
        if (error && error.code === 'PROJECT_TOO_LARGE') {
          errorKey = 'projectOpen.tooLarge';
        } else if (error && error.code === 'PROJECT_TOO_COMPLEX') {
          errorKey = 'projectOpen.tooComplex';
        } else if (error && error.code === 'PROJECT_UNSAFE_CANVAS') {
          errorKey = 'projectOpen.unsafeCanvas';
        }
        alert(tr(errorKey));
        return false;
      } finally {
        projectOpenActive = false;
        if (deps.endTransition) deps.endTransition();
      }
    }

    function openProjectWithInput() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = [projectFileContract.preferredExtension]
        .concat(projectFileContract.legacyExtensions)
        .concat(projectFileContract.mimeType)
        .join(',');
      input.onchange = function () {
        const file = input.files[0];
        if (file) restoreSelectedProjectFile(file, null);
      };
      input.click();
    }

    async function openProject() {
      if (!projectFileContract)
        throw new Error('Project file contract is unavailable.');

      if (
        typeof window !== 'undefined' &&
        typeof window.showOpenFilePicker === 'function'
      ) {
        try {
          const handles = await window.showOpenFilePicker(
            getProjectOpenPickerOptions(),
          );
          const handle = Array.isArray(handles) ? handles[0] : null;
          if (!handle) return;
          const file = await handle.getFile();
          await restoreSelectedProjectFile(file, handle);
        } catch (error) {
          if (isProjectFileCancelError(error)) return;
          try {
            (deps.console || console).error('Project picker failed', error);
          } catch {
            /* Optional UI operation failed. */
          }
          alert(tr('projectOpen.invalid'));
        }
        return;
      }

      openProjectWithInput();
    }

    return {
      isBusy: () => projectSaveActive || projectOpenActive,
      saveProject,
      saveProjectAs,
      openProject,
      restoreSelectedProjectFile,
      setProjectSaveActive,
      getProjectSavePickerOptions,
      getProjectOpenPickerOptions,
    };
  }
  return { createDocumentOperations };
});
