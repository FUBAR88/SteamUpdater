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

module.exports = {
  MOD_FIELDS,
  dateTimeToBinaryUtc,
  escapeQuoted,
  findPrivateKeys,
  metaName,
  publishedIdOrZero,
  writeModFiles
};
