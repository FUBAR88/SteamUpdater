const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  getLibrary() {
    return ipcRenderer.invoke('library:get');
  },
  saveLibrary(payload) {
    return ipcRenderer.invoke('library:save', payload);
  },
  getSettings() {
    return ipcRenderer.invoke('settings:get');
  },
  saveSettings(partial) {
    return ipcRenderer.invoke('settings:save', partial);
  },
  previewData(filePath) {
    return ipcRenderer.invoke('preview:data', filePath);
  },
  storePreview(id, sourcePath) {
    return ipcRenderer.invoke('preview:store', id, sourcePath);
  },
  chooseLibraryFile() {
    return ipcRenderer.invoke('dialog:library');
  },
  chooseFolder(title, startPath) {
    return ipcRenderer.invoke('dialog:folder', title, startPath);
  },
  chooseFile(title, startPath, kind) {
    return ipcRenderer.invoke('dialog:file', title, startPath, kind);
  },
  packTemplates() {
    return ipcRenderer.invoke('pack:templates');
  },
  savePackTemplates(payload) {
    return ipcRenderer.invoke('pack:templates-save', payload);
  },
  packPlan(template, only) {
    return ipcRenderer.invoke('pack:plan', template, only);
  },
  pack(template, only) {
    return ipcRenderer.invoke('pack:run', template, only);
  },
  onPackProgress(callback) {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('pack:progress', listener);
    return () => ipcRenderer.removeListener('pack:progress', listener);
  },
  chooseModImage(title, startPath) {
    return ipcRenderer.invoke('dialog:mod-image', title, startPath);
  },
  modImagePath(file, folder) {
    return ipcRenderer.invoke('files:mod-image-path', file, folder);
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file);
  },
  chooseImage() {
    return ipcRenderer.invoke('dialog:image');
  },
  writeFiles(mod) {
    return ipcRenderer.invoke('files:write', mod);
  },
  checkSignatures(folder) {
    return ipcRenderer.invoke('files:signatures', folder);
  },
  folderOf(target) {
    return ipcRenderer.invoke('files:folder-of', target);
  },
  openFolder(folder) {
    return ipcRenderer.invoke('shell:open-folder', folder);
  },
  workshopDetails(publishedId) {
    return ipcRenderer.invoke('workshop:details', publishedId);
  },
  workshopPreview(publishedId, previewUrl) {
    return ipcRenderer.invoke('workshop:preview', publishedId, previewUrl);
  },
  pullAll() {
    return ipcRenderer.invoke('steam:pull-all');
  },
  upload(mod) {
    return ipcRenderer.invoke('steam:upload', mod);
  },
  openExternal(url) {
    return ipcRenderer.invoke('shell:open', url);
  },
  openModFolder(mod) {
    return ipcRenderer.invoke('shell:open-mod', mod);
  },
  writeLog(line) {
    return ipcRenderer.invoke('log:write', line);
  },
  windowControl(action) {
    return ipcRenderer.invoke('window:control', action);
  },
  onWindowState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },
  onProgress(callback) {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('steam:progress', listener);
    return () => ipcRenderer.removeListener('steam:progress', listener);
  }
});
