const fields = {
  displayName: document.querySelector('#display-name'),
  title: document.querySelector('#workshop-title'),
  description: document.querySelector('#workshop-description'),
  changeNote: document.querySelector('#workshop-change-note'),
  visibility: document.querySelector('#workshop-visibility'),
  tags: document.querySelector('#workshop-tags'),
  publishedId: document.querySelector('#workshop-published-id'),
  name: document.querySelector('#mod-name'),
  version: document.querySelector('#mod-version'),
  author: document.querySelector('#mod-author'),
  authorID: document.querySelector('#mod-author-id'),
  tooltip: document.querySelector('#mod-tooltip'),
  overview: document.querySelector('#mod-overview'),
  action: document.querySelector('#mod-action'),
  picture: document.querySelector('#mod-picture'),
  logo: document.querySelector('#mod-logo'),
  logoSmall: document.querySelector('#mod-logo-small'),
  logoOver: document.querySelector('#mod-logo-over')
};

const form = document.querySelector('#mod-form');
const empty = document.querySelector('#empty');
const modList = document.querySelector('#mod-list');
const log = document.querySelector('#log');
const modeHint = document.querySelector('#mode-hint');
const contentFolder = document.querySelector('#content-folder');
const signatureReport = document.querySelector('#signature-report');

let mods = [];
let dismissed = [];
let selectedId = '';
let saveTimer = 0;
let busy = false;
let roleFilter = 'all';
let query = '';

function createMod(name) {
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
    },
    draft: false,
    locked: false
  };
}

function normalize(mod) {
  const blank = createMod();
  const mode = mod.uploadMode === 'contributor' ? 'contributor' : 'normal';
  return {
    ...blank,
    ...mod,
    id: mod.id || blank.id,
    uploadMode: mode,
    role: mod.role === 'contributor' || (mod.role !== 'owner' && mode === 'contributor') ? 'contributor' : 'owner',
    workshop: { ...blank.workshop, ...(mod.workshop || {}) },
    modCpp: { ...blank.modCpp, ...(mod.modCpp || {}) },
    draft: Boolean(mod.draft),
    locked: Boolean(mod.locked)
  };
}

function selected() {
  return mods.find((mod) => mod.id === selectedId) || null;
}

function appendLog(line, options) {
  log.textContent = `${log.textContent}${log.textContent ? '\n' : ''}${line}`;
  log.scrollTop = log.scrollHeight;
  if (!options || options.file !== false) {
    window.updater.writeLog(line).catch(() => {});
  }
}

function modeHintText(mode) {
  if (mode === 'contributor') {
    return 'Contributor updates the files on an existing workshop id. It does not create a new item. Steam still refuses the upload when this account cannot replace those files.';
  }
  return 'Normal creates a workshop item when the published id is empty, and updates it when this account is the author.';
}

function readMode() {
  const picked = document.querySelector('input[name="upload-mode"]:checked');
  return picked && picked.value === 'contributor' ? 'contributor' : 'normal';
}

function applyMode(mode) {
  const value = mode === 'contributor' ? 'contributor' : 'normal';
  document.querySelectorAll('input[name="upload-mode"]').forEach((input) => {
    input.checked = input.value === value;
  });
  modeHint.textContent = modeHintText(value);
  const contributor = value === 'contributor';
  document.querySelector('[data-for="title"]').hidden = contributor;
  document.querySelector('[data-for="preview"]').hidden = contributor;
  document.querySelector('[data-for="published"]').hidden = !contributor;
}

function selectedTags() {
  return Array.from(fields.tags.selectedOptions).map((option) => option.value).join(', ');
}

function applyTags(value) {
  const picked = new Set(String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean));
  Array.from(fields.tags.options).forEach((option) => {
    option.selected = picked.has(option.value);
  });
}

function missingRequired(mod) {
  const missing = [];
  if (!mod.contentFolder) {
    missing.push('content folder');
  }
  if (mod.uploadMode === 'contributor') {
    if (!mod.workshop.publishedId) {
      missing.push('published file id');
    }
  } else {
    if (!mod.workshop.title.trim()) {
      missing.push('title');
    }
    if (!mod.workshop.previewImage) {
      missing.push('preview image');
    }
  }
  return missing;
}

