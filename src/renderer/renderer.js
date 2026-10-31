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
// Mods ticked for Push marked. Kept for this session only.
const marked = new Set();

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
    locked: false,
    lastPush: null,
    changeNotes: []
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
    locked: Boolean(mod.locked),
    lastPush: cleanLastPush(mod.lastPush),
    changeNotes: Array.isArray(mod.changeNotes) ? mod.changeNotes.map(String).filter(Boolean).slice(0, 10) : []
  };
}

function cleanLastPush(value) {
  if (!value || !Number.isFinite(value.at)) {
    return null;
  }
  return { at: value.at, ok: Boolean(value.ok), message: String(value.message || '') };
}

// Electron wraps errors from the main process in its own prefix.
function ipcMessage(error) {
  return String((error && error.message) || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function timeAgo(at) {
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 45) {
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }
  return new Date(at).toLocaleDateString();
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// The first line a change note gets when none was written: the mod.cpp version and today.
function changeNoteTemplate(mod) {
  const version = String((mod && mod.modCpp.version) || '').trim().replace(/^v/i, '');
  return version ? `v${version} · ${today()}` : today();
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
  // Tags the list does not know get an option, so saving the form keeps them.
  const known = new Set(Array.from(fields.tags.options).map((option) => option.value));
  const extra = Array.from(picked).filter((tag) => !known.has(tag));
  if (extra.length) {
    let group = fields.tags.querySelector('optgroup[data-extra]');
    if (!group) {
      group = document.createElement('optgroup');
      group.label = 'From the workshop';
      group.dataset.extra = 'true';
      fields.tags.appendChild(group);
    }
    extra.forEach((tag) => {
      const option = document.createElement('option');
      option.textContent = tag;
      group.appendChild(option);
    });
  }
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
  fillChangeNotes(mod);
  showPreview(mod.workshop.previewImage);
  applyLock(mod);
  if (mod.contentFolder) {
    checkFolder({ quiet: true });
  } else {
    clearSignatureReport();
  }
}

const recentNotes = document.querySelector('#change-note-recent');

function fillChangeNotes(mod) {
  fields.changeNote.placeholder = `Empty: the push writes "${changeNoteTemplate(mod)}"`;
  recentNotes.replaceChildren();
  const head = document.createElement('option');
  head.value = '';
  head.textContent = mod.changeNotes.length ? `Earlier notes (${mod.changeNotes.length})` : 'No earlier notes';
  recentNotes.appendChild(head);
  mod.changeNotes.forEach((note, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    const first = note.split(/\r?\n/)[0];
    option.textContent = first.length > 60 ? `${first.slice(0, 57)}...` : first;
    option.title = note;
    recentNotes.appendChild(option);
  });
  recentNotes.value = '';
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
  'unknown-key': 'Wrong key',
  'key-mismatch': 'Key differs'
};

const signatureHelp = {
  unsigned: 'no .bisign next to it',
  outdated: 'the .pbo is newer than its .bisign, sign it again',
  'no-key': 'keys\\ holds no .bikey',
  'unknown-key': 'signed with a key that is not in keys\\',
  'key-mismatch': 'keys\\ has a .bikey with this name, but it is a different key. Ship the .bikey this PBO was signed with'
};

// One sentence for the push question, from the PBOs and from keys\.
function signatureProblem(report) {
  const parts = [];
  if (report.signed < report.total) {
    parts.push(`${report.total - report.signed} of ${report.total} PBOs are not signed correctly.`);
  }
  (report.keyIssues || []).forEach((issue) => parts.push(issue));
  return parts.join(' ');
}

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
  const keyIssues = report.keyIssues || [];
  if (report.signed < report.total) {
    summary.textContent = `${report.total - report.signed} of ${report.total} PBOs are not signed correctly.`;
  } else if (keyIssues.length) {
    summary.textContent = `All ${report.total} PBOs are signed, but keys\\ needs a look.`;
  } else {
    summary.textContent = `All ${report.total} PBOs are signed with the key in keys\\.`;
  }
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
  const issues = keyIssues.map((issue) => {
    const line = document.createElement('p');
    line.className = 'sig-key-issue';
    line.textContent = issue;
    return line;
  });
  signatureReport.append(summary, keys, ...issues, list);
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
      (report.keyIssues || []).forEach((issue) => appendLog(`  ${issue}`));
      report.pbos.filter((pbo) => pbo.status !== 'signed').forEach((pbo) => {
        appendLog(`  ${pbo.name}: ${signatureStates[pbo.status] || pbo.status}, ${signatureHelp[pbo.status] || ''}`);
      });
    }
    return report;
  } catch (error) {
    const message = ipcMessage(error);
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
    const isContributor = roleOf(mod) === 'contributor';
    row.className = mod.id === selectedId ? 'mod-row active' : 'mod-row';
    row.classList.toggle('contributor', isContributor);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mod-select';
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = mod.displayName || 'Untitled mod';
    const meta = document.createElement('span');
    meta.className = 'meta';
    const role = document.createElement('span');
    role.className = isContributor ? 'role contributor' : 'role';
    const roleName = isContributor ? 'Contributor' : 'Owner';
    role.textContent = mod.locked ? `${roleName} · Locked` : roleName;
    meta.append(role);
    if (mod.lastPush) {
      const state = document.createElement('span');
      state.className = mod.lastPush.ok ? 'push-state ok' : 'push-state bad';
      const when = new Date(mod.lastPush.at).toLocaleString();
      state.title = `Last push ${when}: ${mod.lastPush.ok ? 'finished' : 'failed'}. ${mod.lastPush.message}`.trim();
      state.textContent = timeAgo(mod.lastPush.at);
      meta.append(state);
    }
    text.append(name, meta);
    button.append(text);
    button.addEventListener('click', () => {
      selectMod(mod.id);
    });
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'mod-mark';
    tick.checked = marked.has(mod.id);
    tick.disabled = busy || mod.locked;
    tick.title = mod.locked ? 'Locked mods are not pushed' : 'Tick for Push marked';
    tick.setAttribute('aria-label', `Tick ${mod.displayName || 'mod'} for Push marked`);
    tick.addEventListener('change', () => {
      if (tick.checked) {
        marked.add(mod.id);
      } else {
        marked.delete(mod.id);
      }
      renderMarked();
    });
    row.append(tick, button);
    modList.appendChild(row);
  });
  renderMarked();
  const hasMod = Boolean(selected());
  empty.hidden = hasMod;
  form.hidden = !hasMod;
  document.querySelector('#add-mod').disabled = busy || mods.some((mod) => mod.draft);
  refreshViewSteam();
}

