const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const USUAL_STEAM = 'C:\\Program Files (x86)\\Steam';

function rootDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  return path.resolve(__dirname, '..');
}

function settingsFile() {
  return path.join(rootDir(), 'settings.json');
}

function readRegistry(key, name) {
  try {
    const output = execFileSync('reg', ['query', key, '/v', name], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = output.match(/REG_\w+\s+(.*)/);
    return match ? match[1].trim().replace(/\//g, '\\') : '';
  } catch (error) {
    return '';
  }
}

function hasSteamExe(folder) {
  return Boolean(folder) && fs.existsSync(path.join(folder, 'steam.exe'));
}

function detectSteamDir() {
  const fromUser = readRegistry('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (hasSteamExe(fromUser)) {
    return fromUser;
  }
  const fromMachine = readRegistry('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (hasSteamExe(fromMachine)) {
    return fromMachine;
  }
  if (hasSteamExe(USUAL_STEAM)) {
    return USUAL_STEAM;
  }
  return '';
}

function libraryFolders(steamDir) {
  const folders = [];
  if (!steamDir) {
    return folders;
  }
  const file = path.join(steamDir, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /"path"\s+"([^"]+)"/g;
    let match = pattern.exec(text);
    while (match) {
      folders.push(match[1].replace(/\\\\/g, '\\'));
      match = pattern.exec(text);
    }
  }
  const known = folders.some((folder) => path.resolve(folder).toLowerCase() === path.resolve(steamDir).toLowerCase());
  if (!known) {
    folders.unshift(steamDir);
  }
  return folders;
}

function detectPublisherDir(steamDir) {
  const libraries = libraryFolders(steamDir);
  for (let index = 0; index < libraries.length; index += 1) {
    const publisher = path.join(libraries[index], 'steamapps', 'common', 'DayZ Tools', 'Bin', 'Publisher');
    if (fs.existsSync(path.join(publisher, 'SteamLayerWrap.dll'))) {
      return publisher;
    }
  }
  return '';
}

function defaults() {
  const dataFolder = path.join(rootDir(), 'MOD_DATA');
  const steamDir = detectSteamDir();
  return {
    dataFolder,
    libraryFile: path.join(dataFolder, 'mods_data.json'),
    theme: 'neon',
    steamDir,
    publisherDir: detectPublisherDir(steamDir)
  };
}

let current = null;

function read() {
  const base = defaults();
  const file = settingsFile();
  if (!fs.existsSync(file)) {
    return base;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const steamDir = data.steamDir || base.steamDir;
    return {
      dataFolder: data.dataFolder || base.dataFolder,
      libraryFile: data.libraryFile || base.libraryFile,
      theme: data.theme === 'light' ? 'light' : 'neon',
      steamDir,
      publisherDir: data.publisherDir || detectPublisherDir(steamDir) || base.publisherDir
    };
  } catch (error) {
    return base;
  }
}

function get() {
  if (!current) {
    current = read();
    const file = settingsFile();
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');
    }
  }
  return current;
}

function problem(next) {
  const steamDir = String((next && next.steamDir) || '').trim();
  const publisherDir = String((next && next.publisherDir) || '').trim();
  if (!hasSteamExe(steamDir)) {
    return 'The Steam folder must contain steam.exe.';
  }
  if (!publisherDir || !fs.existsSync(path.join(publisherDir, 'SteamLayerWrap.dll'))) {
    return 'The DayZ Publisher folder must contain SteamLayerWrap.dll.';
  }
  return '';
}

function update(partial) {
  const next = { ...get(), ...(partial || {}) };
  if (next.theme !== 'light') {
    next.theme = 'neon';
  }
  next.steamDir = String(next.steamDir || '').trim();
  next.publisherDir = String(next.publisherDir || '').trim();
  current = next;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  return current;
}

module.exports = {
  get,
  update,
  problem
};
