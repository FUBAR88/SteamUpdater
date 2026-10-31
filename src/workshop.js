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
    detail: extra.detail || '',
    error: extra.error || ''
  };
}

// A directory under addons, such as addons\MyMod, is an unpacked source. The
// packed files that sit directly in addons are the mod.
function isUnpackedAddon(rel) {
  const parts = String(rel || '').split(/[/\\]/).filter(Boolean);
  const addonsAt = parts.findIndex((part) => part.toLowerCase() === 'addons');
  return addonsAt >= 0 && parts.length > addonsAt + 1;
}

function listFiles(root) {
  const files = new Map();
  if (!root || !fs.existsSync(root)) {
    return files;
  }
  const pending = [''];
  while (pending.length > 0) {
    const rel = pending.pop();
    const full = rel ? path.join(root, rel) : root;
    const entries = fs.readdirSync(full, { withFileTypes: true });
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!isUnpackedAddon(childRel)) {
          pending.push(childRel);
        }
      } else if (entry.isFile()) {
        const stat = fs.statSync(path.join(root, childRel));
        files.set(childRel.toLowerCase(), {
          rel: childRel,
          size: stat.size,
          mtimeMs: stat.mtimeMs
        });
      }
    }
  }
  return files;
}

function sameFile(left, right) {
  return left.size === right.size && Math.abs(left.mtimeMs - right.mtimeMs) < 1000;
}

function pruneEmpty(folder, root) {
  const entries = fs.readdirSync(folder, { withFileTypes: true });
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].isDirectory()) {
      pruneEmpty(path.join(folder, entries[index].name), root);
    }
  }
  if (path.resolve(folder) !== path.resolve(root) && fs.readdirSync(folder).length === 0) {
    fs.rmdirSync(folder);
  }
}

// Removes every directory inside an addons folder. PBOs and bisigns stay.
async function removeUnpackedAddons(dest) {
  let removed = 0;
  const pending = [dest];
  const addonDirs = [];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (let index = 0; index < entries.length; index += 1) {
      if (!entries[index].isDirectory()) {
        continue;
      }
      const full = path.join(current, entries[index].name);
      if (entries[index].name.toLowerCase() === 'addons') {
        addonDirs.push(full);
      } else {
        pending.push(full);
      }
    }
  }
  for (let index = 0; index < addonDirs.length; index += 1) {
    const children = fs.readdirSync(addonDirs[index], { withFileTypes: true });
    for (let child = 0; child < children.length; child += 1) {
      if (!children[child].isDirectory()) {
        continue;
      }
      await fs.promises.rm(path.join(addonDirs[index], children[child].name), { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

// Copies only files that differ, and removes files the workshop download no longer has.
async function syncTree(source, dest) {
  const sourceFiles = listFiles(source);
  const destFiles = listFiles(dest);
  let copied = 0;
  let removed = 0;
  const sourceEntries = Array.from(sourceFiles.values());
  for (let index = 0; index < sourceEntries.length; index += 1) {
    const info = sourceEntries[index];
    const current = destFiles.get(info.rel.toLowerCase());
    if (current && sameFile(current, info)) {
      continue;
    }
    const from = path.join(source, info.rel);
    const to = path.join(dest, info.rel);
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(from, to);
    const stat = fs.statSync(from);
    await fs.promises.utimes(to, stat.atime, stat.mtime);
    copied += 1;
  }
  const destEntries = Array.from(destFiles.values());
  for (let index = 0; index < destEntries.length; index += 1) {
    const info = destEntries[index];
    if (sourceFiles.has(info.rel.toLowerCase())) {
      continue;
    }
    await fs.promises.rm(path.join(dest, info.rel), { force: true });
    removed += 1;
  }
  if (removed > 0) {
    pruneEmpty(dest, dest);
  }
  return { copied, removed };
}

function syncDetail(diff) {
  const parts = [];
  if (diff.copied > 0) {
    parts.push(`${diff.copied} file${diff.copied === 1 ? '' : 's'} copied`);
  }
  if (diff.removed > 0) {
    parts.push(`${diff.removed} file${diff.removed === 1 ? '' : 's'} removed`);
  }
  if (diff.unpacked > 0) {
    parts.push(`${diff.unpacked} unpacked folder${diff.unpacked === 1 ? '' : 's'} removed`);
  }
  return parts.join(', ');
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

  if (!sourceDir || !hasFiles(sourceDir)) {
    return describe(item, 'missing', { error: 'Steam has not downloaded this workshop item yet.' });
  }
  if (!hasPayload(sourceDir)) {
    return describe(item, 'empty', { error: 'This workshop item has no files.' });
  }

  const metaName = readCppValue(path.join(sourceDir, 'meta.cpp'), 'name');
  const modName = safeName(metaName || item.title || publishedId);
  const existing = findContentRoot(idDir);
  const dest = existing || path.join(idDir, modName);
  if (!insideRoot(root, dest)) {
    return describe(item, 'missing', { error: 'Refusing to write outside MOD_DATA.' });
  }

  const named = () => {
    const modCpp = readModCpp(path.join(dest, 'mod.cpp'));
    return {
      contentFolder: dest,
      modName: readCppValue(path.join(dest, 'meta.cpp'), 'name') || modCpp.name || modName,
      modCpp
    };
  };

  if (!existing) {
    await fs.promises.cp(sourceDir, dest, { recursive: true });
    const unpacked = await removeUnpackedAddons(dest);
    return describe(item, 'copied', { ...named(), detail: syncDetail({ copied: 0, removed: 0, unpacked }) });
  }

  const diff = await syncTree(sourceDir, dest);
  diff.unpacked = await removeUnpackedAddons(dest);
  const info = named();
  if (diff.copied === 0 && diff.removed === 0 && diff.unpacked === 0) {
    return describe(item, 'unchanged', info);
  }
  return describe(item, 'updated', { ...info, detail: syncDetail(diff) });
}

module.exports = {
  findInstalled,
  importItem,
  modDataRoot
};
