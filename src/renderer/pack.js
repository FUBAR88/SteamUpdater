// Pack view: templates on the left, what to pack in the middle, where it goes on the
// right. Packing runs AddonBuilder in the main process (src/packer.js) and writes the
// PBOs straight into a mod folder of this app, so nothing is copied by hand.

const packView = document.querySelector('#pack-view');
const appView = document.querySelector('.app');
const packList = document.querySelector('#pack-template-list');
const packRows = document.querySelector('#pack-rows');
const packLog = document.querySelector('#pack-log');
const packSummary = document.querySelector('#pack-summary');
const extraPboList = document.querySelector('#extra-pbo-list');
const packRun = document.querySelector('#pack-run');
const packFields = {
  name: document.querySelector('#pack-name'),
  note: document.querySelector('#pack-note'),
  files: document.querySelector('#pack-files'),
  excludeFile: document.querySelector('#pack-exclude-file'),
  excludePatterns: document.querySelector('#pack-exclude'),
  destination: document.querySelector('#pack-destination'),
  addonsFolder: document.querySelector('#pack-addons'),
  keysFolder: document.querySelector('#pack-keys'),
  privateKey: document.querySelector('#pack-private-key'),
  publicKey: document.querySelector('#pack-public-key')
};
const packBinarize = document.querySelector('#pack-binarize');
const packFilesDefault = document.querySelector('#pack-files-default');
// Same list as settings.js DEFAULT_FILES. AddonBuilder copies these into the PBO as they are.
const DEFAULT_PACK_FILES = '*.emat;*.edds;*.ptc;*.c;*.imageset;*.layout;*.styles;*.ogg;*.png;*.paa;*.rvmat;*.wrp;*.xml;*.csv;*.json;*.fnt;*.ttf;*.wav;*.mp3;*.tga;*.html;*.txt;';
const packLinked = document.querySelector('#pack-linked');

let packTemplates = [];
let packSelectedId = '';
let packBusy = false;
let packSaveTimer = 0;
let packPlanTimer = 0;
let packPlan = null;
let packLastResult = null;
let packLoaded = false;

function packId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function packSelected() {
  return packTemplates.find((template) => template.id === packSelectedId) || null;
}

function packAppendLog(line) {
  packLog.textContent = `${packLog.textContent}${packLog.textContent ? '\n' : ''}${line}`;
  packLog.scrollTop = packLog.scrollHeight;
}

function blankTemplate(name) {
  return {
    id: packId(),
    name: name || 'New template',
    note: '',
    builtin: false,
    destination: '',
    addonsFolder: 'addons',
    keysFolder: 'keys',
    privateKey: '',
    publicKey: '',
    excludeFile: '',
    excludePatterns: '',
    files: '',
    binarize: false,
    linkedModId: '',
    resign: [],
    packs: [{ id: packId(), enabled: true, source: '', prefix: '', strip: '', stripOn: false }]
  };
}

function cloneTemplate(template, name, note) {
  const copy = JSON.parse(JSON.stringify(template));
  copy.id = packId();
  copy.name = name;
  copy.note = note;
  copy.builtin = false;
  copy.packs = (copy.packs || []).map((pack) => ({ ...pack, id: packId() }));
  return copy;
}

// ---- view switch -------------------------------------------------------------

function setView(view) {
  const next = view === 'pack' ? 'pack' : 'workshop';
  const changed = document.body.dataset.view !== next;
  document.body.dataset.view = next;
  appView.hidden = next === 'pack';
  packView.hidden = next !== 'pack';
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === next);
  });
  try {
    window.localStorage.setItem('steam-updater-view', next);
  } catch (_error) {
    // The view only falls back to Workshop next time.
  }
  if (changed) {
    refreshWindow();
    return;
  }
  if (next === 'pack') {
    if (!packLoaded) {
      loadPackTemplates();
    } else {
      renderLinked();
      schedulePlan();
    }
  }
}

async function refreshWindow() {
  const button = document.querySelector('#window-refresh');
  if (!button || button.disabled || packBusy) {
    return;
  }
  button.disabled = true;
  try {
    window.clearTimeout(packSaveTimer);
    await loadLibrary();
    await loadPackTemplates();
    packScanKey = '';
    await refreshExtraPbos(true);
    if (typeof checkFolder === 'function') {
      await checkFolder({ quiet: true });
    }
  } catch (error) {
    const message = typeof ipcMessage === 'function' ? ipcMessage(error) : error.message;
    if (typeof appendLog === 'function') {
      appendLog(message);
    }
  } finally {
    button.disabled = false;
  }
}

document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => setView(tab.dataset.view));
});

document.querySelector('#window-refresh').addEventListener('click', () => refreshWindow());

// ---- load and save -----------------------------------------------------------

