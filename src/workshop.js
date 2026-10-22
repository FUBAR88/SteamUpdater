const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const DAYZ_APP_ID = '221100';

function modDataRoot() {
  return path.resolve(settings.get().dataFolder);
}

function workshopRoots() {
  const roots = [];
  const steamDir = settings.get().steamDir;
  const libraryFile = steamDir ? path.join(steamDir, 'steamapps', 'libraryfolders.vdf') : '';
  if (libraryFile && fs.existsSync(libraryFile)) {
    const text = fs.readFileSync(libraryFile, 'utf8');
    const pattern = /"path"\s+"([^"]+)"/g;
    let match = pattern.exec(text);
    while (match) {
      const folder = match[1].replace(/\\\\/g, '\\');
      roots.push(path.join(folder, 'steamapps', 'workshop', 'content', DAYZ_APP_ID));
      match = pattern.exec(text);
    }
  }
  if (roots.length === 0 && steamDir) {
    roots.push(path.join(steamDir, 'steamapps', 'workshop', 'content', DAYZ_APP_ID));
  }
  return roots;
}

function safeName(value) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  return cleaned || 'mod';
}

function insideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasPayload(folder) {
  if (!folder || !fs.existsSync(folder)) {
    return false;
  }
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase() !== 'meta.cpp') {
        return true;
      }
    }
  }
  return false;
}

function hasFiles(folder) {
  if (!folder || !fs.existsSync(folder)) {
    return false;
  }
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        return true;
      }
    }
  }
  return false;
}

function readCppValue(file, key) {
  if (!fs.existsSync(file)) {
    return '';
  }
  const text = fs.readFileSync(file, 'utf8');
  const quoted = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*;`, 'm');
  const bare = new RegExp(`^\\s*${key}\\s*=\\s*([^;]+);`, 'm');
  const match = text.match(quoted) || text.match(bare);
  return match ? match[1].trim() : '';
}

function readModCpp(file) {
  const keys = [
    'name', 'picture', 'logo', 'logoSmall', 'logoOver', 'tooltip',
    'overview', 'action', 'author', 'authorID', 'version'
  ];
  const values = {};
  keys.forEach((key) => {
    const value = readCppValue(file, key);
    if (value) {
      values[key] = value;
    }
  });
  return values;
}

function isModRoot(folder) {
  return fs.existsSync(path.join(folder, 'meta.cpp'))
    || fs.existsSync(path.join(folder, 'mod.cpp'))
    || fs.existsSync(path.join(folder, 'addons'));
}

function findContentRoot(idDir) {
  if (!fs.existsSync(idDir)) {
    return '';
  }
  if (isModRoot(idDir)) {
    return idDir;
  }
  const children = fs.readdirSync(idDir, { withFileTypes: true });
  for (let index = 0; index < children.length; index += 1) {
    if (!children[index].isDirectory()) {
      continue;
    }
    const full = path.join(idDir, children[index].name);
    if (isModRoot(full)) {
      return full;
    }
  }
  return '';
}

function findInstalled(publishedId) {
  const id = String(publishedId || '').trim();
  if (!/^\d+$/.test(id)) {
    return '';
  }
  const roots = workshopRoots();
  for (let index = 0; index < roots.length; index += 1) {
    const folder = path.join(roots[index], id);
    if (hasFiles(folder)) {
      return folder;
    }
  }
  return '';
}

function describe(item, status, extra) {
  return {
    publishedId: String(item.publishedId || ''),
    title: item.title || '',
    author: item.author || '',
    authorId: item.authorId || '',
    hiddenByPublisher: Boolean(item.hiddenByPublisher),
    status,
    contentFolder: extra.contentFolder || '',
    modName: extra.modName || '',
    modCpp: extra.modCpp || {},
    error: extra.error || ''
  };
}

async function importItem(item, sourceDir) {
  const publishedId = String(item.publishedId || '').trim();
  if (!/^\d+$/.test(publishedId)) {
    return describe(item, 'missing', { error: 'Published file id must be a number.' });
  }

  const root = modDataRoot();
  const idDir = path.join(root, publishedId);
  if (!insideRoot(root, idDir)) {
    return describe(item, 'missing', { error: 'Refusing to write outside MOD_DATA.' });
  }

  const existing = findContentRoot(idDir);
  if (existing) {
    const modCpp = readModCpp(path.join(existing, 'mod.cpp'));
    const modName = readCppValue(path.join(existing, 'meta.cpp'), 'name') || modCpp.name || item.title || publishedId;
    return describe(item, 'kept', { contentFolder: existing, modName, modCpp });
  }

  if (!sourceDir || !hasFiles(sourceDir)) {
    return describe(item, 'missing', { error: 'Steam has not downloaded this workshop item yet.' });
  }
  if (!hasPayload(sourceDir)) {
    return describe(item, 'empty', { error: 'This workshop item has no files.' });
  }

  const metaName = readCppValue(path.join(sourceDir, 'meta.cpp'), 'name');
  const modName = safeName(metaName || item.title || publishedId);
  const dest = path.join(idDir, modName);
  if (!insideRoot(root, dest)) {
    return describe(item, 'missing', { error: 'Refusing to write outside MOD_DATA.' });
  }

  await fs.promises.cp(sourceDir, dest, { recursive: true });
  const modCpp = readModCpp(path.join(dest, 'mod.cpp'));
  return describe(item, 'copied', {
    contentFolder: dest,
    modName: readCppValue(path.join(dest, 'meta.cpp'), 'name') || modCpp.name || modName,
    modCpp
  });
}

module.exports = {
  findInstalled,
  importItem,
  modDataRoot
};
