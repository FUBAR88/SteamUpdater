const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

function libraryFile() {
  return path.resolve(settings.get().libraryFile);
}

function readLibrary() {
  const file = libraryFile();
  if (!fs.existsSync(file)) {
    return { mods: [], dismissed: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || !Array.isArray(data.mods)) {
      throw new Error('mods_data.json is missing a mods array.');
    }
    return {
      mods: data.mods,
      dismissed: Array.isArray(data.dismissed) ? data.dismissed.map(String) : []
    };
  } catch (error) {
    const backup = `${file}.bak`;
    fs.copyFileSync(file, backup);
    return {
      mods: [],
      dismissed: [],
      warning: `Could not read the mod library. A copy was saved to ${backup}. ${error.message}`
    };
  }
}

function blankMod(name) {
  return {
    id: crypto.randomUUID(),
    displayName: name || 'New mod',
    contentFolder: '',
    uploadMode: 'normal',
    role: 'owner',
    workshop: {
      title: '',
      description: '',
      changeNote: '',
      visibility: 'public',
      tags: '',
      previewImage: '',
      publishedId: ''
    },
    modCpp: {
      name: '',
      picture: '',
      logo: '',
      logoSmall: '',
      logoOver: '',
      tooltip: '',
      overview: '',
      action: '',
      author: '',
      authorID: '',
      version: '1.0.0'
    }
  };
}

function rememberImported(rows) {
  const mods = readLibrary().mods.slice();
  (rows || []).forEach((row) => {
    if (!row || !row.publishedId || row.status === 'missing' || row.status === 'empty') {
      return;
    }
    const role = row.hiddenByPublisher ? 'contributor' : 'owner';
    let mod = mods.find((item) => item.workshop && item.workshop.publishedId === row.publishedId);
    if (!mod) {
      mod = blankMod(row.title || row.modName || row.publishedId);
      mod.role = role;
      mod.uploadMode = role === 'contributor' ? 'contributor' : 'normal';
      mod.workshop.title = row.title || '';
      mod.workshop.publishedId = String(row.publishedId);
      mod.workshop.description = row.description || '';
      mod.workshop.visibility = row.visibility || 'public';
      mod.workshop.tags = row.tags || '';
      mods.push(mod);
    } else {
      mod.role = role;
      if (row.title && (!mod.workshop.title || mod.displayName === 'New mod')) {
        mod.workshop.title = row.title;
      }
      if (row.title && (!mod.displayName || mod.displayName === 'New mod')) {
        mod.displayName = row.title;
      }
    }
    if (row.contentFolder && !mod.contentFolder) {
      mod.contentFolder = row.contentFolder;
    }
    if (row.previewImage) {
      mod.workshop.previewImage = row.previewImage;
    }
    if (row.description && !mod.workshop.description) {
      mod.workshop.description = row.description;
    }
    if (row.tags && !mod.workshop.tags) {
      mod.workshop.tags = row.tags;
    }
    if (row.visibility && row.visibility !== 'public' && mod.workshop.visibility === 'public') {
      mod.workshop.visibility = row.visibility;
    }
    if (row.modName && !mod.modCpp.name) {
      mod.modCpp.name = row.modName;
    }
    Object.keys(row.modCpp || {}).forEach((key) => {
      if (row.modCpp[key] && !mod.modCpp[key]) {
        mod.modCpp[key] = row.modCpp[key];
      }
    });
  });
  writeLibrary(mods);
  return mods;
}

function writeLibrary(mods, dismissed) {
  if (!Array.isArray(mods)) {
    throw new Error('The mod library must be a list.');
  }
  const file = libraryFile();
  let kept = [];
  if (!Array.isArray(dismissed) && fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      kept = Array.isArray(existing.dismissed) ? existing.dismissed.map(String) : [];
    } catch (error) {
      kept = [];
    }
  }
  const nextDismissed = Array.isArray(dismissed) ? dismissed.map(String) : kept;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = JSON.stringify({ mods, dismissed: nextDismissed }, null, 2);
  fs.writeFileSync(file, body, 'utf8');
  return { mods, dismissed: nextDismissed };
}

module.exports = {
  readLibrary,
  rememberImported,
  writeLibrary
};
