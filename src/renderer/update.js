// Update button in the title bar: asks GitHub for the newest release and
// installs it. The check on start only lights the dot, it never downloads.
(() => {
  const openButton = document.querySelector('#update-open');
  const versionLabel = document.querySelector('#update-version');
  const dot = document.querySelector('#update-dot');
  const modal = document.querySelector('#update-modal');
  const status = document.querySelector('#update-status');
  const notes = document.querySelector('#update-notes');
  const progress = document.querySelector('#update-progress');
  const bar = document.querySelector('#update-bar');
  const pageButton = document.querySelector('#update-page');
  const recheckButton = document.querySelector('#update-recheck');
  const closeButton = document.querySelector('#update-close');
  const installButton = document.querySelector('#update-install');

  let info = { version: '', mode: 'dev' };
  let result = null;
  let checking = false;
  let installing = false;

  function megabytes(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function showResult() {
    notes.hidden = true;
    installButton.hidden = true;
    if (!result) {
      return;
    }
    dot.hidden = !result.newer;
    openButton.title = result.newer ? `Version ${result.latest} is available` : 'Check for updates';
    if (!result.latest) {
      status.textContent = `${result.message} This is version ${result.current}.`;
      return;
    }
    if (!result.newer) {
      status.textContent = `Version ${result.current} is up to date. The newest release is ${result.latest}.`;
      return;
    }
    const lines = [`Version ${result.latest} is available. This is version ${result.current}.`];
    if (result.mode === 'dev') {
      lines.push('The dev tool updates with git pull.');
    } else if (!result.asset) {
      lines.push(`The release has no ${result.mode === 'portable' ? 'portable exe' : 'setup'} yet. Open the release page.`);
    } else {
      lines.push(result.mode === 'portable'
        ? `Update now downloads the new exe (${megabytes(result.asset.size)}), replaces this one and starts it.`
        : `Update now downloads the setup (${megabytes(result.asset.size)}), closes the app, installs and starts it again.`);
      installButton.hidden = false;
    }
    status.textContent = lines.join(' ');
    if (result.notes.trim()) {
      notes.textContent = result.notes.trim();
      notes.hidden = false;
    }
  }

  async function runCheck(quiet) {
    if (checking || installing) {
      return;
    }
    checking = true;
    recheckButton.disabled = true;
    if (!quiet) {
      status.textContent = 'Checking GitHub…';
      notes.hidden = true;
      installButton.hidden = true;
    }
    try {
      result = await window.updater.checkUpdate();
      showResult();
    } catch (error) {
      if (!quiet) {
        status.textContent = `The check failed. ${error.message || error}`;
      }
    } finally {
      checking = false;
      recheckButton.disabled = false;
    }
  }

  function open() {
    modal.hidden = false;
    if (result && !checking) {
      showResult();
    }
    runCheck(false);
  }

  function close() {
    if (!installing) {
      modal.hidden = true;
    }
  }

  async function install() {
    if (installing) {
      return;
    }
    installing = true;
    installButton.disabled = true;
    recheckButton.disabled = true;
    closeButton.disabled = true;
    progress.hidden = false;
    bar.style.width = '0%';
    status.textContent = `Downloading ${result.latest}…`;
    try {
      await window.updater.installUpdate();
      bar.style.width = '100%';
      status.textContent = 'Download complete. The app closes now and comes back updated.';
    } catch (error) {
      status.textContent = `The update failed. ${error.message || error}`;
      progress.hidden = true;
      installing = false;
      installButton.disabled = false;
      recheckButton.disabled = false;
      closeButton.disabled = false;
    }
  }

  window.updater.onUpdateProgress((step) => {
    if (step.percent >= 0) {
      bar.style.width = `${step.percent}%`;
      status.textContent = `Downloading ${result ? result.latest : 'the update'}… ${step.percent}% (${megabytes(step.received)} of ${megabytes(step.total)})`;
    } else {
      status.textContent = `Downloading… ${megabytes(step.received)}`;
    }
  });

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  recheckButton.addEventListener('click', () => runCheck(false));
  installButton.addEventListener('click', install);
  pageButton.addEventListener('click', () => {
    window.updater.openReleasePage((result && result.page) || 'https://github.com/FUBAR88/SteamUpdater/releases');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      close();
    }
  });

  window.updater.appInfo().then((app) => {
    info = app;
    versionLabel.textContent = `v${info.version}`;
    // Quietly, once per start, so the dot shows when there is something new.
    runCheck(true);
  });
})();