function readForm(mod) {
  mod.displayName = fields.displayName.value.trim() || (mod.draft ? 'New mod' : 'Untitled mod');
  mod.contentFolder = cleanPath(contentFolder.value);
  mod.uploadMode = readMode();
  mod.workshop.title = fields.title.value;
  mod.workshop.description = fields.description.value;
  mod.workshop.changeNote = fields.changeNote.value;
  mod.workshop.visibility = fields.visibility.value;
  mod.workshop.tags = selectedTags();
  mod.modCpp.name = fields.name.value;
  mod.modCpp.version = fields.version.value;
  mod.modCpp.author = fields.author.value;
  mod.modCpp.authorID = fields.authorID.value;
  mod.modCpp.tooltip = fields.tooltip.value;
  mod.modCpp.overview = fields.overview.value;
  mod.modCpp.action = fields.action.value;
  mod.modCpp.picture = fields.picture.value;
  mod.modCpp.logo = fields.logo.value;
  mod.modCpp.logoSmall = fields.logoSmall.value;
  mod.modCpp.logoOver = fields.logoOver.value;
  return mod;
}

function fillForm(mod) {
  fields.displayName.value = mod.displayName;
  contentFolder.value = mod.contentFolder || '';
  fields.title.value = mod.workshop.title;
  fields.description.value = mod.workshop.description;
  fields.changeNote.value = mod.workshop.changeNote;
  fields.visibility.value = mod.workshop.visibility || 'public';
  applyTags(mod.workshop.tags);
  fields.publishedId.value = mod.workshop.publishedId;
  fields.name.value = mod.modCpp.name;
  fields.version.value = mod.modCpp.version;
  fields.author.value = mod.modCpp.author;
  fields.authorID.value = mod.modCpp.authorID;
  fields.tooltip.value = mod.modCpp.tooltip;
  fields.overview.value = mod.modCpp.overview;
  fields.action.value = mod.modCpp.action;
  fields.picture.value = mod.modCpp.picture;
  fields.logo.value = mod.modCpp.logo;
  fields.logoSmall.value = mod.modCpp.logoSmall;
  fields.logoOver.value = mod.modCpp.logoOver;
  applyMode(mod.uploadMode);
  showPreview(mod.workshop.previewImage);
  applyLock(mod);
  if (mod.contentFolder) {
    checkFolder({ quiet: true });
  } else {
    clearSignatureReport();
  }
}

