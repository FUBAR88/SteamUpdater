const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const library = require('./library');
const files = require('./files');
const steam = require('./steam');
const workshop = require('./workshop');
const images = require('./images');
const settings = require('./settings');
const daylog = require('./daylog');

let mainWindow = null;

// Nearest folder that exists, walking up from the given path. Empty when none.
function existingFolder(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  let folder = path.resolve(value.trim());
  for (;;) {
    try {
      if (fs.statSync(folder).isDirectory()) {
        return folder;
      }
    } catch (_error) {
      // missing, try the parent
    }
    const parent = path.dirname(folder);
    if (parent === folder) {
      return '';
    }
    folder = parent;
  }
}

function sendProgress(line) {
  daylog.write(line);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('steam:progress', line);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#061018',
    title: 'Steam Updater',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  daylog.write('Steam Updater opened');
}

async function withWorkshopPage(row) {
  if (!row || !row.publishedId || row.status === 'missing' || row.status === 'empty') {
    return row;
  }
  try {
    const details = await images.fetchDetails([row.publishedId]);
    const detail = details[0] || {};
    if (detail.description) {
      row.description = detail.description;
    }
    if (detail.title && !row.title) {
      row.title = detail.title;
    }
    if (detail.visibility === 1) {
      row.visibility = 'friends';
    } else if (detail.visibility === 2) {
      row.visibility = 'private';
    } else if (detail.visibility === 0) {
      row.visibility = 'public';
    }
    if (Array.isArray(detail.tags)) {
      row.tags = detail.tags.map((tag) => (tag && tag.tag) || tag).filter(Boolean).join(', ');
    }
    const file = await images.downloadPreview(row.publishedId, detail.preview_url);
    if (file) {
      row.previewImage = file;
      sendProgress(`Preview ${path.basename(file)}`);
    }
  } catch (error) {
    sendProgress(`Workshop page ${row.publishedId}: ${error.message}`);
  }
  return row;
}

async function pullItems(items) {
  const imported = [];
  const missing = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const installed = workshop.findInstalled(item.publishedId);
    if (installed) {
      sendProgress(`Copying ${item.title || item.publishedId} into MOD_DATA`);
      const copied = await withWorkshopPage(await workshop.importItem(item, installed));
      imported.push(copied);
      library.rememberImported([copied]);
    } else {
      missing.push(item);
    }
  }

  if (missing.length === 0) {
    return imported;
  }

  sendProgress(`Asking Steam to download ${missing.length} workshop item${missing.length === 1 ? '' : 's'}.`);
  const fetched = await steam.runHelper(
    steam.buildFetchRequest(missing.map((item) => item.publishedId)),
    sendProgress,
    60 * 60 * 1000
  );
  const byId = new Map((fetched.items || []).map((item) => [String(item.publishedId), item]));
  for (let index = 0; index < missing.length; index += 1) {
    const item = missing[index];
    const row = byId.get(String(item.publishedId));
    if (row && row.installPath) {
      sendProgress(`Copying ${item.title || item.publishedId} into MOD_DATA`);
      const copied = await withWorkshopPage(await workshop.importItem(item, row.installPath));
      imported.push(copied);
      library.rememberImported([copied]);
    } else if (!fetched.ok) {
      imported.push(await workshop.importItem(item, ''));
      imported[imported.length - 1].error = fetched.error || imported[imported.length - 1].error;
    } else {
      const failed = await workshop.importItem(item, '');
      failed.error = (row && row.error) || failed.error;
      imported.push(failed);
    }
  }
  return imported;
}

