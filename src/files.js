const fs = require('fs');
const path = require('path');
const os = require('os');

const MOD_FIELDS = [
  'name',
  'picture',
  'logo',
  'logoSmall',
  'logoOver',
  'tooltip',
  'overview',
  'action',
  'author',
  'authorID',
  'version'
];

const DOTNET_EPOCH_TICKS = 621355968000000000n;
const UTC_KIND_FLAG = 1n << 62n;

function escapeQuoted(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

function dateTimeToBinaryUtc(date) {
  const ticks = BigInt(date.getTime()) * 10000n + DOTNET_EPOCH_TICKS;
  return (ticks | UTC_KIND_FLAG).toString();
}

function publishedIdOrZero(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return '0';
  }
  if (!/^\d+$/.test(text)) {
    throw new Error('Published file id must be a number.');
  }
  return text;
}

function metaName(mod) {
  return mod.modCpp.name || mod.workshop.title || mod.displayName || '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Creates mod.cpp from the form when the mod has none. An existing mod.cpp only
// has the lines that differ from the form rewritten, so extra keys survive.
function writeModCpp(modPath, values) {
  if (!fs.existsSync(modPath)) {
    const lines = MOD_FIELDS
      .filter((key) => values[key] != null && String(values[key]).trim() !== '')
      .map((key) => `${key} = "${escapeQuoted(values[key])}";`);
    if (lines.length === 0) {
      return false;
    }
    fs.writeFileSync(modPath, `${lines.join(os.EOL)}${os.EOL}`, 'utf8');
    return true;
  }
  const original = readCppText(modPath);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original;
  MOD_FIELDS.forEach((key) => {
    const wanted = values[key] == null ? '' : String(values[key]);
    if (wanted === readFromText(text, key)) {
      return;
    }
    const line = `${key} = "${escapeQuoted(wanted)}";`;
    const pattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*$`, 'mi');
    if (pattern.test(text)) {
      text = text.replace(pattern, line);
    } else if (wanted) {
      text = `${text.replace(/\s*$/, '')}${eol}${line}${eol}`;
    }
  });
  if (text === original) {
    return false;
  }
  fs.writeFileSync(modPath, text, 'utf8');
  return true;
}

// Image paths keep their backslashes, so \n there is a folder, not a line break.
const PATH_FIELDS = ['picture', 'logo', 'logoSmall', 'logoOver'];

// Undoes escapeQuoted, and the doubled quote a hand-written config uses.
function unescapeQuoted(value, key) {
  return value.replace(/""|\\(["\\n])/g, (match, escaped) => {
    if (match === '""') {
      return '"';
    }
    if (escaped === 'n') {
      return PATH_FIELDS.includes(key) ? match : '\n';
    }
    return escaped;
  });
}

// Same matching as workshop.readCppValue, which filled the form on import, but
// keys match in any case and escaped quotes stay inside the value.
function readFromText(text, key) {
  const name = escapeRegExp(key);
  const quoted = new RegExp(`^\\s*${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.|"")*)"\\s*;`, 'mi');
  const bare = new RegExp(`^\\s*${name}\\s*=\\s*([^;"]+);`, 'mi');
  const match = text.match(quoted);
  if (match) {
    return unescapeQuoted(match[1], key).trim();
  }
  const plain = text.match(bare);
  return plain ? plain[1].trim() : '';
}

function readCppText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function findPrivateKeys(folder) {
  const found = [];
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop();
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.name.toLowerCase().endsWith('.biprivatekey')) {
        found.push(full);
      }
    });
  }
  return found;
}