// Ticked mods that can still be pushed: saved, unlocked and in the library.
function markedMods() {
  return savedMods().filter((mod) => marked.has(mod.id) && !mod.locked);
}

function renderMarked() {
  const ids = new Set(mods.map((mod) => mod.id));
  Array.from(marked).forEach((id) => {
    if (!ids.has(id)) {
      marked.delete(id);
    }
  });
  const count = markedMods().length;
  document.querySelector('#marked-count').textContent = String(count);
  document.querySelector('#push-marked').disabled = busy || count === 0;
  document.querySelector('#mark-none').hidden = marked.size === 0;
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
  renderList();
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
  document.querySelector('#change-note-template').disabled = busy || locked;
  document.querySelector('#read-mod-files').disabled = busy || locked;
  document.querySelectorAll('[data-image-browse]').forEach((button) => {
    button.disabled = busy || locked;
  });
}

function queueSave() {
  const mod = selected();
  if (!mod || busy || mod.locked) {
    return;
  }
  readForm(mod);
  fields.changeNote.placeholder = `Empty: the push writes "${changeNoteTemplate(mod)}"`;
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
  window.updater.saveSettings({ lastModId: id }).catch(() => {});
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

const MOD_CPP_KEYS = ['name', 'version', 'author', 'authorID', 'tooltip', 'overview', 'action', 'picture', 'logo', 'logoSmall', 'logoOver'];

// The other way round from Save: mod.cpp and meta.cpp in the content folder fill the form.
document.querySelector('#read-mod-files').addEventListener('click', async () => {
  const mod = selected();
  if (!mod || mod.locked) {
    return;
  }
  readForm(mod);
  if (!mod.contentFolder) {
    appendLog('Choose a content folder to read mod.cpp and meta.cpp from.');
    return;
  }
  let found;
  try {
    found = await window.updater.readFiles(mod.contentFolder);
  } catch (error) {
    appendLog(ipcMessage(error));
    return;
  }
  const changed = [];
  if (found.modCpp) {
    MOD_CPP_KEYS.forEach((key) => {
      const value = found.modCpp[key] || '';
      if (fields[key].value !== value) {
        fields[key].value = value;
        changed.push(key);
      }
    });
  }
  if (found.meta) {
    // meta.cpp only carries the name when mod.cpp has none.
    if (!fields.name.value && found.meta.name) {
      fields.name.value = found.meta.name;
      changed.push('name');
    }
    const id = found.meta.publishedId;
    if (id && !mod.workshop.publishedId) {
      mod.workshop.publishedId = id;
      fields.publishedId.value = id;
      changed.push('published file id');
    } else if (id && id !== String(mod.workshop.publishedId)) {
      appendLog(`meta.cpp names published file id ${id}, this mod has ${mod.workshop.publishedId}. Kept ${mod.workshop.publishedId}.`);
    }
  }
  [found.modPath, found.metaPath].filter(Boolean).forEach((file) => appendLog(`Read ${file}`));
  if (!found.modPath) {
    appendLog(`No mod.cpp in ${found.folder}, only meta.cpp.`);
  }
  appendLog(changed.length ? `Took over from the files: ${changed.join(', ')}.` : 'The form already matches the files.');
  if (changed.length) {
    queueSave();
  }
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
  copy.lastPush = null;
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

// Checks and questions before a push. Returns false when the mod should not be
// pushed. Runs before the splash opens, so its questions stay clickable.
async function preparePush(mod) {
  if (mod.locked) {
    appendLog(`${mod.displayName}: locked. Enter its published file id to unlock it.`);
    return false;
  }
  if (mod.id === selectedId) {
    readForm(mod);
  }
  const missing = missingRequired(mod);
  if (missing.length) {
    appendLog(`${mod.displayName}: push needs ${missing.join(', ')}.`);
    return false;
  }
  let report = null;
  if (mod.id === selectedId) {
    report = await checkFolder();
  } else {
    try {
      report = await window.updater.checkSignatures(mod.contentFolder);
    } catch (error) {
      appendLog(`${mod.displayName}: ${ipcMessage(error)}`);
    }
  }
  if (!report) {
    appendLog(`${mod.displayName}: push stopped. Fix the content folder first.`);
    return false;
  }
  if (!report.ok && !window.confirm(`${mod.displayName}: ${signatureProblem(report)} Servers that check signatures can kick players. Push anyway?`)) {
    appendLog(`${mod.displayName}: push cancelled.`);
    return false;
  }
  if (mod.uploadMode === 'contributor') {
    const choice = await reviewWorkshopPage(mod);
    if (choice === 'adopt') {
      appendLog(`${mod.displayName}: took over the workshop page. Check the form and push again.`);
      return false;
    }
    if (choice !== 'push') {
      appendLog(`${mod.displayName}: push cancelled.`);
      return false;
    }
  }
  return true;
}

// A finished push moves its change note to the earlier notes, so the next push
// starts empty and gets a fresh date.
function recordPush(mod, ok, message) {
  mod.lastPush = { at: Date.now(), ok, message: String(message || '').slice(0, 300) };
  if (!ok) {
    return;
  }
  const note = mod.workshop.changeNote.trim();
  if (note) {
    mod.changeNotes = [note, ...mod.changeNotes.filter((item) => item !== note)].slice(0, 10);
    mod.workshop.changeNote = '';
  }
}

// Uploads one prepared mod. The splash must already be open.
async function runPush(mod) {
  if (!mod.workshop.changeNote.trim()) {
    mod.workshop.changeNote = changeNoteTemplate(mod);
    if (mod.id === selectedId) {
      fields.changeNote.value = mod.workshop.changeNote;
    }
    appendLog(`${mod.displayName}: change note "${mod.workshop.changeNote}".`);
  }
  mod.draft = false;
  const role = mod.uploadMode === 'contributor' ? 'contributor' : 'owner';
  const start = `Uploading ${mod.displayName || 'mod'} as ${role}...`;
  appendLog(start);
  splashProgress(start);
  let target = mod;
  let ok = false;
  let message = '';
  try {
    await persist();
    const result = await window.updater.upload(mod);
    if (result.mod) {
      const index = mods.findIndex((item) => item.id === mod.id);
      if (index >= 0) {
        mods[index] = normalize(result.mod);
        target = mods[index];
      }
    }
    ok = Boolean(result.ok);
    message = describeResult(result);
  } catch (error) {
    message = ipcMessage(error);
  }
  recordPush(target, ok, message);
  if (target.id === selectedId) {
    fillForm(target);
  }
  renderList();
  try {
    await persist();
  } catch (error) {
    appendLog(error.message);
  }
  appendLog(message);
  splashProgress(message);
  return ok;
}

async function uploadOne(mod) {
  if (busy || !(await preparePush(mod))) {
    return;
  }
  mod.draft = false;
  renderList();
  pushing = true;
  clearTimeout(splashIdle);
  setBusy(true);
  showSplash(`Pushing ${mod.displayName || 'mod'}`);
  try {
    await runPush(mod);
  } finally {
    pushing = false;
    setBusy(false);
    window.setTimeout(hideSplash, 900);
  }
}

// Asks every question first, then pushes the ready mods one after another
// without stopping, so a long batch can run unattended.
async function pushMarked() {
  if (busy) {
    return;
  }
  const current = selected();
  if (current) {
    readForm(current);
  }
  const list = markedMods();
  const ready = [];
  for (let index = 0; index < list.length; index += 1) {
    if (await preparePush(list[index])) {
      ready.push(list[index]);
    }
  }
  const skipped = list.length - ready.length;
  if (!ready.length) {
    appendLog(`Push marked: nothing pushed, ${skipped} skipped.`);
    return;
  }
  pushing = true;
  clearTimeout(splashIdle);
  setBusy(true);
  showSplash(`Pushing ${ready.length} mods`);
  let done = 0;
  let failed = 0;
  try {
    for (let index = 0; index < ready.length; index += 1) {
      const mod = ready[index];
      document.querySelector('#splash-title').textContent = `Pushing ${index + 1} of ${ready.length}: ${mod.displayName || 'mod'}`;
      if (await runPush(mod)) {
        done += 1;
        marked.delete(mod.id);
      } else {
        failed += 1;
      }
    }
  } finally {
    pushing = false;
    setBusy(false);
    const summary = `Push marked: ${done} finished, ${failed} failed, ${skipped} skipped.`;
    appendLog(summary);
    splashProgress(summary);
    renderList();
    window.setTimeout(hideSplash, failed ? 2500 : 900);
  }
}

const diffModal = document.querySelector('#diff-modal');
const visibilityNames = { public: 'Public', friends: 'Friends only', private: 'Private' };
let diffResolve = null;

function closeDiff(choice) {
  if (!diffResolve) {
    return;
  }
  const resolve = diffResolve;
  diffResolve = null;
  diffModal.hidden = true;
  resolve(choice);
}

function normText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

function tagKey(value) {
  return String(value || '').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean).sort().join(',');
}

// Line diff by longest common subsequence. Null when the texts are too long for it.
function lineDiff(before, after) {
  const a = normText(before).split('\n');
  const b = normText(after).split('\n');
  if (a.length * b.length > 400000) {
    return null;
  }
  const cols = b.length + 1;
  const table = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) {
    out.push({ kind: 'del', text: a[i] });
  }
  for (; j < b.length; j += 1) {
    out.push({ kind: 'add', text: b[j] });
  }
  return out;
}

// Changed lines with one line of context. Long unchanged stretches fold into a note.
function renderLineDiff(lines) {
  const box = document.createElement('pre');
  box.className = 'diff-lines';
  const keep = lines.map((line, index) => line.kind !== 'same'
    || (index > 0 && lines[index - 1].kind !== 'same')
    || (index < lines.length - 1 && lines[index + 1].kind !== 'same'));
  let hidden = 0;
  const flush = () => {
    if (hidden) {
      const fold = document.createElement('span');
      fold.className = 'diff-fold';
      fold.textContent = `… ${hidden} unchanged line${hidden === 1 ? '' : 's'} …`;
      box.appendChild(fold);
      hidden = 0;
    }
  };
  lines.forEach((line, index) => {
    if (!keep[index]) {
      hidden += 1;
      return;
    }
    flush();
    const row = document.createElement('span');
    row.className = `diff-line ${line.kind}`;
    const mark = { same: '  ', del: '- ', add: '+ ' }[line.kind];
    row.textContent = `${mark}${line.text}`;
    box.appendChild(row);
  });
  flush();
  return box;
}

function diffPart(label, changed, known) {
  const part = document.createElement('section');
  part.className = changed ? 'diff-part changed' : 'diff-part';
  const head = document.createElement('h3');
  head.textContent = label;
  const badge = document.createElement('span');
  badge.className = 'diff-badge';
  if (!known) {
    badge.textContent = 'set by push';
  } else {
    badge.textContent = changed ? 'changes' : 'same';
  }
  head.appendChild(badge);
  part.appendChild(head);
  return part;
}

function diffValues(part, before, after, known) {
  if (known) {
    const old = document.createElement('p');
    old.className = 'diff-old';
    old.textContent = before || '(empty)';
    part.appendChild(old);
  }
  const next = document.createElement('p');
  next.className = 'diff-new';
  next.textContent = after || '(empty)';
  part.appendChild(next);
}

// A contributor push replaces the whole workshop page. Shows the page as it is
// now next to what the form will put there, and asks how to go on.
async function reviewWorkshopPage(mod) {
  const id = String(mod.workshop.publishedId || '').trim();
  const current = await window.updater.workshopDetails(id).catch((error) => ({ ok: false, error: ipcMessage(error) }));
  const known = Boolean(current.ok);
  const body = document.querySelector('#diff-body');
  body.replaceChildren();
  const title = mod.workshop.title.trim() || mod.modCpp.name || mod.displayName || '';
  const visibility = mod.workshop.visibility || 'public';
  let changes = 0;

  const simple = [
    ['Title', current.title, title, normText(current.title) !== normText(title)],
    ['Visibility', visibilityNames[current.visibility] || current.visibility, visibilityNames[visibility] || visibility, current.visibility !== visibility],
    ['Tags', current.tags, mod.workshop.tags, tagKey(current.tags) !== tagKey(mod.workshop.tags)]
  ];
  simple.forEach(([label, before, after, differs]) => {
    const changed = !known || differs;
    changes += changed ? 1 : 0;
    const part = diffPart(label, changed, known);
    if (changed) {
      diffValues(part, before, after, known);
    } else {
      diffValues(part, '', after, false);
    }
    body.appendChild(part);
  });

  const preview = mod.workshop.previewImage;
  const previewPart = diffPart('Preview image', Boolean(preview), false);
  previewPart.querySelector('.diff-badge').textContent = preview ? 'replaced' : 'kept';
  diffValues(previewPart, '', preview ? `Replaced by ${preview.split(/[\\/]/).pop()}` : 'The form has no preview image, so the workshop keeps its own.', false);
  body.appendChild(previewPart);
  changes += preview ? 1 : 0;

  const descriptionChanged = !known || normText(current.description) !== normText(mod.workshop.description);
  changes += descriptionChanged ? 1 : 0;
  const descriptionPart = diffPart('Description', descriptionChanged, known);
  if (known && descriptionChanged) {
    const lines = lineDiff(current.description, mod.workshop.description);
    if (lines) {
      descriptionPart.appendChild(renderLineDiff(lines));
    } else {
      diffValues(descriptionPart, current.description, mod.workshop.description, true);
    }
  } else {
    const count = normText(mod.workshop.description).length;
    diffValues(descriptionPart, '', count ? `${count} characters` : '', false);
  }
  body.appendChild(descriptionPart);

  const intro = document.querySelector('#diff-intro');
  if (known) {
    intro.textContent = `A contributor push replaces the whole workshop page of "${current.title}" (${id}). ${changes} of 5 parts change. Red is on the workshop now and will be gone, green comes from the form.`;
  } else {
    intro.textContent = `${current.error} The push sets the page to the values below. Compare them with the workshop page before you push.`;
  }
  document.querySelector('#diff-title').textContent = `Check before push: ${mod.displayName || 'mod'}`;
  document.querySelector('#diff-adopt').disabled = !known;
  const choice = await new Promise((resolve) => {
    diffResolve = resolve;
    diffModal.hidden = false;
    document.querySelector('#diff-cancel').focus();
  });
  if (choice === 'adopt' && known) {
    await adoptWorkshopPage(mod, current);
  }
  return choice;
}

async function adoptWorkshopPage(mod, current) {
  mod.workshop.title = current.title;
  mod.workshop.description = current.description;
  mod.workshop.tags = current.tags;
  mod.workshop.visibility = current.visibility;
  try {
    const preview = await window.updater.workshopPreview(mod.workshop.publishedId, current.previewUrl);
    if (preview) {
      mod.workshop.previewImage = preview;
    }
  } catch (error) {
    appendLog(ipcMessage(error));
  }
  if (mod.id === selectedId) {
    fillForm(mod);
  }
  renderList();
  persist().catch((error) => appendLog(error.message));
}

document.querySelector('#diff-cancel').addEventListener('click', () => closeDiff('cancel'));
document.querySelector('#diff-adopt').addEventListener('click', () => closeDiff('adopt'));
document.querySelector('#diff-push').addEventListener('click', () => closeDiff('push'));

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
  const folder = await window.updater.chooseFolder('Mod content folder', contentFolder.value);
  if (!folder) {
    return;
  }
  contentFolder.value = folder;
  queueSave();
  checkFolder();
});