// Strips the quotes Explorer's "Copy as path" adds. The main process resolves the rest.
function cleanPath(value) {
  let text = String(value || '').trim();
  while (text.length > 1 && /^["']/.test(text) && text[0] === text[text.length - 1]) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

const signatureStates = {
  signed: 'Signed',
  unsigned: 'Not signed',
  outdated: 'Outdated',
  'no-key': 'No .bikey',
  'unknown-key': 'Wrong key'
};

const signatureHelp = {
  unsigned: 'no .bisign next to it',
  outdated: 'the .pbo is newer than its .bisign, sign it again',
  'no-key': 'keys\\ holds no .bikey',
  'unknown-key': 'signed with a key that is not in keys\\'
};

let signatureCheck = 0;

function clearSignatureReport() {
  signatureCheck += 1;
  signatureReport.hidden = true;
  signatureReport.className = 'signature-report';
  signatureReport.replaceChildren();
}

function showSignatureReport(report) {
  signatureReport.replaceChildren();
  signatureReport.className = `signature-report ${report.ok ? 'is-ok' : 'is-bad'}`;
  const summary = document.createElement('p');
  summary.className = 'sig-summary';
  summary.textContent = report.ok
    ? `All ${report.total} PBOs are signed.`
    : `${report.total - report.signed} of ${report.total} PBOs are not signed correctly.`;
  const keys = document.createElement('p');
  keys.className = 'sig-keys';
  keys.textContent = report.keys.length
    ? `Keys: ${report.keys.map((key) => key.name || '(unnamed)').join(', ')} · ${report.addons}`
    : `No .bikey in ${report.root}\\keys · ${report.addons}`;
  const list = document.createElement('ul');
  report.pbos.forEach((pbo) => {
    const item = document.createElement('li');
    const state = document.createElement('span');
    state.className = `sig-state ${pbo.status}`;
    state.textContent = signatureStates[pbo.status] || pbo.status;
    const name = document.createElement('span');
    const keyNames = pbo.signatures.map((sig) => sig.keyName).filter(Boolean);
    const detail = signatureHelp[pbo.status] || (keyNames.length ? `key ${keyNames.join(', ')}` : '');
    name.textContent = detail ? `${pbo.name} (${detail})` : pbo.name;
    item.append(state, name);
    list.appendChild(item);
  });
  signatureReport.append(summary, keys, list);
  signatureReport.hidden = false;
}

function showSignatureError(message) {
  signatureReport.replaceChildren();
  signatureReport.className = 'signature-report is-bad';
  const line = document.createElement('p');
  line.className = 'sig-summary';
  line.textContent = message;
  signatureReport.append(line);
  signatureReport.hidden = false;
}

// Checks the folder in the content field. quiet keeps the result out of the log,
// for when a mod is only opened.
async function checkFolder(options) {
  const quiet = Boolean(options && options.quiet);
  const typed = cleanPath(contentFolder.value);
  if (!typed) {
    clearSignatureReport();
    if (!quiet) {
      appendLog('Enter or paste a mod folder path first.');
    }
    return null;
  }
  signatureCheck += 1;
  const ticket = signatureCheck;
  try {
    const report = await window.updater.checkSignatures(typed);
    if (ticket !== signatureCheck) {
      return report;
    }
    showSignatureReport(report);
    const mod = selected();
    if (report.folder !== contentFolder.value) {
      contentFolder.value = report.folder;
      if (mod && !mod.locked) {
        queueSave();
      }
    }
    if (!quiet) {
      appendLog(`Signature check ${report.folder}: ${report.signed} of ${report.total} PBOs signed.`);
      report.pbos.filter((pbo) => pbo.status !== 'signed').forEach((pbo) => {
        appendLog(`  ${pbo.name}: ${signatureStates[pbo.status] || pbo.status}, ${signatureHelp[pbo.status] || ''}`);
      });
    }
    return report;
  } catch (error) {
    const message = String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (ticket === signatureCheck) {
      showSignatureError(message);
      if (!quiet) {
        appendLog(message);
      }
    }
    return null;
  }
}

function roleOf(mod) {
  return mod.role === 'contributor' ? 'contributor' : 'owner';
}

function savedMods() {
  return mods.filter((mod) => !mod.draft);
}

function visibleMods() {
  const needle = query.trim().toLowerCase();
  return savedMods().filter((mod) => {
    if ((roleFilter === 'owner' || roleFilter === 'contributor') && roleOf(mod) !== roleFilter) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const haystack = [mod.displayName, mod.workshop.title, mod.workshop.publishedId].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

function renderFilters() {
  const counts = { all: 0, owner: 0, contributor: 0 };
  savedMods().forEach((mod) => {
    counts.all += 1;
    counts[roleOf(mod)] += 1;
  });
  const labels = {
    all: `All ${counts.all}`,
    owner: `Owner ${counts.owner}`,
    contributor: `Contributor ${counts.contributor}`
  };
  document.querySelectorAll('.filters button').forEach((button) => {
    const filter = button.id.replace('filter-', '');
    const label = labels[filter] || labels.all;
    button.classList.toggle('active', filter === roleFilter);
    button.title = label;
    button.setAttribute('aria-label', label);
  });
}

function renderList() {
  renderFilters();
  modList.replaceChildren();
  visibleMods().forEach((mod) => {
    const row = document.createElement('div');
    row.className = mod.id === selectedId ? 'mod-row active' : 'mod-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mod-select';
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = mod.displayName || 'Untitled mod';
    const role = document.createElement('span');
    role.className = 'role';
    const roleName = roleOf(mod) === 'contributor' ? 'Contributor' : 'Owner';
    role.textContent = mod.locked ? `${roleName} · Locked` : roleName;
    text.append(name, role);
    button.append(text);
    button.addEventListener('click', () => {
      selectMod(mod.id);
    });
    row.append(button);
    modList.appendChild(row);
  });
  const hasMod = Boolean(selected());
  empty.hidden = hasMod;
  form.hidden = !hasMod;
  document.querySelector('#add-mod').disabled = busy || mods.some((mod) => mod.draft);
  refreshViewSteam();
}

function refreshViewSteam() {
  const mod = selected();
  const id = mod ? String(mod.workshop.publishedId || '').trim() : '';
  document.querySelector('#view-steam').disabled = busy || !/^\d+$/.test(id);
}

function setBusy(next) {
  busy = next;
  document.querySelectorAll('button.icon, .filters button').forEach((button) => {
    button.disabled = next;
  });
  document.querySelector('#add-mod').disabled = next || mods.some((mod) => mod.draft);
  refreshViewSteam();
  applyLock(selected());
}

function applyImported(rows) {
  (rows || []).forEach((row) => {
    if (dismissed.includes(String(row.publishedId || ''))) {
      return;
    }
    if (row.status === 'missing' || row.status === 'empty') {
      appendLog(`${row.title || row.publishedId}: ${row.error || 'No files to pull.'}`);
      return;
    }
    const role = row.hiddenByPublisher ? 'contributor' : 'owner';
    let mod = mods.find((item) => item.workshop.publishedId === row.publishedId);
    if (!mod) {
      mod = createMod(row.title || row.modName || row.publishedId);
      mod.role = role;
      mod.uploadMode = role === 'contributor' ? 'contributor' : 'normal';
      mod.workshop.title = row.title || '';
      mod.workshop.publishedId = row.publishedId;
      mod.workshop.description = row.description || '';
      mod.workshop.visibility = row.visibility || 'public';
      mod.workshop.tags = row.tags || '';
      mods.push(mod);
    } else {
      mod.role = role;
      if (!mod.workshop.title && row.title) {
        mod.workshop.title = row.title;
      }
      if ((!mod.displayName || mod.displayName === 'New mod') && row.title) {
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
      if (!mod.modCpp[key] && row.modCpp[key]) {
        mod.modCpp[key] = row.modCpp[key];
      }
    });
    const where = row.contentFolder ? ` ${row.contentFolder}` : '';
    appendLog(`${row.title || row.publishedId}: ${row.status}.${where}`);
    selectedId = mod.id;
  });
  if (!selected() && mods.length) {
    selectedId = mods[0].id;
  }
  if (selected()) {
    fillForm(selected());
  }
  renderList();
}

async function persist() {
  await window.updater.saveLibrary({
    mods: mods.filter((mod) => !mod.draft),
    dismissed
  });
}

function applyLock(mod) {
  const locked = Boolean(mod && mod.locked);
  form.classList.toggle('is-locked', locked);
  const lockSwitch = document.querySelector('#lock-mod');
  lockSwitch.classList.toggle('is-on', locked);
  lockSwitch.setAttribute('aria-checked', locked ? 'true' : 'false');
  form.querySelectorAll('input, textarea, select').forEach((field) => {
    if (field.id === 'workshop-published-id') {
      field.readOnly = true;
      return;
    }
    if (field.type === 'radio' || field.tagName === 'SELECT') {
      field.disabled = locked;
      return;
    }
    field.readOnly = locked;
  });
  document.querySelector('#push-mod').disabled = busy || locked;
  document.querySelector('#save-mod').disabled = busy || locked;
  document.querySelector('#content-folder-browse').disabled = busy || locked;
}

function queueSave() {
  const mod = selected();
  if (!mod || busy || mod.locked) {
    return;
  }
  readForm(mod);
  renderList();
  if (mod.draft) {
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist().catch((error) => appendLog(error.message));
  }, 250);
}

function selectMod(id) {
  const current = selected();
  if (current) {
    readForm(current);
  }
  selectedId = id;
  const mod = selected();
  if (mod) {
    fillForm(mod);
  }
  renderList();
  persist().catch((error) => appendLog(error.message));
}

function describeResult(result) {
  if (result.ok) {
    const id = result.publishedId ? ` Published id ${result.publishedId}.` : '';
    return `Upload finished.${id}`;
  }
  const name = result.errorName ? ` ${result.errorName}` : '';
  const code = result.steamErrorCode ? ` (${result.steamErrorCode})` : '';
  return `${result.error || 'Upload failed.'}${name}${code}`;
}

document.querySelectorAll('.filters button').forEach((button) => {
  button.addEventListener('click', () => {
    const filter = button.id.replace('filter-', '');
    roleFilter = filter === 'owner' || filter === 'contributor' ? filter : 'all';
    renderList();
  });
});

document.querySelector('#add-mod').addEventListener('click', () => {
  if (mods.some((item) => item.draft)) {
    appendLog('Save the new mod before adding another.');
    return;
  }
  const mod = createMod();
  mod.draft = true;
  mods.push(mod);
  selectedId = mod.id;
  fillForm(mod);
  renderList();
});

document.querySelector('#save-mod').addEventListener('click', () => {
  const mod = selected();
  if (!mod) {
    return;
  }
  readForm(mod);
  mod.draft = false;
  renderList();
  persist()
    .then(async () => {
      appendLog(`Saved ${mod.displayName}.`);
      if (!mod.contentFolder) {
        appendLog('Choose a content folder to write mod.cpp and meta.cpp.');
        return;
      }
      const written = await window.updater.writeFiles(mod);
      appendLog(written.modPath ? `Wrote ${written.modPath}` : 'mod.cpp already matches the form.');
      appendLog(`Wrote ${written.metaPath}`);
    })
    .catch((error) => appendLog(error.message));
});

document.querySelector('#duplicate-mod').addEventListener('click', () => {
  const mod = selected();
  if (!mod) {
    return;
  }
  readForm(mod);
  if (mod.draft) {
    appendLog('Save this mod before duplicating it.');
    return;
  }
  const copy = normalize(JSON.parse(JSON.stringify(mod)));
  copy.id = crypto.randomUUID();
  copy.displayName = `${mod.displayName} copy`;
  copy.locked = false;
  mods.push(copy);
  selectedId = copy.id;
  fillForm(copy);
  renderList();
  persist().catch((error) => appendLog(error.message));
});

function removeMod(mod) {
  const remove = window.confirm(`Remove ${mod.displayName} from this list? The workshop item and its folder stay.`);
  if (!remove) {
    return;
  }
  if (mod.workshop.publishedId) {
    const publishedId = String(mod.workshop.publishedId);
    if (!dismissed.includes(publishedId)) {
      dismissed.push(publishedId);
    }
  }
  mods = mods.filter((item) => item.id !== mod.id);
  if (selectedId === mod.id) {
    selectedId = mods.length ? mods[0].id : '';
    if (selected()) {
      fillForm(selected());
    }
  }
  renderList();
  persist().catch((error) => appendLog(error.message));
}

document.querySelector('#delete-mod').addEventListener('click', () => {
  const mod = selected();
  if (!mod) {
    return;
  }
  removeMod(mod);
});

document.querySelector('#push-mod').addEventListener('click', () => {
  const mod = selected();
  if (!mod) {
    return;
  }
  uploadOne(mod);
});

document.querySelector('#view-steam').addEventListener('click', () => {
  const mod = selected();
  const id = mod ? String(mod.workshop.publishedId || '').trim() : '';
  if (!/^\d+$/.test(id)) {
    return;
  }
  window.updater.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`)
    .catch((error) => appendLog(error.message));
});

document.querySelector('#lock-mod').addEventListener('click', () => {
  const mod = selected();
  if (!mod || busy) {
    return;
  }
  if (!mod.locked) {
    const id = String(mod.workshop.publishedId || '').trim();
    if (!/^\d+$/.test(id)) {
      appendLog('A published file id is required before this mod can be locked.');
      return;
    }
    mod.locked = true;
    applyLock(mod);
    renderList();
    persist()
      .then(() => appendLog(`Locked ${mod.displayName}.`))
      .catch((error) => appendLog(error.message));
    return;
  }
  document.querySelector('#unlock-name').textContent = mod.displayName || 'this mod';
  document.querySelector('#unlock-id').value = '';
  document.querySelector('#unlock-modal').hidden = false;
  document.querySelector('#unlock-id').focus();
});

document.querySelector('#unlock-cancel').addEventListener('click', () => {
  document.querySelector('#unlock-modal').hidden = true;
  applyLock(selected());
});

document.querySelector('#unlock-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const mod = selected();
  const typed = document.querySelector('#unlock-id').value.trim();
  if (!mod) {
    document.querySelector('#unlock-modal').hidden = true;
    return;
  }
  if (typed !== String(mod.workshop.publishedId || '').trim()) {
    appendLog('Unlock needs the published file id for this mod.');
    return;
  }
  mod.locked = false;
  applyLock(mod);
  renderList();
  document.querySelector('#unlock-modal').hidden = true;
  persist()
    .then(() => appendLog(`Unlocked ${mod.displayName}.`))
    .catch((error) => appendLog(error.message));
});

async function uploadOne(mod) {
  if (mod.locked) {
    appendLog('This mod is locked. Enter its published file id to unlock it.');
    return;
  }
  if (mod.id === selectedId) {
    readForm(mod);
  }
  const missing = missingRequired(mod);
  if (missing.length) {
    appendLog(`Push needs ${missing.join(', ')}.`);
    return;
  }
  if (mod.id === selectedId) {
    const report = await checkFolder();
    if (!report) {
      appendLog('Push stopped. Fix the content folder first.');
      return;
    }
    if (!report.ok && !window.confirm(`${report.total - report.signed} of ${report.total} PBOs are not signed correctly. Servers that verify signatures will kick players. Push anyway?`)) {
      appendLog('Push cancelled.');
      return;
    }
  }
  mod.draft = false;
  renderList();
  pushing = true;
  clearTimeout(splashIdle);
  setBusy(true);
  showSplash(`Pushing ${mod.displayName || 'mod'}`);
  const start = mod.uploadMode === 'contributor' ? 'Uploading as contributor...' : 'Uploading as owner...';
  appendLog(start);
  splashProgress(start);
  try {
    await persist();
    const result = await window.updater.upload(mod);
    if (result.mod) {
      const index = mods.findIndex((item) => item.id === mod.id);
      mods[index] = normalize(result.mod);
      selectedId = mods[index].id;
      fillForm(mods[index]);
      renderList();
      await persist();
    }
    const summary = describeResult(result);
    appendLog(summary);
    splashProgress(summary);
  } catch (error) {
    appendLog(error.message);
    splashProgress(error.message);
  } finally {
    pushing = false;
    setBusy(false);
    window.setTimeout(hideSplash, 900);
  }
}

const splash = document.querySelector('#splash');
const splashStatus = document.querySelector('#splash-status');
const splashLog = document.querySelector('#splash-log');
let splashLines = [];
let pulling = false;
let pushing = false;
let splashIdle = 0;

function showSplash(title) {
  splashLines = [];
  document.querySelector('#splash-title').textContent = title;
  splashStatus.textContent = 'Starting…';
  splashLog.textContent = '';
  splash.hidden = false;
}

function splashProgress(line) {
  if (splash.hidden) {
    return;
  }
  splashStatus.textContent = line;
  splashLines.push(line);
  if (splashLines.length > 8) {
    splashLines.shift();
  }
  splashLog.textContent = splashLines.join('\n');
  splashLog.scrollTop = splashLog.scrollHeight;
}

function hideSplash() {
  splash.hidden = true;
}

document.querySelector('#pull-all').addEventListener('click', async () => {
  pulling = true;
  clearTimeout(splashIdle);
  setBusy(true);
  showSplash('Pulling mods');
  appendLog('Pulling workshop mods for this Steam account...');
  try {
    const result = await window.updater.pullAll();
    if (!result.ok) {
      const message = result.error || 'Pull failed.';
      appendLog(message);
      splashProgress(message);
      return;
    }
    applyImported(result.imported);
    const added = (result.imported || []).filter((item) => item.status === 'copied' || item.status === 'kept').length;
    const summary = `Pulled ${added} mods into the library.`;
    appendLog(summary);
    splashProgress(summary);
    await persist();
    await loadLibrary();
  } catch (error) {
    appendLog(error.message);
    splashProgress(error.message);
  } finally {
    pulling = false;
    setBusy(false);
    window.setTimeout(hideSplash, 900);
  }
});

contentFolder.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    checkFolder();
  }
});

contentFolder.addEventListener('change', () => {
  checkFolder();
});

contentFolder.addEventListener('paste', () => {
  window.setTimeout(() => checkFolder({ quiet: true }), 0);
});

document.querySelector('#content-folder-check').addEventListener('click', () => {
  checkFolder();
});

document.querySelector('#content-folder-browse').addEventListener('click', async () => {
  const mod = selected();
  if (!mod || busy || mod.locked) {
    return;
  }
  const folder = await window.updater.chooseFolder('Mod content folder');
  if (!folder) {
    return;
  }
  contentFolder.value = folder;
  queueSave();
  checkFolder();
});

form.addEventListener('input', queueSave);
form.addEventListener('change', (event) => {
  if (event.target.id === 'lock-mod') {
    return;
  }
  queueSave();
});

window.updater.onProgress((line) => {
  appendLog(line, { file: false });
  if (pushing) {
    splashProgress(line);
    return;
  }
  const fromPull = pulling || /^(Copying |Asking Steam|Workshop page|Pull )/.test(line) || /^Preview \d+\.(png|jpe?g|gif|webp)$/i.test(line);
  if (!fromPull) {
    return;
  }
  if (splash.hidden) {
    showSplash('Pulling mods');
    setBusy(true);
  }
  splashProgress(line);
  clearTimeout(splashIdle);
  splashIdle = window.setTimeout(() => {
    if (pulling || pushing) {
      return;
    }
    hideSplash();
    setBusy(false);
    loadLibrary();
  }, 2000);
});

function loadLibrary() {
  return window.updater.getLibrary().then((library) => {
    mods = (library.mods || []).map(normalize).filter((mod) => {
      return mod.workshop.title.trim() || mod.workshop.publishedId.trim();
    });
    dismissed = (library.dismissed || []).map(String);
    if (library.warning) {
      appendLog(library.warning);
    }
    if (!selected() && mods.length) {
      selectedId = mods[0].id;
    }
    if (selected()) {
      fillForm(selected());
    } else {
      selectedId = '';
    }
    renderList();
  });
}

let previewView = document.querySelector('#preview-view');
const previewPane = document.querySelector('#preview-pane');
let previewObjectUrl = '';
const themeIcons = {
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0-5h0v2h0V2zm0 18h0v2h0v-2zM4.2 5.6 5.6 4.2l1.4 1.4-1.4 1.4zm12.8 12.8 1.4-1.4 1.4 1.4-1.4 1.4zM2 12h2v0H2zm18 0h2v0h-2zM4.2 18.4l1.4-1.4 1.4 1.4-1.4 1.4zm12.8-12.8 1.4 1.4 1.4-1.4-1.4-1.4z"/></svg>',
  neon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>'
};
let previewPath = '';

function clearPreview() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = '';
  }
  previewView.removeAttribute('src');
  previewPane.classList.remove('has-image');
}

function paintPreview(requested, url) {
  if (previewPath !== requested) {
    return;
  }
  clearPreview();
  if (!url) {
    return;
  }
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  let src = url;
  if (match) {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    previewObjectUrl = URL.createObjectURL(new Blob([bytes], { type: match[1] }));
    src = previewObjectUrl;
  }
  const next = document.createElement('img');
  next.id = 'preview-view';
  next.alt = 'Workshop preview';
  previewPane.classList.add('has-image');
  next.src = src;
  previewView.replaceWith(next);
  previewView = next;
}

function showPreview(file) {
  const requested = file || '';
  previewPath = requested;
  if (!requested) {
    clearPreview();
    return;
  }
  window.updater.previewData(requested).then((url) => {
    try {
      paintPreview(requested, url);
    } catch (error) {
      if (previewPath === requested) {
        clearPreview();
      }
    }
  }).catch(() => {
    if (previewPath === requested) {
      clearPreview();
    }
  });
}

document.querySelector('#open-mod-folder').addEventListener('click', async () => {
  const mod = selected();
  if (!mod) {
    return;
  }
  try {
    const folder = await window.updater.openModFolder(mod);
    appendLog(`Opened ${folder}`);
  } catch (error) {
    appendLog(error.message);
  }
});

previewPane.addEventListener('click', async () => {
  if (busy || !selected() || selected().locked) {
    return;
  }
  const image = await window.updater.chooseImage();
  const mod = selected();
  if (!image || !mod) {
    return;
  }
  try {
    const stored = await window.updater.storePreview(mod.workshop.publishedId || mod.id, image);
    mod.workshop.previewImage = stored;
    showPreview(stored);
    readForm(mod);
    await persist();
  } catch (error) {
    appendLog(error.message);
  }
});

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'neon';
  document.documentElement.dataset.theme = next;
  const button = document.querySelector('#theme-toggle');
  const label = next === 'light' ? 'Neon' : 'Light';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = next === 'light' ? themeIcons.neon : themeIcons.light;
}

document.querySelector('#mod-search').addEventListener('input', (event) => {
  query = event.target.value;
  renderList();
});

document.querySelector('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'neon' : 'light';
  applyTheme(next);
  window.updater.saveSettings({ theme: next }).catch((error) => appendLog(error.message));
});

const settingsModal = document.querySelector('#settings-modal');

document.querySelector('#open-settings').addEventListener('click', async () => {
  const current = await window.updater.getSettings();
  document.querySelector('#settings-data').value = current.dataFolder;
  document.querySelector('#settings-library').value = current.libraryFile;
  document.querySelector('#settings-steam').value = current.steamDir || '';
  document.querySelector('#settings-publisher').value = current.publisherDir || '';
  settingsModal.hidden = false;
});

document.querySelector('#settings-cancel').addEventListener('click', () => {
  settingsModal.hidden = true;
});

document.querySelector('#settings-data-browse').addEventListener('click', async () => {
  const folder = await window.updater.chooseFolder();
  if (folder) {
    document.querySelector('#settings-data').value = folder;
  }
});

document.querySelector('#settings-library-browse').addEventListener('click', async () => {
  const file = await window.updater.chooseLibraryFile();
  if (file) {
    document.querySelector('#settings-library').value = file;
  }
});

document.querySelector('#settings-steam-browse').addEventListener('click', async () => {
  const folder = await window.updater.chooseFolder('Steam folder');
  if (folder) {
    document.querySelector('#settings-steam').value = folder;
  }
});

document.querySelector('#settings-publisher-browse').addEventListener('click', async () => {
  const folder = await window.updater.chooseFolder('DayZ Publisher folder');
  if (folder) {
    document.querySelector('#settings-publisher').value = folder;
  }
});

document.querySelector('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const saved = await window.updater.saveSettings({
      dataFolder: document.querySelector('#settings-data').value.trim(),
      libraryFile: document.querySelector('#settings-library').value.trim(),
      steamDir: document.querySelector('#settings-steam').value.trim(),
      publisherDir: document.querySelector('#settings-publisher').value.trim()
    });
    settingsModal.hidden = true;
    appendLog(`Data folder ${saved.dataFolder}`);
    appendLog(`Steam folder ${saved.steamDir}`);
    appendLog(`DayZ Publisher ${saved.publisherDir}`);
    await loadLibrary();
  } catch (error) {
    appendLog(error.message);
  }
});

window.updater.getSettings().then((current) => {
  applyTheme(current.theme);
}).catch((error) => appendLog(error.message));

loadLibrary().catch((error) => {
  appendLog(error.message);
  renderList();
});
