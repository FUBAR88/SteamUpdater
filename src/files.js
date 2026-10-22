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

function writeModFiles(mod, options) {
  const when = options && options.now ? options.now : new Date();
  if (!mod.contentFolder || !String(mod.contentFolder).trim()) {
    throw new Error('Choose a content folder first.');
  }
  const folder = path.resolve(mod.contentFolder);
  fs.mkdirSync(folder, { recursive: true });

  const modLines = MOD_FIELDS.map((key) => `${key} = "${escapeQuoted(mod.modCpp[key])}";`);
  const modPath = path.join(folder, 'mod.cpp');
  fs.writeFileSync(modPath, `${modLines.join(os.EOL)}${os.EOL}`, 'utf8');

  const publishedId = publishedIdOrZero(mod.workshop.publishedId);
  const metaLines = [
    'protocol = 1;',
    `publishedid = ${publishedId};`,
    `name = "${escapeQuoted(metaName(mod))}";`,
    `timestamp = ${dateTimeToBinaryUtc(when)};`
  ];
  const metaPath = path.join(folder, 'meta.cpp');
  fs.writeFileSync(metaPath, `${metaLines.join(os.EOL)}${os.EOL}`, 'utf8');

  return { folder, modPath, metaPath };
}

module.exports = {
  MOD_FIELDS,
  dateTimeToBinaryUtc,
  escapeQuoted,
  metaName,
  publishedIdOrZero,
  writeModFiles
};