app.whenReady().then(() => {
  ipcMain.handle('library:get', () => library.readLibrary());
  ipcMain.handle('library:save', (_event, payload) => {
    const mods = Array.isArray(payload) ? payload : payload.mods;
    const dismissed = Array.isArray(payload) ? undefined : payload.dismissed;
    return library.writeLibrary(mods, dismissed);
  });
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:save', (_event, partial) => {
    if (partial && (Object.prototype.hasOwnProperty.call(partial, 'steamDir') || Object.prototype.hasOwnProperty.call(partial, 'publisherDir'))) {
      const issue = settings.problem({ ...settings.get(), ...partial });
      if (issue) {
        throw new Error(issue);
      }
    }
    return settings.update(partial);
  });
  ipcMain.handle('preview:store', (_event, id, sourcePath) => {
    const file = images.storePreview(id, sourcePath);
    if (!file) {
      throw new Error('Could not store that preview in the Images folder.');
    }
    sendProgress(`Stored preview ${file}`);
    return file;
  });
  ipcMain.handle('preview:data', (_event, filePath) => {
    const file = path.resolve(String(filePath || ''));
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext];
    if (!mime || !fs.existsSync(file)) {
      return '';
    }
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  });
  ipcMain.handle('dialog:folder', async (_event, title, startPath) => {
    const options = {
      title: typeof title === 'string' && title.trim() ? title.trim() : 'Mod content folder',
      properties: ['openDirectory']
    };
    const start = existingFolder(startPath) || existingFolder(settings.get().dataFolder);
    if (start) {
      options.defaultPath = start;
    }
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('dialog:image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Preview image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }
      ]
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('dialog:mod-image', async (_event, title, startPath) => {
    const options = {
      title: typeof title === 'string' && title.trim() ? title.trim() : 'mod.cpp image',
      properties: ['openFile'],
      filters: [
        { name: 'DayZ textures', extensions: ['paa', 'edds'] }
      ]
    };
    const start = existingFolder(startPath) || existingFolder(settings.get().dataFolder);
    if (start) {
      options.defaultPath = start;
    }
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('dialog:library', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Library file',
      defaultPath: settings.get().libraryFile,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    return result.canceled ? '' : result.filePath;
  });
  ipcMain.handle('shell:open-mod', async (_event, mod) => {
    const root = path.resolve(settings.get().dataFolder);
    const content = mod && mod.contentFolder ? path.resolve(String(mod.contentFolder)) : '';
    const publishedId = mod && mod.workshop ? String(mod.workshop.publishedId || '').trim() : '';
    const idDir = /^\d+$/.test(publishedId) ? path.join(root, publishedId) : '';
    const target = content && fs.existsSync(content) ? content : idDir;
    const relative = target ? path.relative(root, target) : '';
    const inside = Boolean(target) && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    if (!inside || !fs.existsSync(target)) {
      throw new Error('That mod folder was not found inside the data folder.');
    }
    const error = await shell.openPath(target);
    if (error) {
      throw new Error(error);
    }
    return target;
  });
  ipcMain.handle('shell:open', (_event, url) => {
    const target = String(url || '');
    if (!/^https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+$/.test(target)) {
      throw new Error('That is not a workshop page.');
    }
    return shell.openExternal(target);
  });
  ipcMain.handle('files:write', (_event, mod) => files.writeModFiles(mod));
  ipcMain.handle('files:mod-image-path', (_event, file, folder) => files.modImagePath(file, folder));
  ipcMain.handle('files:signatures', (_event, folder) => files.checkSignatures(folder));
  ipcMain.handle('log:write', (_event, line) => {
    daylog.write(line);
    return true;
  });
  ipcMain.handle('steam:pull-all', async () => {
    sendProgress('Pull started');
    const listed = await steam.runHelper(steam.buildRequest('list'), sendProgress, 60000);
    if (!listed.ok) {
      sendProgress(`Pull failed. ${listed.error || 'Pull failed.'}`);
      return listed;
    }
    const dismissed = new Set((library.readLibrary().dismissed || []).map(String));
    const wanted = (listed.items || []).filter((item) => !dismissed.has(String(item.publishedId)));
    const imported = await pullItems(wanted);
    const kept = imported.filter((item) => item.status === 'copied' || item.status === 'kept').length;
    sendProgress(`Pull finished. ${kept} mods in the library, ${imported.length - kept} skipped.`);
    return { ...listed, imported };
  });
  ipcMain.handle('steam:upload', async (_event, mod) => {
    const workshop = (mod && mod.workshop) || {};
    const mode = mod && mod.uploadMode === 'contributor' ? 'contributor' : 'owner';
    const publishedId = String(workshop.publishedId || '').trim() || '(new)';
    sendProgress(`Push ${mod.displayName || workshop.title || 'mod'} ${publishedId} as ${mode}`);
    sendProgress(`Content folder ${mod.contentFolder || '(none)'}`);
    const page = `Workshop text (${String(workshop.description || '').length} characters), preview, and files are included.`;
    sendProgress(mode === 'contributor' ? `Contributor push. ${page}` : `Owner push. ${page}`);
    const previewId = String(workshop.publishedId || mod.id || '').trim();
    const storedPreview = images.storePreview(previewId, workshop.previewImage) || images.findPreview(workshop.publishedId);
    if (storedPreview) {
      mod.workshop = { ...mod.workshop, previewImage: storedPreview };
    }
    const privateKeys = mod.contentFolder && fs.existsSync(mod.contentFolder) ? files.findPrivateKeys(mod.contentFolder) : [];
    if (privateKeys.length > 0) {
      privateKeys.forEach((file) => sendProgress(`Private key in content folder: ${file}`));
      const blocked = 'Push stopped. Move the .biprivatekey file out of the content folder. Anyone could sign mods as you with it.';
      sendProgress(blocked);
      return { ok: false, error: blocked };
    }
    const written = files.writeModFiles(mod);
    sendProgress(written.modPath ? `Wrote ${written.modPath}` : 'mod.cpp already matches the form.');
    sendProgress(`Wrote ${written.metaPath}`);
    const result = await steam.runHelper(steam.buildRequest('upload', mod), sendProgress, 35 * 60 * 1000);
    if (result && result.ok) {
      sendProgress(`Push finished. Published id ${result.publishedId || publishedId}.`);
    } else {
      const name = result && result.errorName ? ` ${result.errorName}` : '';
      const code = result && result.steamErrorCode ? ` (${result.steamErrorCode})` : '';
      sendProgress(`Push failed. ${(result && result.error) || 'Upload failed.'}${name}${code}`);
    }
    if (result && result.publishedId) {
      const publishedPreview = images.storePreview(String(result.publishedId), mod.workshop && mod.workshop.previewImage);
      const updated = {
        ...mod,
        workshop: {
          ...mod.workshop,
          publishedId: String(result.publishedId),
          previewImage: publishedPreview || (mod.workshop && mod.workshop.previewImage) || ''
        }
      };
      result.mod = updated;
    }
    return result;
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
