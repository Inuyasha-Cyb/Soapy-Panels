(function (root) {
  function createRecoveryUI({
    api,
    lifecycle,
    recovery,
    restore,
    tr,
    document,
    editor,
    confirmRecover = async () => false,
  }) {
    const dialog = document.querySelector('#projectRecoveryDialog');
    const list = document.querySelector('#projectRecoveryList');
    const statusElement = document.querySelector('#projectRecoveryStatus');
    const errorElement = document.querySelector('#projectRecoveryError');
    const controls = document.querySelector('#projectRecoveryControls');
    const more = dialog.querySelector('[data-recovery-more]');
    const menu = document.querySelector('#mi-recovery');
    let resolveChoice = null,
      locked = true,
      statusKey = '',
      restoreFocus = null,
      displaying = false,
      working = false;
    let cursor = null,
      startup = false;
    if (editor) editor.inert = true;
    function blockEditing(event) {
      if (
        locked &&
        !(
          event.target.closest &&
          event.target.closest('#helpOverlay, #projectRecoveryDialog')
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    document.addEventListener('keydown', blockEditing, true);
    function status(key) {
      statusKey = key;
      statusElement.textContent = key ? tr('recovery.' + key) : '';
      statusElement.hidden = !key;
      controls.hidden = ![
        'sizeLimit',
        'storageLimit',
        'sessionLimit',
        'unavailable',
      ].includes(key);
      statusElement.classList.toggle('has-actions', !controls.hidden);
    }
    function lock() {
      locked = true;
      if (editor) editor.inert = true;
    }
    function unlock() {
      locked = false;
      if (editor) editor.inert = false;
      if (restoreFocus?.isConnected) restoreFocus.focus();
    }
    function dismiss() {
      if (working) return;
      if (dialog.open) dialog.close();
      displaying = false;
      unlock();
      const resolve = resolveChoice;
      resolveChoice = null;
      if (resolve) resolve();
    }
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dismiss();
    });
    dialog
      .querySelector('[data-recovery-leave]')
      .addEventListener('click', dismiss);
    function setWorking(value) {
      working = value;
      for (const button of dialog.querySelectorAll('button'))
        button.disabled = value;
    }
    function append(session) {
      const row = document.createElement('li');
      row.dataset.recoveryId = session.id;
      const label = document.createElement('p');
      label.textContent = session.name || tr('recovery.untitled');
      if (session.timestamp)
        label.textContent +=
          ' — ' +
          new Date(session.timestamp).toLocaleString(
            document.documentElement.lang || undefined,
          );
      row.append(label);
      if (!session.recoverable) {
        const warning = document.createElement('p');
        warning.textContent = tr('recovery.damaged');
        row.append(warning);
      }
      if (session.excludedVideoCount) {
        const warning = document.createElement('p');
        warning.textContent = tr('recovery.videoExcluded', {
          count: session.excludedVideoCount,
        });
        row.append(warning);
      }
      for (const action of session.recoverable
        ? ['recover', 'discard']
        : ['discard']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.recoveryAction = action;
        button.textContent = tr('recovery.' + action);
        button.addEventListener('click', async () => {
          if (working) return;
          setWorking(true);
          errorElement.textContent = '';
          let claimed = false;
          try {
            if (action === 'recover') {
              if (!startup) {
                dialog.close();
                unlock();
                const approved = await confirmRecover();
                lock();
                dialog.showModal();
                if (!approved) return;
              }
              await recovery.settle();
              await api.recoveryClaim(session.id);
              claimed = true;
              const envelope = await api.recoveryRead(session.id);
              await lifecycle.recover(envelope, restore);
              if (!startup) await recovery.replace();
              recovery.retainClaim(session.id);
              claimed = false;
              recovery.changed();
              setWorking(false);
              dismiss();
            } else {
              // The main process rechecks inactivity under the shared mutation lock.
              await api.recoveryDiscard(session.id);
              row.remove();
              if (!list.children.length && cursor) await loadPage();
              if (!list.children.length && startup) {
                setWorking(false);
                dismiss();
              }
            }
          } catch {
            // Release even after a partially published claim; never delete a failed restore.
            if (claimed) await api.recoveryRelease(session.id).catch(() => {});
            else if (action === 'recover')
              await api.recoveryRelease(session.id).catch(() => {});
            errorElement.textContent = tr('recovery.failed');
          } finally {
            setWorking(false);
          }
        });
        row.append(button);
      }
      list.append(row);
    }
    async function loadPage() {
      await recovery.settle();
      const page = await api.recoveryList({ cursor });
      cursor = page.nextCursor;
      document.querySelector('#projectRecoveryUsage').textContent = page.usage
        .unavailable
        ? ''
        : tr('recovery.usage', {
            used: Math.ceil(page.usage.totalBytes / 1048576),
            limit: Math.floor(page.usage.limitBytes / 1048576),
            sessions: page.usage.sessions,
            maxSessions: page.usage.sessionLimit,
          });
      page.sessions.forEach(append);
      more.hidden = !cursor;
      if (!list.children.length)
        errorElement.textContent = tr('recovery.empty');
    }
    async function show(isStartup = false) {
      if (displaying) return;
      displaying = true;
      startup = isStartup;
      cursor = null;
      restoreFocus = document.activeElement;
      lock();
      list.replaceChildren();
      errorElement.textContent = '';
      try {
        await loadPage();
        if (isStartup && !list.children.length) {
          displaying = false;
          return;
        }
        await new Promise((resolve) => {
          resolveChoice = resolve;
          dialog.showModal();
        });
      } catch (error) {
        displaying = false;
        status('unavailable');
        throw error;
      } finally {
        if (!isStartup) unlock();
      }
    }
    more.addEventListener('click', async () => {
      if (working) return;
      setWorking(true);
      try {
        await loadPage();
      } catch {
        errorElement.textContent = tr('recovery.failed');
      } finally {
        setWorking(false);
      }
    });
    const manage = () => {
      const details = menu?.closest('details');
      if (details) details.open = false;
      void show().catch(() => {});
    };
    if (menu) {
      menu.hidden = false;
      menu.addEventListener('click', manage);
    }
    controls
      .querySelector('[data-recovery-manage]')
      .addEventListener('click', manage);
    controls
      .querySelector('[data-recovery-retry]')
      .addEventListener('click', () => {
        void recovery.retry();
      });
    return {
      status,
      refreshStatus: () => status(statusKey),
      async start(ready) {
        try {
          await ready;
          await show(true); // Discovery must work even if allocating a session is forbidden.
          await recovery.start();
        } catch {
          if (!recovery.state().pausedCode) status('unavailable');
        } finally {
          unlock();
        }
      },
      isLocked: () => locked,
      dismiss,
    };
  }
  root.SoapyPanels.project.recoveryUI = { createRecoveryUI };
})(window);