document.querySelector('#content-folder-open').addEventListener('click', () => {
  const folder = cleanPath(contentFolder.value);
  if (!folder) {
    appendLog('Enter or paste a mod folder path first.');
    return;
  }
  window.updater.openFolder(folder)
    .then((opened) => appendLog(`Opened ${opened}`))
    .catch((error) => appendLog(ipcMessage(error)));
});

// A folder dropped on the content folder box becomes the content folder. A dropped
// file stands for the folder it is in.
const contentFolderBox = document.querySelector('#content-folder-box');
contentFolderBox.addEventListener('dragover', (event) => {
  event.preventDefault();
  const mod = selected();
  const allowed = Boolean(mod && !busy && !mod.locked);
  event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
  contentFolderBox.classList.toggle('is-drop-target', allowed);
});
contentFolderBox.addEventListener('dragleave', (event) => {
  if (!contentFolderBox.contains(event.relatedTarget)) {
    contentFolderBox.classList.remove('is-drop-target');
  }
});
contentFolderBox.addEventListener('drop', async (event) => {
  event.preventDefault();
  contentFolderBox.classList.remove('is-drop-target');
  const mod = selected();
  const dropped = event.dataTransfer.files[0];
  if (!mod || busy || mod.locked || !dropped) {
    return;
  }
  try {
    contentFolder.value = await window.updater.folderOf(window.updater.pathForFile(dropped));
    queueSave();
    checkFolder();
  } catch (error) {
    appendLog(ipcMessage(error));
  }
});