// Cleans a pasted folder path. Explorer's "Copy as path" wraps it in quotes.
function cleanFolderInput(value) {
  let text = String(value == null ? '' : value).trim();
  while (text.length > 1 && /^["']/.test(text) && text[0] === text[text.length - 1]) {
    text = text.slice(1, -1).trim();
  }
  if (!text) {
    return '';
  }
  const resolved = path.resolve(text);
  const root = path.parse(resolved).root;
  return resolved.length > root.length ? resolved.replace(/[\\/]+$/, '') : resolved;
}

// A .bisign and a .bikey both start with the authority name, ended by a zero byte,
// then a 32-bit length and the public key itself. Two keys can share a name, so the
// key bytes are what tells them apart.
function readKeyInfo(file) {
  const handle = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(2048);
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
    const end = buffer.indexOf(0);
    const nameEnd = end >= 0 && end < read ? end : read;
    const name = buffer.toString('latin1', 0, nameEnd).trim();
    let publicKey = '';
    if (nameEnd + 5 <= read) {
      const length = buffer.readUInt32LE(nameEnd + 1);
      const start = nameEnd + 5;
      if (length > 0 && start + length <= read) {
        publicKey = buffer.toString('hex', start, start + length);
      }
    }
    return { name, publicKey };
  } finally {
    fs.closeSync(handle);
  }
}

function listFiles(folder, extension) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return [];
  }
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => path.join(folder, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

// Accepts the mod folder (@Mod), its addons folder, or any folder holding .pbo files.
function locateModParts(folder) {
  const addons = path.join(folder, 'addons');
  if (path.basename(folder).toLowerCase() === 'addons') {
    return { root: path.dirname(folder), addons: folder };
  }
  if (fs.existsSync(addons) && fs.statSync(addons).isDirectory()) {
    return { root: folder, addons };
  }
  return { root: folder, addons: folder };
}

// A current bisign is signed even when its .bikey is not in the mod. A server pack
// often has no keys folder: the key stays on the server. A bisign whose key name is
// not ownKey is third-party and is not a warning. ownKey is the private key's name.
function pboSignatureStatus(signatures, own) {
  if (signatures.length === 0) {
    return 'unsigned';
  }
  const current = signatures.filter((sig) => !sig.outdated);
  if (current.length === 0) {
    return 'outdated';
  }
  const usable = current.filter((sig) => !sig.nameOnly);
  if (usable.length === 0) {
    return 'key-mismatch';
  }
  if (own && usable.some((sig) => sig.keyName.toLowerCase() === own)) {
    return 'signed';
  }
  if (own) {
    return 'prepacked';
  }
  return 'signed';
}

// Deletes one PBO and every bisign that belongs to it. The keys folder is left alone.
function removePbo(file) {
  const pbo = cleanFolderInput(file);
  if (!pbo || !fs.existsSync(pbo) || !fs.statSync(pbo).isFile() || !pbo.toLowerCase().endsWith('.pbo')) {
    throw new Error('That PBO is not in the addons folder.');
  }
  const dir = path.dirname(pbo);
  const base = path.basename(pbo);
  const prefix = `${base.toLowerCase()}.`;
  const removed = [];
  fs.readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) {
      return;
    }
    const lower = name.toLowerCase();
    if (lower === base.toLowerCase() || (lower.startsWith(prefix) && lower.endsWith('.bisign'))) {
      fs.unlinkSync(full);
      removed.push(name);
    }
  });
  return { file: pbo, removed };
}

// Copies a .bisign next to a PBO. A file named Key.bisign becomes Name.pbo.Key.bisign.
function attachBisign(pboFile, bisignFile) {
  const pbo = cleanFolderInput(pboFile);
  const source = cleanFolderInput(bisignFile);
  if (!pbo || !fs.existsSync(pbo) || !fs.statSync(pbo).isFile() || !pbo.toLowerCase().endsWith('.pbo')) {
    throw new Error('Choose a .pbo to attach the bisign to.');
  }
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile() || !source.toLowerCase().endsWith('.bisign')) {
    throw new Error('Choose a .bisign file.');
  }
  const pboName = path.basename(pbo);
  let destName = path.basename(source);
  if (!destName.toLowerCase().startsWith(`${pboName.toLowerCase()}.`)) {
    destName = `${pboName}.${destName}`;
  }
  const dest = path.join(path.dirname(pbo), destName);
  fs.copyFileSync(source, dest);
  return dest;
}

