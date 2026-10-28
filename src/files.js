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
  const original = fs.readFileSync(modPath, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original;
  MOD_FIELDS.forEach((key) => {
    const wanted = values[key] == null ? '' : String(values[key]);
    if (wanted === readFromText(text, key)) {
      return;
    }
    const line = `${key} = "${escapeQuoted(wanted)}";`;
    const pattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*$`, 'm');
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

// Same matching as workshop.readCppValue, which filled the form on import.
function readFromText(text, key) {
  const quoted = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*;`, 'm');
  const bare = new RegExp(`^\\s*${key}\\s*=\\s*([^;]+);`, 'm');
  const match = text.match(quoted) || text.match(bare);
  return match ? match[1].trim() : '';
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

// A .bisign and a .bikey both start with the authority name, ended by a zero byte.
function readAuthority(file) {
  const handle = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
    const end = buffer.indexOf(0);
    return buffer.toString('latin1', 0, end >= 0 && end < read ? end : read).trim();
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

// Checks every .pbo for a .bisign next to it, and that the signing key is in keys\.
// It does not recompute the signature hashes, so a .bisign older than its .pbo is
// reported as outdated: the PBO was rebuilt after it was signed.
function checkSignatures(input) {
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
    .map((file) => ({ file, name: readAuthority(file) }));
  const keyNames = new Set(keys.map((key) => key.name.toLowerCase()));
  const bisigns = listFiles(addons, '.bisign');

  const pbos = pboFiles.map((file) => {
    const prefix = `${path.basename(file).toLowerCase()}.`;
    const pboTime = fs.statSync(file).mtimeMs;
    const signatures = bisigns
      .filter((sig) => path.basename(sig).toLowerCase().startsWith(prefix))
      .map((sig) => {
        const keyName = readAuthority(sig);
        return {
          file: sig,
          keyName,
          keyFound: keyNames.has(keyName.toLowerCase()),
          outdated: fs.statSync(sig).mtimeMs + 2000 < pboTime
        };
      });
    let status = 'signed';
    if (signatures.length === 0) {
      status = 'unsigned';
    } else if (!signatures.some((sig) => sig.keyFound)) {
      status = keys.length === 0 ? 'no-key' : 'unknown-key';
    } else if (signatures.filter((sig) => sig.keyFound).every((sig) => sig.outdated)) {
      status = 'outdated';
    }
    return { file, name: path.basename(file), status, signatures };
  });

  const signed = pbos.filter((pbo) => pbo.status === 'signed').length;
  return {
    folder,
    root,
    addons,
    keys,
    pbos,
    signed,
    total: pbos.length,
    ok: signed === pbos.length
  };
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
  cleanFolderInput,
  dateTimeToBinaryUtc,
  escapeQuoted,
  findPrivateKeys,
  metaName,
  modImagePath,
  publishedIdOrZero,
  writeModFiles
};
