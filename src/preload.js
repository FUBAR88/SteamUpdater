const { contextBridge, ipcRenderer } = require('electron');

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
  chooseFolder(title) {
    return ipcRenderer.invoke('dialog:folder', title);
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
  onProgress(callback) {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('steam:progress', listener);
    return () => ipcRenderer.removeListener('steam:progress', listener);
  }
});