document.querySelector('#change-note-template').addEventListener('click', () => {
  const mod = selected();
  if (!mod || busy || mod.locked) {
    return;
  }
  const line = changeNoteTemplate(mod);
  const text = fields.changeNote.value;
  if (!text.trim()) {
    fields.changeNote.value = `${line}\n- `;
  } else if (!text.startsWith(line)) {
    fields.changeNote.value = `${line}\n${text}`;
  }
  fields.changeNote.focus();
  fields.changeNote.setSelectionRange(fields.changeNote.value.length, fields.changeNote.value.length);
  queueSave();
});

recentNotes.addEventListener('change', () => {
  const mod = selected();
  const picked = recentNotes.value;
  recentNotes.value = '';
  if (!mod || busy || mod.locked || picked === '') {
    return;
  }
  fields.changeNote.value = mod.changeNotes[Number(picked)] || '';
  queueSave();
});

document.querySelector('#push-marked').addEventListener('click', () => {
  pushMarked();
});

document.querySelector('#mark-none').addEventListener('click', () => {
  marked.clear();
  renderList();
});

function anyModalOpen() {
  return Array.from(document.querySelectorAll('.modal')).some((modal) => !modal.hidden) || !splash.hidden;
}

// Ctrl+S saves, Ctrl+Enter pushes, Ctrl+F finds a mod, Esc closes a dialog.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!diffModal.hidden) {
      closeDiff('cancel');
    } else if (!document.querySelector('#unlock-modal').hidden) {
      document.querySelector('#unlock-cancel').click();
    } else if (!settingsModal.hidden) {
      settingsModal.hidden = true;
    } else if (!document.querySelector('#pack-save-modal').hidden) {
      document.querySelector('#pack-save-cancel').click();
    } else if (!document.querySelector('#pack-delete-modal').hidden) {
      document.querySelector('#pack-delete-cancel').click();
    }
    return;
  }
  if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
    return;
  }
  // The Pack view handles its own keys in pack.js.
  if (document.body.dataset.view === 'pack') {
    return;
  }
  const key = event.key.toLowerCase();
  if (key !== 's' && key !== 'f' && key !== 'enter') {
    return;
  }
  event.preventDefault();
  if (anyModalOpen()) {
    return;
  }
  if (key === 'f') {
    const search = document.querySelector('#mod-search');
    search.focus();
    search.select();
    return;
  }
  const button = document.querySelector(key === 's' ? '#save-mod' : '#push-mod');
  if (!form.hidden && !button.disabled) {
    button.click();
  }
});