// Checks every .pbo for a current .bisign. The .bikey does not have to be in keys\.
// A .bisign older than its .pbo is outdated: the PBO was rebuilt after it was signed.
function checkSignatures(input, ownKeyName) {
  const ownLabel = String(ownKeyName || '').trim().replace(/\.biprivatekey$/i, '');
  const own = ownLabel.toLowerCase();
  const folder = cleanFolderInput(input);
  if (!folder) {
    throw new Error('Enter or paste a mod folder path.');
  }
  if (!fs.existsSync(folder)) {
    throw new Error(`Folder not found: ${folder}`);
  }
  if (!fs.statSync(folder).isDirectory()) {
    throw new Error(`That is a file, not a folder: ${folder}`);
  }
  const { root, addons } = locateModParts(folder);
  const pboFiles = listFiles(addons, '.pbo');
  if (pboFiles.length === 0) {
    throw new Error(`No .pbo files in ${addons}. Choose the mod folder that holds addons\\.`);
  }

  const keys = ['keys', 'key']
    .map((name) => path.join(root, name))
    .flatMap((dir) => listFiles(dir, '.bikey'))
    .filter((file, index, all) => all.findIndex((other) => other.toLowerCase() === file.toLowerCase()) === index)
    .map((file) => ({ file, ...readKeyInfo(file) }));
  const bisigns = listFiles(addons, '.bisign');

  const pbos = pboFiles.map((file) => {
    const prefix = `${path.basename(file).toLowerCase()}.`;
    const pboTime = fs.statSync(file).mtimeMs;
    const signatures = bisigns
      .filter((sig) => path.basename(sig).toLowerCase().startsWith(prefix))
      .map((sig) => {
        const info = readKeyInfo(sig);
        const sameName = keys.filter((key) => key.name.toLowerCase() === info.name.toLowerCase());
        // An unreadable key body falls back to the name, as before.
        const match = sameName.find((key) => !key.publicKey || !info.publicKey || key.publicKey === info.publicKey);
        return {
          file: sig,
          keyName: info.name,
          keyFound: Boolean(match),
          keyFile: match ? match.file : '',
          nameOnly: !match && sameName.length > 0,
          outdated: fs.statSync(sig).mtimeMs + 2000 < pboTime
        };
      });
    const status = pboSignatureStatus(signatures, own);
    return { file, name: path.basename(file), status, signatures };
  });

  // Servers kick on a missing key, and a second key is usually a stale one left
  // behind after a new key was made. Both are worth a look before a push.
  const keyIssues = [];
  if (keys.length > 1) {
    keyIssues.push(`keys\\ holds ${keys.length} .bikey files. A mod normally ships exactly one.`);
  }
  keys.forEach((key) => {
    const used = pbos.some((pbo) => pbo.signatures.some((sig) => sig.keyFile === key.file));
    if (!used) {
      keyIssues.push(`${path.basename(key.file)} signs none of the PBOs.`);
    }
  });

  const signed = pbos.filter((pbo) => pbo.status === 'signed').length;
  const prepacked = pbos.filter((pbo) => pbo.status === 'prepacked').length;
  const problems = pbos.filter((pbo) => pbo.status !== 'signed' && pbo.status !== 'prepacked');
  return {
    folder,
    root,
    addons,
    keys: keys.map((key) => ({ file: key.file, name: key.name })),
    keyIssues,
    pbos,
    signed,
    prepacked,
    ownKey: ownLabel,
    total: pbos.length,
    ok: problems.length === 0 && keyIssues.length === 0
  };
}

// A dropped file stands for the folder it is in.
function folderOf(input) {
  const target = cleanFolderInput(input);
  if (!target || !fs.existsSync(target)) {
    return target;
  }
  return fs.statSync(target).isDirectory() ? target : path.dirname(target);
}

