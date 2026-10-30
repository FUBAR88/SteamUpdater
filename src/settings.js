const { app } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const USUAL_STEAM = 'C:\\Program Files (x86)\\Steam';

// The list AddonBuilder copies into the PBO as they are, without binarizing.
const DEFAULT_FILES = '*.emat;*.edds;*.ptc;*.c;*.imageset;*.layout;*.styles;*.ogg;*.png;*.paa;*.rvmat;*.wrp;*.xml;*.csv;*.json;*.fnt;*.ttf;*.wav;*.mp3;*.tga;*.html;*.txt;';

// How this copy runs: the portable exe, an installed copy, or the dev tool.
function mode() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return 'portable';
  }
  return app && app.isPackaged ? 'installed' : 'dev';
}

// An installed copy keeps its data out of the program folder, because the
// setup of the next version replaces that folder.
function rootDir() {
  const current = mode();
  if (current === 'portable') {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (current === 'installed') {
    return path.join(app.getPath('appData'), 'Steam Updater');
  }
  return path.resolve(__dirname, '..');
}

function defaultDataFolder() {
  if (mode() === 'installed') {
    return path.join(app.getPath('documents'), 'Steam Updater', 'MOD_DATA');
  }
  return path.join(rootDir(), 'MOD_DATA');
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

function findAddonBuilder(steamDir, publisherDir) {
  if (publisherDir) {
    const next = path.join(path.dirname(publisherDir), 'AddonBuilder', 'AddonBuilder.exe');
    if (fs.existsSync(next)) {
      return next;
    }
  }
  // The saved Steam folder first, then the one Steam itself reports.
  const libraries = [...libraryFolders(steamDir), ...libraryFolders(detectSteamDir())];
  for (let index = 0; index < libraries.length; index += 1) {
    const builder = path.join(libraries[index], 'steamapps', 'common', 'DayZ Tools', 'Bin', 'AddonBuilder', 'AddonBuilder.exe');
    if (fs.existsSync(builder)) {
      return builder;
    }
  }
  return '';
}

function defaults() {
  const dataFolder = defaultDataFolder();
  const steamDir = detectSteamDir();
  return {
    dataFolder,
    libraryFile: path.join(dataFolder, 'mods_data.json'),
    theme: 'neon',
    steamDir,
    publisherDir: detectPublisherDir(steamDir),
    addonBuilder: '',
    filesTemplate: DEFAULT_FILES,
    window: null,
    lastModId: ''
  };
}

let current = null;

// Last window position. Anything that is not a full set of numbers is dropped.
function cleanWindow(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const keys = ['x', 'y', 'width', 'height'];
  if (!keys.every((key) => Number.isFinite(value[key]))) {
    return null;
  }
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.round(value.width),
    height: Math.round(value.height),
    maximized: Boolean(value.maximized)
  };
}

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
      publisherDir: data.publisherDir || detectPublisherDir(steamDir) || base.publisherDir,
      addonBuilder: typeof data.addonBuilder === 'string' ? data.addonBuilder : '',
      filesTemplate: typeof data.filesTemplate === 'string' && data.filesTemplate.trim() ? data.filesTemplate : DEFAULT_FILES,
      window: cleanWindow(data.window),
      lastModId: typeof data.lastModId === 'string' ? data.lastModId : ''
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
  const addonBuilder = String((next && next.addonBuilder) || '').trim();
  if (addonBuilder && !fs.existsSync(addonBuilder)) {
    return 'AddonBuilder.exe was not found at that path. Leave the field empty to find it next to DayZ Tools.';
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
  next.addonBuilder = String(next.addonBuilder || '').trim();
  next.filesTemplate = String(next.filesTemplate || '').trim() || DEFAULT_FILES;
  next.window = cleanWindow(next.window);
  next.lastModId = typeof next.lastModId === 'string' ? next.lastModId : '';
  current = next;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  return current;
}

// AddonBuilder from DayZ Tools: next to the Publisher folder, else in a Steam library.
function detectAddonBuilder() {
  const current = get();
  return findAddonBuilder(current.steamDir, current.publisherDir);
}

module.exports = {
  DEFAULT_FILES,
  detectAddonBuilder,
  mode,
  get,
  update,
  problem
};