// Turns a chosen or dropped image file into the in-PBO path that mod.cpp wants.
async function setModImage(key, file) {
  const mod = selected();
  if (!mod || busy || mod.locked || !file) {
    return;
  }
  // The game only loads its own texture formats. PNG, JPG and TGA need converting first.
  if (!/\.(paa|edds)$/i.test(file)) {
    appendLog(`${key}: only .paa and .edds work in DayZ. Convert ${file} first, e.g. with ImageToPAA from DayZ Tools.`);
    return;
  }
  try {
    const result = await window.updater.modImagePath(file, contentFolder.value);
    fields[key].value = result.value;
    queueSave();
    if (result.source === 'content-folder') {
      appendLog(`${key}: ${result.value} is relative to the content folder. Check that it matches the path inside your PBO.`);
    } else if (result.source === 'absolute') {
      appendLog(`${key}: ${file} is not in a PBO source folder ($PBOPREFIX$), on P:\\ or in the content folder. Change it to the path inside your PBO.`);
    }
  } catch (error) {
    appendLog(error.message);
  }
}

document.querySelectorAll('[data-image-browse]').forEach((button) => {
  button.addEventListener('click', async () => {
    const key = button.dataset.imageBrowse;
    const file = await window.updater.chooseModImage(`${key} image`, contentFolder.value);
    setModImage(key, file);
  });
});