function writeModFiles(mod, options) {
  const when = options && options.now ? options.now : new Date();
  if (!mod.contentFolder || !String(mod.contentFolder).trim()) {
    throw new Error('Choose a content folder first.');
  }
  const folder = path.resolve(mod.contentFolder);
  fs.mkdirSync(folder, { recursive: true });

  const modPath = path.join(folder, 'mod.cpp');
  const modChanged = writeModCpp(modPath, mod.modCpp || {});

  const publishedId = publishedIdOrZero(mod.workshop.publishedId);
  const metaLines = [
    'protocol = 1;',
    `publishedid = ${publishedId};`,
    `name = "${escapeQuoted(metaName(mod))}";`,
    `timestamp = ${dateTimeToBinaryUtc(when)};`
  ];
  const metaPath = path.join(folder, 'meta.cpp');
  fs.writeFileSync(metaPath, `${metaLines.join(os.EOL)}${os.EOL}`, 'utf8');

  return { folder, modPath: modChanged ? modPath : '', metaPath };
}

// Reads mod.cpp and meta.cpp back from the content folder, where Save writes them.
// A key missing from mod.cpp comes back empty, so the form matches the file.
function readModFiles(input) {
  const folder = cleanFolderInput(input);
  if (!folder) {
    throw new Error('Choose a content folder first.');
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(`Folder not found: ${folder}`);
  }
  const base = [folder, locateModParts(folder).root].find((dir) => fs.existsSync(path.join(dir, 'mod.cpp'))
    || fs.existsSync(path.join(dir, 'meta.cpp')));
  if (!base) {
    throw new Error(`No mod.cpp or meta.cpp in ${folder}.`);
  }
  const result = { folder: base, modPath: '', metaPath: '', modCpp: null, meta: null };
  const modPath = path.join(base, 'mod.cpp');
  if (fs.existsSync(modPath)) {
    const text = readCppText(modPath);
    result.modPath = modPath;
    result.modCpp = {};
    MOD_FIELDS.forEach((key) => {
      result.modCpp[key] = readFromText(text, key);
    });
  }
  const metaPath = path.join(base, 'meta.cpp');
  if (fs.existsSync(metaPath)) {
    const text = readCppText(metaPath);
    const publishedId = readFromText(text, 'publishedid');
    result.metaPath = metaPath;
    result.meta = {
      name: readFromText(text, 'name'),
      publishedId: /^\d+$/.test(publishedId) && publishedId !== '0' ? publishedId : ''
    };
  }
  return result;
}

// Reads the prefix from a $PBOPREFIX$ file: a bare path or "prefix=path".
function readPboPrefix(file) {
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((text) => text.trim()).find(Boolean) || '';
  return line.replace(/^prefix\s*=\s*/i, '').replace(/[\\/]+/g, '\\').replace(/^\\+|\\+$/g, '');
}

function isInside(folder, file) {
  const relative = path.relative(folder, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// mod.cpp wants an image path as the game sees it inside the PBO. Works it out from
// the $PBOPREFIX$ of the source folder, the P: drive, or the content folder.
function modImagePath(file, contentFolder) {
  const full = path.resolve(String(file || ''));
  let folder = path.dirname(full);
  for (;;) {
    for (const name of ['$PBOPREFIX$', '$PBOPREFIX$.txt', '$PREFIX$']) {
      const marker = path.join(folder, name);
      if (fs.existsSync(marker) && fs.statSync(marker).isFile()) {
        const prefix = readPboPrefix(marker);
        const relative = path.relative(folder, full);
        return { value: prefix ? `${prefix}\\${relative}` : relative, source: 'prefix' };
      }
    }
    const parent = path.dirname(folder);
    if (parent === folder) {
      break;
    }
    folder = parent;
  }
  const root = path.parse(full).root;
  if (/^p:\\$/i.test(root)) {
    return { value: full.slice(root.length), source: 'p-drive' };
  }
  const content = cleanFolderInput(contentFolder);
  if (content) {
    const modRoot = locateModParts(content).root;
    if (isInside(modRoot, full)) {
      return { value: path.relative(modRoot, full), source: 'content-folder' };
    }
  }
  return { value: full, source: 'absolute' };
}

module.exports = {
  MOD_FIELDS,
  checkSignatures,
  attachBisign,
  removePbo,
  cleanFolderInput,
  dateTimeToBinaryUtc,
  escapeQuoted,
  findPrivateKeys,
  folderOf,
  metaName,
  modImagePath,
  publishedIdOrZero,
  readModFiles,
  writeModFiles
};