async function loadPackTemplates() {
  window.clearTimeout(packSaveTimer);
  try {
    const data = await window.updater.packTemplates();
    packTemplates = data.templates || [];
    packSelectedId = data.selectedId || '';
    if (!packSelected() && packTemplates.length) {
      packSelectedId = packTemplates[0].id;
    }
    packLoaded = true;
    renderPackList();
    fillPackForm();
  } catch (error) {
    packAppendLog(ipcMessage(error));
  }
}

function queuePackSave() {
  window.clearTimeout(packSaveTimer);
  packSaveTimer = window.setTimeout(savePackTemplates, 400);
}

async function savePackTemplates() {
  window.clearTimeout(packSaveTimer);
  try {
    await window.updater.savePackTemplates({ templates: packTemplates, selectedId: packSelectedId });
  } catch (error) {
    packAppendLog(`Could not save the templates. ${ipcMessage(error)}`);
  }
}

// ---- template list -----------------------------------------------------------

function renderPackList() {
  packList.textContent = '';
  packTemplates.forEach((template) => {
    const row = document.createElement('div');
    row.className = `mod-row${template.id === packSelectedId ? ' active' : ''}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mod-select';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = template.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const role = document.createElement('span');
    role.className = 'role';
    const count = (template.packs || []).length;
    role.textContent = `${template.builtin ? 'Built-in · ' : ''}${count} pack${count === 1 ? '' : 's'}`;
    meta.append(role);
    button.append(name, meta);
    if (template.note) {
      button.title = template.note;
    }
    button.addEventListener('click', () => {
      if (packBusy || template.id === packSelectedId) {
        return;
      }
      packSelectedId = template.id;
      packLastResult = null;
      renderPackList();
      fillPackForm();
      queuePackSave();
    });
    row.append(button);
    packList.append(row);
  });
  const current = packSelected();
  document.querySelector('#pack-delete').disabled = packBusy || !current || current.builtin;
  document.querySelector('#pack-save-as').disabled = packBusy || !current;
}

// ---- form --------------------------------------------------------------------

function packLocked(template) {
  return Boolean(template && template.builtin);
}

function fillPackForm() {
  const template = packSelected();
  const disabled = !template || packLocked(template) || packBusy;
  Object.entries(packFields).forEach(([key, input]) => {
    input.value = template ? String(template[key] || '') : '';
    input.disabled = disabled;
  });
  packFields.files.placeholder = '';
  window.updater.getSettings().then((current) => {
    packFields.files.placeholder = `Settings: ${current.filesTemplate || ''}`;
  }).catch(() => {});
  packBinarize.classList.toggle('is-on', Boolean(template && template.binarize));
  packBinarize.setAttribute('aria-checked', template && template.binarize ? 'true' : 'false');
  packBinarize.disabled = disabled;
  document.querySelector('#pack-builtin-hint').hidden = !packLocked(template);
  ['#pack-add', '#pack-check-all', '#pack-uncheck-all', '#pack-files-default', '#pack-exclude-file-browse', '#pack-destination-browse', '#pack-private-key-browse', '#pack-public-key-browse'].forEach((selector) => {
    document.querySelector(selector).disabled = disabled;
  });
  packLinked.disabled = disabled;
  renderRows();
  renderLinked();
  renderPackActions();
  schedulePlan();
  refreshExtraPbos();
}

function renderPackActions() {
  const template = packSelected();
  packRun.disabled = packBusy || !template;
  packRun.textContent = packBusy ? 'Packing…' : 'Pack';
  const linked = linkedMod(template);
  document.querySelector('#pack-goto-mod').hidden = !linked;
}

Object.entries(packFields).forEach(([key, input]) => {
  input.addEventListener('input', () => {
    const template = packSelected();
    if (!template || packLocked(template)) {
      return;
    }
    template[key] = input.value;
    if (key === 'name') {
      renderPackList();
    }
    if (key === 'destination') {
      template.linkedModId = '';
      renderLinked();
    }
    queuePackSave();
    schedulePlan();
  });
});

packFilesDefault.addEventListener('click', () => {
  const template = packSelected();
  if (!template || packLocked(template) || packBusy) {
    return;
  }
  packFields.files.value = DEFAULT_PACK_FILES;
  template.files = DEFAULT_PACK_FILES;
  queuePackSave();
  schedulePlan();
});

packBinarize.addEventListener('click', () => {
  const template = packSelected();
  if (!template || packLocked(template) || packBusy) {
    return;
  }
  template.binarize = !template.binarize;
  packBinarize.classList.toggle('is-on', template.binarize);
  packBinarize.setAttribute('aria-checked', template.binarize ? 'true' : 'false');
  queuePackSave();
});

// ---- pack rows ---------------------------------------------------------------

const ICON_FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6z"/></svg>';
const ICON_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-6.3 6.3-1.4-1.4L17.6 5H14V3zM4 6a2 2 0 0 1 2-2h5v2H6v12h12v-5h2v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/></svg>';
const ICON_PACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 3 6.5v11L12 22l9-4.5v-11L12 2zm0 2.2 6.6 3.3L12 10.8 5.4 7.5 12 4.2zM5 9.1l6 3v7.6l-6-3V9.1zm8 10.6v-7.6l6-3v7.6l-6 3z"/></svg>';
const ICON_REMOVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2zM4 5h16v2H4V5z"/></svg>';
const ICON_RESIGN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.5 3.5a4.5 4.5 0 0 0-4.2 6.1L4 16v4h4l6.4-6.3A4.5 4.5 0 1 0 14.5 3.5zm1.2 3.8a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/></svg>';
const ICON_SETTINGS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 7h10v2H4V7zm12 0h4v2h-4V7zM10 5h4v6h-4V5zM4 15h4v2H4v-2zm6 0h10v2H10v-2zM8 13h4v6H8v-6z"/></svg>';

function iconButton(icon, title, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon${className ? ` ${className}` : ''}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = icon;
  return button;
}

function renderRows() {
  const template = packSelected();
  packRows.textContent = '';
  if (!template) {
    return;
  }
  const locked = packLocked(template) || packBusy;
  if (!template.packs.length) {
    const none = document.createElement('p');
    none.className = 'hint';
    none.textContent = 'No pack folders yet. Add one or drop folders here.';
    packRows.append(none);
  }
  template.packs.forEach((pack) => {
    const row = document.createElement('div');
    row.className = 'pack-row';
    row.dataset.packId = pack.id;

    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'pack-tick';
    tick.checked = pack.enabled !== false;
    tick.title = 'Pack this folder with the Pack button';
    tick.disabled = locked;
    tick.addEventListener('change', () => {
      pack.enabled = tick.checked;
      queuePackSave();
      schedulePlan();
    });

    const source = document.createElement('input');
    source.type = 'text';
    source.className = 'pack-source';
    source.spellcheck = false;
    source.autocomplete = 'off';
    source.placeholder = 'Source folder, e.g. c:\\Temp\\Build\\Rev_Core';
    source.value = pack.source || '';
    source.disabled = locked;
    source.addEventListener('input', () => {
      pack.source = source.value;
      queuePackSave();
      schedulePlan();
    });

    const browse = iconButton(ICON_FOLDER, 'Choose source folder');
    browse.disabled = locked;
    browse.addEventListener('click', async () => {
      const folder = await window.updater.chooseFolder('Pack source folder', source.value || template.destination);
      if (folder) {
        source.value = folder;
        pack.source = folder;
        queuePackSave();
        schedulePlan();
      }
    });
    const open = iconButton(ICON_OPEN, 'Open in Explorer');
    open.addEventListener('click', () => openPackFolder(source.value));
    const settingsTitle = pack.stripOn && String(pack.strip || '').trim()
      ? `Strips ${pack.strip}`
      : 'Pack settings';
    const settings = iconButton(ICON_SETTINGS, settingsTitle, pack.stripOn ? 'pack-settings primary' : 'pack-settings');
    settings.addEventListener('click', () => openPackRow(pack));
    const one = iconButton(ICON_PACK, 'Pack only this folder', 'pack-one');
    one.disabled = packBusy;
    one.addEventListener('click', () => askPackMode(pack.id));
    const remove = iconButton(ICON_REMOVE, 'Remove from template', 'danger');
    remove.disabled = locked;
    remove.addEventListener('click', () => {
      template.packs = template.packs.filter((item) => item.id !== pack.id);
      renderRows();
      renderPackList();
      queuePackSave();
      schedulePlan();
    });

    const status = document.createElement('span');
    status.className = 'pack-status';
    row.append(tick, source, browse, open, settings, one, remove, status);
    packRows.append(row);
  });
  paintRowStatus();
}

function setAllPackTicks(enabled) {
  const template = packSelected();
  if (!template || packLocked(template) || packBusy) {
    return;
  }
  template.packs.forEach((pack) => {
    pack.enabled = enabled;
  });
  renderRows();
  queuePackSave();
  schedulePlan();
}

document.querySelector('#pack-check-all').addEventListener('click', () => setAllPackTicks(true));
document.querySelector('#pack-uncheck-all').addEventListener('click', () => setAllPackTicks(false));

// Prefix found by the plan, and the result of the last pack, shown under each row.
function paintRowStatus() {
  packRows.querySelectorAll('.pack-row').forEach((row) => {
    const id = row.dataset.packId;
    const status = row.querySelector('.pack-status');
    const planned = packPlan && packPlan.packs ? packPlan.packs.find((item) => item.id === id) : null;
    const result = packLastResult && packLastResult.results ? packLastResult.results.find((item) => item.id === id) : null;
    status.className = 'pack-status';
    status.textContent = '';
    if (result) {
      status.classList.add(result.ok ? 'ok' : 'bad');
      status.textContent = result.ok
        ? `${result.name}.pbo packed${result.signed ? ' and signed' : ''}`
        : result.error;
    } else if (planned && planned.hasConfig === false) {
      status.classList.add('warn');
      status.textContent = 'No config.cpp in this folder.';
    }
  });
}

// ---- pack folder settings ----------------------------------------------------

let packRowTarget = null;

function folderBase(source) {
  const text = String(source || '').trim().replace(/[\\/]+$/, '');
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function previewStrip(name, strip, on) {
  const token = String(strip || '');
  if (!on || !token || !String(name).toLowerCase().startsWith(token.toLowerCase())) {
    return String(name || '');
  }
  return String(name).slice(token.length);
}

function paintPackRowResult() {
  const prefix = document.querySelector('#pack-row-prefix');
  const box = document.querySelector('#pack-row-strip-on');
  const strip = document.querySelector('#pack-row-strip');
  const result = document.querySelector('#pack-row-result');
  strip.disabled = prefix.disabled || !box.checked;
  const base = packRowTarget ? folderBase(packRowTarget.source) : '';
  const name = previewStrip(base, strip.value.trim(), box.checked).trim();
  if (!base) {
    result.textContent = '';
    return;
  }
  if (box.checked && strip.value.trim() && !name) {
    result.textContent = `Stripping ${strip.value.trim()} from ${base} leaves no PBO name.`;
    return;
  }
  result.textContent = `Packs as ${name || base}.pbo`;
}

function openPackRow(pack) {
  packRowTarget = pack;
  const locked = packLocked(packSelected()) || packBusy;
  const prefix = document.querySelector('#pack-row-prefix');
  const box = document.querySelector('#pack-row-strip-on');
  const strip = document.querySelector('#pack-row-strip');
  prefix.value = pack.prefix || '';
  prefix.disabled = locked;
  box.checked = Boolean(pack.stripOn);
  box.disabled = locked;
  strip.value = pack.strip || '';
  document.querySelector('#pack-row-ok').disabled = locked;
  paintPackRowResult();
  document.querySelector('#pack-row-modal').hidden = false;
  if (!locked) {
    prefix.focus();
  }
}

function closePackRow() {
  document.querySelector('#pack-row-modal').hidden = true;
  packRowTarget = null;
}

document.querySelector('#pack-row-prefix').addEventListener('input', paintPackRowResult);
document.querySelector('#pack-row-strip').addEventListener('input', paintPackRowResult);
document.querySelector('#pack-row-strip-on').addEventListener('change', paintPackRowResult);
document.querySelector('#pack-row-cancel').addEventListener('click', closePackRow);
document.querySelector('#pack-row-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const pack = packRowTarget;
  const locked = !pack || packLocked(packSelected()) || packBusy;
  if (!locked) {
    pack.prefix = document.querySelector('#pack-row-prefix').value.trim();
    pack.stripOn = document.querySelector('#pack-row-strip-on').checked;
    pack.strip = document.querySelector('#pack-row-strip').value.trim();
    queuePackSave();
    schedulePlan();
    renderRows();
  }
  closePackRow();
});

function addPackFolder(folder) {
  const template = packSelected();
  if (!template || packLocked(template) || packBusy) {
    return;
  }
  const empty = template.packs.find((pack) => !String(pack.source || '').trim());
  if (empty) {
    empty.source = folder;
  } else {
    template.packs.push({ id: packId(), enabled: true, source: folder || '', prefix: '', strip: '', stripOn: false });
  }
  renderRows();
  renderPackList();
  queuePackSave();
  schedulePlan();
}

document.querySelector('#pack-add').addEventListener('click', async () => {
  const template = packSelected();
  if (!template) {
    return;
  }
  const last = template.packs.length ? template.packs[template.packs.length - 1].source : '';
  const folder = await window.updater.chooseFolder('Pack source folder', last || template.destination);
  if (folder) {
    addPackFolder(folder);
  }
});

const packPacks = document.querySelector('#pack-packs');
packPacks.addEventListener('dragover', (event) => {
  const template = packSelected();
  if (!template || packLocked(template) || packBusy) {
    return;
  }
  event.preventDefault();
  packPacks.classList.add('is-drop-target');
});
packPacks.addEventListener('dragleave', () => packPacks.classList.remove('is-drop-target'));
packPacks.addEventListener('drop', async (event) => {
  event.preventDefault();
  packPacks.classList.remove('is-drop-target');
  const dropped = Array.from(event.dataTransfer.files || []);
  for (let index = 0; index < dropped.length; index += 1) {
    const folder = await window.updater.folderOf(window.updater.pathForFile(dropped[index]));
    if (folder) {
      addPackFolder(folder);
    }
  }
});

// ---- destination -------------------------------------------------------------

function samePath(a, b) {
  const clean = (value) => String(value || '').trim().replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  return clean(a) !== '' && clean(a) === clean(b);
}

// The library mod this template packs into: picked from the list, or the one whose
// content folder is the destination.
function linkedMod(template) {
  if (!template || typeof mods === 'undefined') {
    return null;
  }
  return mods.find((mod) => mod.id === template.linkedModId)
    || mods.find((mod) => samePath(mod.contentFolder, template.destination))
    || null;
}

function renderLinked() {
  const template = packSelected();
  packLinked.textContent = '';
  const custom = document.createElement('option');
  custom.value = '';
  custom.textContent = 'Own path';
  packLinked.append(custom);
  const list = typeof mods === 'undefined' ? [] : mods.slice().sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  list.forEach((mod) => {
    const option = document.createElement('option');
    option.value = mod.id;
    const id = mod.workshop && mod.workshop.publishedId ? ` · ${mod.workshop.publishedId}` : '';
    option.textContent = `${mod.displayName || (mod.workshop && mod.workshop.title) || 'Mod'}${id}`;
    if (!mod.contentFolder) {
      option.disabled = true;
      option.textContent += ' (no content folder)';
    }
    packLinked.append(option);
  });
  const linked = linkedMod(template);
  packLinked.value = linked ? linked.id : '';
  renderPackActions();
}

// Called by renderer.js whenever the mod library is (re)loaded.
function refreshPackMods() {
  if (packLoaded) {
    renderLinked();
  }
}

packLinked.addEventListener('change', () => {
  const template = packSelected();
  if (!template || packLocked(template)) {
    return;
  }
  const mod = typeof mods === 'undefined' ? null : mods.find((item) => item.id === packLinked.value);
  template.linkedModId = mod ? mod.id : '';
  if (mod && mod.contentFolder) {
    template.destination = mod.contentFolder;
    packFields.destination.value = mod.contentFolder;
  }
  renderPackActions();
  queuePackSave();
  schedulePlan();
});

async function openPackFolder(folder) {
  try {
    await window.updater.openFolder(folder);
  } catch (error) {
    packAppendLog(ipcMessage(error));
  }
}

document.querySelector('#pack-destination-open').addEventListener('click', () => openPackFolder(packFields.destination.value));

function bindBrowse(selector, key, chooser) {
  document.querySelector(selector).addEventListener('click', async () => {
    const template = packSelected();
    if (!template || packLocked(template)) {
      return;
    }
    const picked = await chooser(packFields[key].value);
    if (picked) {
      packFields[key].value = picked;
      template[key] = picked;
      if (key === 'destination') {
        template.linkedModId = '';
        renderLinked();
      }
      queuePackSave();
      schedulePlan();
    }
  });
}

bindBrowse('#pack-destination-browse', 'destination', (start) => window.updater.chooseFolder('Destination folder', start));
bindBrowse('#pack-private-key-browse', 'privateKey', (start) => window.updater.chooseFile('Private key', start, 'privateKey'));
bindBrowse('#pack-public-key-browse', 'publicKey', (start) => window.updater.chooseFile('Public key', start || packFields.privateKey.value, 'publicKey'));
bindBrowse('#pack-exclude-file-browse', 'excludeFile', (start) => window.updater.chooseFile('Exclusion list', start, 'exclude'));

// ---- plan and summary --------------------------------------------------------

function ownKeyName(template) {
  const file = template && template.privateKey ? String(template.privateKey).trim() : '';
  const base = file.split(/[/\\]/).pop() || '';
  return base.replace(/\.biprivatekey$/i, '');
}

function ownKeyNameForFolder(folder) {
  const target = String(folder || '').trim().toLowerCase().replace(/[\\/]+$/, '');
  if (!target || typeof packTemplates === 'undefined') {
    return '';
  }
  const match = packTemplates.find((template) => {
    const dest = String(template.destination || '').trim().toLowerCase().replace(/[\\/]+$/, '');
    return dest && (dest === target || target.startsWith(`${dest}\\`) || dest.startsWith(`${target}\\`));
  });
  return ownKeyName(match);
}

let packScanKey = '';
let packSignatureReport = null;

function togglePackResign(name, on) {
  const template = packSelected();
  if (!template || packLocked(template)) {
    return;
  }
  const list = Array.isArray(template.resign) ? template.resign.slice() : [];
  const next = list.filter((item) => item.toLowerCase() !== name.toLowerCase());
  if (on) {
    next.push(name);
  }
  template.resign = next;
  queuePackSave();
  schedulePlan();
}

function plannedPboNames(template) {
  const names = new Set();
  (template && template.packs ? template.packs : []).forEach((pack) => {
    const base = folderBase(pack.source);
    if (!base) {
      return;
    }
    const stripped = previewStrip(base, String(pack.strip || '').trim(), Boolean(pack.stripOn)).trim();
    names.add(`${stripped || base}.pbo`.toLowerCase());
  });
  return names;
}

function signatureLabel(pbo, sig) {
  if (sig.keyName) {
    return sig.keyName;
  }
  const file = String(sig.file || '').split(/[/\\]/).pop() || '';
  const prefix = `${pbo.name}.`;
  if (file.toLowerCase().startsWith(prefix.toLowerCase())) {
    return file.slice(prefix.length).replace(/\.bisign$/i, '') || file;
  }
  return file || 'unnamed';
}

function bisignParts(pbo) {
  const sigs = pbo.signatures || [];
  if (!sigs.length) {
    return [{ text: 'No bisign', tone: 'bad', title: 'No bisign is next to this PBO.' }];
  }
  return sigs.map((sig) => ({
    text: signatureLabel(pbo, sig),
    tone: sig.outdated || sig.nameOnly ? 'bad' : 'ok',
    title: sig.outdated
      ? 'The PBO is newer than this bisign.'
      : 'A current bisign is next to this PBO.'
  }));
}

function signedWithOurKey(pbo, template) {
  const own = ownKeyName(template).toLowerCase();
  if (!own) {
    return false;
  }
  return (pbo.signatures || []).some((sig) => String(sig.keyName || '').toLowerCase() === own);
}

function extraHint(text) {
  extraPboList.replaceChildren();
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = text;
  extraPboList.append(hint);
}

function renderExtraPbos(report) {
  const template = packSelected();
  if (!template) {
    extraPboList.replaceChildren();
    return;
  }
  if (!String(template.destination || '').trim()) {
    extraHint('Set a destination folder to list PBOs that this template does not pack.');
    return;
  }
  if (!report) {
    extraHint('No PBOs in the addons folder yet.');
    return;
  }
  const planned = plannedPboNames(template);
  const extra = report.pbos.filter((pbo) => !planned.has(pbo.name.toLowerCase()));
  if (!extra.length) {
    extraHint('No extra PBOs. Every PBO in the addons folder comes from the pack rows.');
    return;
  }
  const locked = packLocked(template) || packBusy;
  const resign = new Set((template.resign || []).map((name) => String(name).toLowerCase()));
  extraPboList.replaceChildren();
  extra.forEach((pbo) => {
    const row = document.createElement('div');
    row.className = 'extra-pbo';
    const name = document.createElement('span');
    name.className = 'extra-name';
    name.textContent = pbo.name;
    name.title = pbo.name;
    const keys = document.createElement('span');
    keys.className = 'extra-keys';
    bisignParts(pbo).forEach((part, index) => {
      if (index) {
        keys.append(document.createTextNode(', '));
      }
      const key = document.createElement('span');
      key.className = `extra-key ${part.tone}`;
      key.textContent = part.text;
      key.title = part.title;
      keys.append(key);
    });
    const label = document.createElement('label');
    label.className = 'extra-sign';
    label.title = 'Use our bisign. The current bisign is removed and replaced with the private key on the next Override pack.';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = resign.has(pbo.name.toLowerCase()) || signedWithOurKey(pbo, template);
    box.disabled = locked;
    const resignButton = iconButton(ICON_RESIGN, 'Re-sign with our key');
    resignButton.disabled = locked || !box.checked;
    box.addEventListener('change', () => {
      togglePackResign(pbo.name, box.checked);
      resignButton.disabled = locked || !box.checked;
    });
    const caption = document.createElement('span');
    caption.textContent = 'Use our bisign';
    label.append(box, caption);
    resignButton.addEventListener('click', () => resignExtraPbo(pbo, resignButton));
    const remove = iconButton(ICON_REMOVE, 'Remove this PBO and its bisign from the addons folder', 'danger');
    remove.disabled = locked;
    remove.addEventListener('click', () => removeExtraPbo(pbo));
    row.append(name, keys, label, resignButton, remove);
    extraPboList.append(row);
  });
}

async function resignExtraPbo(pbo, button) {
  const template = packSelected();
  if (!template || packLocked(template) || packBusy) {
    return;
  }
  button.disabled = true;
  try {
    const result = await window.updater.resignPbo(pbo.file, template.privateKey, template.publicKey);
    packAppendLog(`Re-signed ${pbo.name} with ${result.keyName}. The previous bisign was removed.`);
    packScanKey = '';
    await refreshExtraPbos(true);
  } catch (error) {
    packAppendLog(ipcMessage(error));
    button.disabled = false;
  }
}

async function removeExtraPbo(pbo) {
  const template = packSelected();
  if (!template || packLocked(template) || packBusy) {
    return;
  }
  try {
    await window.updater.removePbo(pbo.file);
    togglePackResign(pbo.name, false);
    packAppendLog(`Removed ${pbo.name} and its bisign.`);
    packScanKey = '';
    await refreshExtraPbos(true);
  } catch (error) {
    packAppendLog(ipcMessage(error));
  }
}

async function refreshExtraPbos(force) {
  const template = packSelected();
  const folder = template ? String(template.destination || '').trim() : '';
  const own = ownKeyName(template);
  const token = `${folder.toLowerCase()}|${own.toLowerCase()}`;
  if (!folder) {
    packSignatureReport = null;
    packScanKey = '';
    renderExtraPbos(null);
    return;
  }
  if (!force && token === packScanKey && packSignatureReport) {
    renderExtraPbos(packSignatureReport);
    return;
  }
  packScanKey = token;
  try {
    const report = await window.updater.checkSignatures(folder, own);
    if (`${String(packSelected() && packSelected().destination || '').trim().toLowerCase()}|${ownKeyName(packSelected()).toLowerCase()}` !== token) {
      return;
    }
    packSignatureReport = report;
    renderExtraPbos(report);
  } catch (error) {
    packSignatureReport = null;
    const message = ipcMessage(error);
    extraHint(/No \.pbo files/i.test(message) ? 'No PBOs in the addons folder yet.' : message);
  }
}

function schedulePlan() {
  window.clearTimeout(packPlanTimer);
  packPlanTimer = window.setTimeout(refreshPlan, 250);
}

async function refreshPlan() {
  const template = packSelected();
  if (!template) {
    packSummary.textContent = '';
    return;
  }
  try {
    packPlan = await window.updater.packPlan(template, '');
  } catch (error) {
    packPlan = null;
    packSummary.textContent = ipcMessage(error);
    return;
  }
  renderSummary();
  paintRowStatus();
  refreshExtraPbos();
}

function summaryLine(label, value) {
  const line = document.createElement('div');
  line.className = 'pack-summary-line';
  const name = document.createElement('span');
  name.textContent = label;
  const text = document.createElement('code');
  text.textContent = value;
  line.append(name, text);
  return line;
}

function renderSummary() {
  packSummary.textContent = '';
  if (!packPlan) {
    return;
  }
  const resignCount = (packSelected() && packSelected().resign ? packSelected().resign : []).length;
  const problems = packPlan.problems.filter((problem) => !(resignCount && packPlan.problems.length === 1 && problem === 'No pack is ticked.'));
  packSummary.classList.toggle('is-bad', problems.length > 0);
  if (packPlan.addons) {
    packSummary.append(summaryLine('PBOs to', packPlan.addons));
  }
  if (packPlan.keys && (packFields.privateKey.value || packFields.publicKey.value)) {
    packSummary.append(summaryLine('Key to', packPlan.publicKey ? `${packPlan.keys}\\${packPlan.publicKey.split(/[\\/]/).pop()}` : packPlan.keys));
  }
  const ticked = packPlan.packs.length;
  packSummary.append(summaryLine('Packs', `${ticked} ticked`));
  if (resignCount) {
    packSummary.append(summaryLine('Extra', `Override signs ${resignCount}`));
  }
  if (!packPlan.builder) {
    packSummary.append(summaryLine('AddonBuilder', 'not found, set it in Settings'));
  }
  if (problems.length) {
    const list = document.createElement('ul');
    problems.forEach((problem) => {
      const item = document.createElement('li');
      item.textContent = problem;
      list.append(item);
    });
    packSummary.append(list);
  }
}

// ---- pack --------------------------------------------------------------------

function setPackBusy(next) {
  packBusy = next;
  document.body.classList.toggle('is-packing', next);
  renderPackList();
  fillPackFormState();
}

// Busy only changes which controls work, the values stay as they are.
function fillPackFormState() {
  const template = packSelected();
  const disabled = !template || packLocked(template) || packBusy;
  Object.values(packFields).forEach((input) => {
    input.disabled = disabled;
  });
  packBinarize.disabled = disabled;
  packLinked.disabled = disabled;
  ['#pack-add', '#pack-check-all', '#pack-uncheck-all', '#pack-new', '#pack-files-default', '#pack-exclude-file-browse', '#pack-destination-browse', '#pack-private-key-browse', '#pack-public-key-browse'].forEach((selector) => {
    document.querySelector(selector).disabled = selector === '#pack-new' ? packBusy : disabled;
  });
  renderRows();
  if (packSignatureReport) {
    renderExtraPbos(packSignatureReport);
  }
  renderPackActions();
}

let packPendingOnly = '';

function askPackMode(only) {
  const template = packSelected();
  if (!template || packBusy) {
    return;
  }
  packPendingOnly = only || '';
  document.querySelector('#pack-mode-modal').hidden = false;
}

function closePackMode() {
  document.querySelector('#pack-mode-modal').hidden = true;
}

async function runPack(only, mode) {
  const template = packSelected();
  if (!template || packBusy) {
    return;
  }
  await savePackTemplates();
  packLog.textContent = '';
  packLastResult = null;
  setPackBusy(true);
  let result;
  try {
    result = await window.updater.pack(template, only || '', mode === 'recreate' ? 'recreate' : 'override');
  } catch (error) {
    result = { ok: false, error: ipcMessage(error), results: [] };
    packAppendLog(result.error);
  }
  packLastResult = result;
  setPackBusy(false);
  paintRowStatus();
  if (template.destination) {
    packScanKey = '';
    await refreshExtraPbos(true);
  }
  const linked = linkedMod(template);
  if (linked && result.ok) {
    packAppendLog(`Ready to push: ${linked.displayName}. Open in Workshop to push it.`);
  }
}

packRun.addEventListener('click', () => askPackMode(''));
document.querySelector('#pack-mode-cancel').addEventListener('click', closePackMode);
document.querySelector('#pack-mode-override').addEventListener('click', () => {
  const only = packPendingOnly;
  closePackMode();
  runPack(only, 'override');
});
document.querySelector('#pack-mode-recreate').addEventListener('click', () => {
  const only = packPendingOnly;
  closePackMode();
  runPack(only, 'recreate');
});

document.querySelector('#pack-goto-mod').addEventListener('click', () => {
  const mod = linkedMod(packSelected());
  if (!mod) {
    return;
  }
  setView('workshop');
  selectMod(mod.id);
  if (typeof checkFolder === 'function') {
    checkFolder({ quiet: true }).catch(() => {});
  }
});

window.updater.onPackProgress((line) => packAppendLog(line));

// ---- template commands -------------------------------------------------------

document.querySelector('#pack-new').addEventListener('click', () => {
  if (packBusy) {
    return;
  }
  const template = blankTemplate('New template');
  packTemplates.push(template);
  packSelectedId = template.id;
  packLastResult = null;
  renderPackList();
  fillPackForm();
  queuePackSave();
  packFields.name.focus();
  packFields.name.select();
});

const packSaveModal = document.querySelector('#pack-save-modal');

document.querySelector('#pack-save-as').addEventListener('click', () => {
  const template = packSelected();
  if (!template || packBusy) {
    return;
  }
  document.querySelector('#pack-save-name').value = template.builtin ? `${template.name} (own)` : `${template.name} copy`;
  document.querySelector('#pack-save-note').value = template.note || '';
  packSaveModal.hidden = false;
  document.querySelector('#pack-save-name').focus();
  document.querySelector('#pack-save-name').select();
});

document.querySelector('#pack-save-cancel').addEventListener('click', () => {
  packSaveModal.hidden = true;
});

document.querySelector('#pack-save-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const template = packSelected();
  const name = document.querySelector('#pack-save-name').value.trim();
  if (!template || !name) {
    document.querySelector('#pack-save-name').focus();
    return;
  }
  const copy = cloneTemplate(template, name, document.querySelector('#pack-save-note').value);
  packTemplates.push(copy);
  packSelectedId = copy.id;
  packSaveModal.hidden = true;
  packLastResult = null;
  renderPackList();
  fillPackForm();
  savePackTemplates();
  packAppendLog(`Saved template ${name}.`);
});

const packDeleteModal = document.querySelector('#pack-delete-modal');

document.querySelector('#pack-delete').addEventListener('click', () => {
  const template = packSelected();
  if (!template || template.builtin || packBusy) {
    return;
  }
  document.querySelector('#pack-delete-name').textContent = template.name;
  packDeleteModal.hidden = false;
});

document.querySelector('#pack-delete-cancel').addEventListener('click', () => {
  packDeleteModal.hidden = true;
});

document.querySelector('#pack-delete-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const template = packSelected();
  packDeleteModal.hidden = true;
  if (!template || template.builtin) {
    return;
  }
  const index = packTemplates.indexOf(template);
  packTemplates = packTemplates.filter((item) => item.id !== template.id);
  const next = packTemplates[Math.min(index, packTemplates.length - 1)];
  packSelectedId = next ? next.id : '';
  packLastResult = null;
  renderPackList();
  fillPackForm();
  savePackTemplates();
  packAppendLog(`Deleted template ${template.name}.`);
});

// Ctrl+Enter packs, Ctrl+S saves the templates, while the Pack view is open.
document.addEventListener('keydown', (event) => {
  if (document.body.dataset.view !== 'pack' || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key !== 'enter' && key !== 's') {
    return;
  }
  event.preventDefault();
  if (anyModalOpen()) {
    return;
  }
  if (key === 's') {
    savePackTemplates().then(() => packAppendLog('Templates saved.'));
  } else if (!packRun.disabled) {
    askPackMode('');
  }
});

// ---- start -------------------------------------------------------------------

(function restoreView() {
  let view = 'workshop';
  try {
    view = window.localStorage.getItem('steam-updater-view') || 'workshop';
  } catch (_error) {
    // Storage blocked: start in Workshop.
  }
  document.body.dataset.view = 'workshop';
  if (view === 'pack') {
    setView('pack');
  }
}());