document.querySelectorAll('[data-image-field]').forEach((box) => {
  const key = box.dataset.imageField;
  box.addEventListener('dragover', (event) => {
    event.preventDefault();
    const mod = selected();
    const allowed = Boolean(mod && !busy && !mod.locked);
    event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
    box.classList.toggle('is-drop-target', allowed);
  });
  box.addEventListener('dragleave', (event) => {
    if (!box.contains(event.relatedTarget)) {
      box.classList.remove('is-drop-target');
    }
  });
  box.addEventListener('drop', (event) => {
    event.preventDefault();
    box.classList.remove('is-drop-target');
    const dropped = event.dataTransfer.files[0];
    if (dropped) {
      setModImage(key, window.updater.pathForFile(dropped));
    }
  });
});

// A file dropped anywhere else would make the window navigate to it.
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());

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
    // The Pack view lists these mods as destinations.
    if (typeof refreshPackMods === 'function') {
      refreshPackMods();
    }
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

const windowIcons = {
  maximize: '<svg viewBox="0 0 12 12" aria-hidden="true"><path fill="none" stroke="currentColor" d="M1.5 1.5h9v9h-9z"/></svg>',
  restore: '<svg viewBox="0 0 12 12" aria-hidden="true"><path fill="none" stroke="currentColor" d="M1.5 3.5h7v7h-7zM3.5 3.5v-2h7v7h-2"/></svg>'
};

