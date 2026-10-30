const { app } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('./settings');

// The releases of this repository are where updates come from.
const OWNER = 'FUBAR88';
const REPO = 'SteamUpdater';
// STEAM_UPDATER_FEED points the check at a test server instead of GitHub.
const LATEST_URL = process.env.STEAM_UPDATER_FEED
  || `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases`;

// The installer and the portable exe are told apart by name.
const SETUP_ASSET = /^Steam[ .-]Updater[ .-]Setup[ .-].*\.exe$/i;
const PORTABLE_ASSET = /^Steam[ .-]Updater\.exe$/i;

const DOWNLOAD_ROOT = path.join(os.tmpdir(), 'SteamUpdater-update');

let downloading = false;

// The setup of the last update is done by the time the app runs again.
function cleanup() {
  try {
    fs.rmSync(DOWNLOAD_ROOT, { recursive: true, force: true });
  } catch (_error) {
    // still in use, the next start tries again
  }
}

function currentVersion() {
  return app.getVersion();
}

function versionParts(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!match) {
    return null;
  }
  return {
    numbers: [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)],
    pre: match[4] || ''
  };
}

// Positive when a is newer than b. A version without a pre-release tag beats
// the same version with one (1.2.0 > 1.2.0-beta).
function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) {
    return 0;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] - right.numbers[index];
    }
  }
  if (left.pre === right.pre) {
    return 0;
  }
  if (!left.pre) {
    return 1;
  }
  if (!right.pre) {
    return -1;
  }
  return left.pre < right.pre ? -1 : 1;
}

function pickAsset(assets, current) {
  const list = Array.isArray(assets) ? assets : [];
  const pattern = current === 'portable' ? PORTABLE_ASSET : SETUP_ASSET;
  const asset = list.find((item) => item && pattern.test(item.name || ''));
  if (!asset) {
    return null;
  }
  // GitHub reports "sha256:<hex>" for assets uploaded since mid 2025.
  const digest = typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(asset.digest)
    ? asset.digest.slice(7).toLowerCase()
    : '';
  return {
    name: asset.name,
    size: Number(asset.size) || 0,
    url: asset.browser_download_url,
    sha256: digest
  };
}

let lastCheck = null;

async function check() {
  const current = settings.mode();
  const response = await fetch(LATEST_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `SteamUpdater/${currentVersion()}`
    }
  });
  if (response.status === 404) {
    lastCheck = null;
    return {
      mode: current,
      current: currentVersion(),
      latest: '',
      newer: false,
      page: RELEASES_PAGE,
      message: 'There is no release on GitHub yet.'
    };
  }
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} ${response.statusText}.`);
  }
  const release = await response.json();
  const latest = String(release.tag_name || release.name || '').replace(/^v/i, '');
  const asset = pickAsset(release.assets, current);
  const result = {
    mode: current,
    current: currentVersion(),
    latest,
    newer: compareVersions(latest, currentVersion()) > 0,
    title: String(release.name || release.tag_name || ''),
    notes: String(release.body || ''),
    published: String(release.published_at || ''),
    page: typeof release.html_url === 'string' && release.html_url.startsWith(RELEASES_PAGE) ? release.html_url : RELEASES_PAGE,
    asset
  };
  lastCheck = result;
  return result;
}

async function download(asset, folder, progress) {
  const response = await fetch(asset.url, {
    headers: { 'User-Agent': `SteamUpdater/${currentVersion()}` },
    redirect: 'follow'
  });
  if (!response.ok || !response.body) {
    throw new Error(`The download failed: ${response.status} ${response.statusText}.`);
  }
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, asset.name);
  const partial = `${target}.part`;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(partial);
  const total = asset.size || Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let lastPercent = -1;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) {
        await new Promise((resolve) => out.once('drain', resolve));
      }
      const percent = total ? Math.floor((received / total) * 100) : -1;
      if (percent !== lastPercent) {
        lastPercent = percent;
        progress({ received, total, percent });
      }
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }
  if (asset.size && received !== asset.size) {
    fs.rmSync(partial, { force: true });
    throw new Error(`The download is incomplete: ${received} of ${asset.size} bytes.`);
  }
  const sha256 = hash.digest('hex');
  if (asset.sha256 && sha256 !== asset.sha256) {
    fs.rmSync(partial, { force: true });
    throw new Error('The download does not match the checksum GitHub lists for it.');
  }
  fs.rmSync(target, { force: true });
  fs.renameSync(partial, target);
  return target;
}

// The running portable exe is locked, so a small script swaps it once this
// process is gone and then starts the new one.
function swapPortable(downloaded) {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
    || path.join(process.env.PORTABLE_EXECUTABLE_DIR || '', 'Steam Updater.exe');
  const script = path.join(path.dirname(downloaded), 'swap.cmd');
  const lines = [
    '@echo off',
    'set tries=0',
    ':retry',
    'timeout /t 1 /nobreak >nul',
    `move /y "${downloaded}" "${exe}" >nul 2>&1`,
    'if not errorlevel 1 goto started',
    'set /a tries+=1',
    'if %tries% lss 60 goto retry',
    'exit /b 1',
    ':started',
    `start "" "${exe}"`,
    'del "%~f0"'
  ];
  fs.writeFileSync(script, `${lines.join('\r\n')}\r\n`, 'utf8');
  const child = spawn('cmd.exe', ['/d', '/c', script], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function runSetup(downloaded) {
  // The same switches electron-updater passes: /S installs quietly into the
  // folder of the copy that runs now, --updated keeps the shortcuts as they
  // are, --force-run starts the app again when the setup is done.
  const child = spawn(downloaded, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function install(progress) {
  if (downloading) {
    throw new Error('An update is already downloading.');
  }
  const current = settings.mode();
  if (current === 'dev') {
    throw new Error('The dev tool updates with git pull, not from a release.');
  }
  const info = lastCheck && lastCheck.newer ? lastCheck : await check();
  if (!info.newer) {
    throw new Error(`Version ${info.current} is already the newest.`);
  }
  if (!info.asset || !info.asset.url) {
    throw new Error(`Release ${info.latest} has no ${current === 'portable' ? 'portable exe' : 'setup'} to download.`);
  }
  downloading = true;
  try {
    const folder = path.join(DOWNLOAD_ROOT, info.latest);
    const downloaded = await download(info.asset, folder, progress);
    if (current === 'portable') {
      swapPortable(downloaded);
    } else {
      runSetup(downloaded);
    }
    setTimeout(() => app.quit(), 300);
    return { version: info.latest, file: downloaded };
  } finally {
    downloading = false;
  }
}

module.exports = {
  RELEASES_PAGE,
  check,
  cleanup,
  compareVersions,
  install
};