document.querySelector('#window-minimize').addEventListener('click', () => window.updater.windowControl('minimize'));
document.querySelector('#window-maximize').addEventListener('click', () => window.updater.windowControl('maximize'));
document.querySelector('#window-close').addEventListener('click', () => window.updater.windowControl('close'));
document.querySelector('.titlebar').addEventListener('dblclick', (event) => {
  if (!event.target.closest('.window-button')) {
    window.updater.windowControl('maximize');
  }
});
window.updater.onWindowState((state) => {
  const button = document.querySelector('#window-maximize');
  const label = state.maximized ? 'Restore' : 'Maximize';
  document.body.classList.toggle('is-maximized', state.maximized);
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = state.maximized ? windowIcons.restore : windowIcons.maximize;
});

// The credit floats outside the window, lined up with "DayZ Workshop" in the title bar.
function placeCredit() {
  const sub = document.querySelector('.titlebar-sub');
  if (sub) {
    document.documentElement.style.setProperty('--credit-x', `${Math.round(sub.getBoundingClientRect().left)}px`);
  }
}
window.addEventListener('resize', placeCredit);
window.updater.onWindowState(() => window.requestAnimationFrame(placeCredit));
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(placeCredit);
}
placeCredit();

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'neon';
  document.documentElement.dataset.theme = next;
  window.requestAnimationFrame(() => {
    if (typeof placeCredit === 'function') {
      placeCredit();
    }
  });
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
  document.querySelector('#settings-addon-builder').value = current.addonBuilder || '';
  document.querySelector('#settings-files').value = current.filesTemplate || '';
  settingsModal.hidden = false;
});

document.querySelector('#settings-cancel').addEventListener('click', () => {
  settingsModal.hidden = true;
});

document.querySelector('#settings-data-browse').addEventListener('click', async () => {
  const folder = await window.updater.chooseFolder('Data folder', document.querySelector('#settings-data').value);
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
  const folder = await window.updater.chooseFolder('Steam folder', document.querySelector('#settings-steam').value);
  if (folder) {
    document.querySelector('#settings-steam').value = folder;
  }
});

document.querySelector('#settings-publisher-browse').addEventListener('click', async () => {
  const folder = await window.updater.chooseFolder('DayZ Publisher folder', document.querySelector('#settings-publisher').value);
  if (folder) {
    document.querySelector('#settings-publisher').value = folder;
  }
});

document.querySelector('#settings-addon-builder-browse').addEventListener('click', async () => {
  const input = document.querySelector('#settings-addon-builder');
  const file = await window.updater.chooseFile('AddonBuilder.exe', input.value, 'exe');
  if (file) {
    input.value = file;
  }
});

document.querySelector('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const saved = await window.updater.saveSettings({
      dataFolder: document.querySelector('#settings-data').value.trim(),
      libraryFile: document.querySelector('#settings-library').value.trim(),
      steamDir: document.querySelector('#settings-steam').value.trim(),
      publisherDir: document.querySelector('#settings-publisher').value.trim(),
      addonBuilder: document.querySelector('#settings-addon-builder').value.trim(),
      filesTemplate: document.querySelector('#settings-files').value.trim()
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
  selectedId = current.lastModId || '';
}).catch((error) => appendLog(error.message)).then(() => loadLibrary()).catch((error) => {
  appendLog(error.message);
  renderList();
});

// Keeps "2 h ago" in the list current.
window.setInterval(() => {
  if (!busy) {
    renderList();
  }
}, 60000);
