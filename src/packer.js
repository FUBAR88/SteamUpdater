const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('./settings');
const files = require('./files');

const PREFIX_FILES = ['$PBOPREFIX$', '$PBOPREFIX$.txt', '$PREFIX$'];

function templatesFile() {
  return path.join(settings.get().dataFolder, 'pack_templates.json');
}

function newId() {
  return crypto.randomUUID();
}

function cleanText(value) {
  return typeof value === 'string' ? value : '';
}

function cleanPack(value) {
  const pack = value && typeof value === 'object' ? value : {};
  return {
    id: cleanText(pack.id) || newId(),
    enabled: pack.enabled !== false,
    source: cleanText(pack.source).trim(),
    prefix: cleanText(pack.prefix).trim()
  };
}

function cleanTemplate(value) {
  const template = value && typeof value === 'object' ? value : {};
  return {
    id: cleanText(template.id) || newId(),
    name: cleanText(template.name).trim() || 'Template',
    note: cleanText(template.note),
    builtin: Boolean(template.builtin),
    destination: cleanText(template.destination).trim(),
    addonsFolder: cleanText(template.addonsFolder).trim() || 'addons',
    keysFolder: cleanText(template.keysFolder).trim() || 'keys',
    privateKey: cleanText(template.privateKey).trim(),
    publicKey: cleanText(template.publicKey).trim(),
    excludeFile: cleanText(template.excludeFile).trim(),
    excludePatterns: cleanText(template.excludePatterns),
    files: cleanText(template.files).trim(),
    binarize: Boolean(template.binarize),
    linkedModId: cleanText(template.linkedModId),
    packs: Array.isArray(template.packs) ? template.packs.map(cleanPack) : []
  };
}

// The two templates every new install starts with. Paths that do not exist on this
// machine stay in, they only show where things go.
function builtinTemplates() {
  const keyDir = path.join(os.homedir(), 'Desktop', 'PrivateKeys');
  const dmeKey = path.join(keyDir, 'DeadmansEchoCore.biprivatekey');
  return [
    cleanTemplate({
      id: 'builtin-revolutionza',
      name: 'RevolutionZA',
      note: 'RevolutionZA. Rev_Core and Rev_Lootconfig into workshop item 3480589933.',
      builtin: true,
      destination: 'M:\\Projects\\SteamUpdater\\MOD_DATA\\3480589933',
      addonsFolder: 'addons',
      keysFolder: 'keys',
      packs: [
        { source: 'c:\\Temp\\Build\\Rev_Core' },
        { source: 'c:\\Temp\\Build\\Rev_Lootconfig' }
      ]
    }),
    cleanTemplate({
      id: 'builtin-deadmans-echo',
      name: 'Deadmans-Echo',
      note: 'Deadmans-Echo. Signed with the DeadmansEchoCore key, PBOs in Addons\\, key in key\\.',
      builtin: true,
      destination: path.join(settings.get().dataFolder, '3485942803', 'DeadmansEcho-Core'),
      addonsFolder: 'Addons',
      keysFolder: 'key',
      privateKey: fs.existsSync(dmeKey) ? dmeKey : '',
      packs: []
    })
  ];
}

function readTemplates() {
  const file = templatesFile();
  let data = null;
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`Could not read ${file}. ${error.message}`);
    }
  }
  if (!data || !Array.isArray(data.templates)) {
    const templates = builtinTemplates();
    return writeTemplates({ templates, selectedId: templates[0].id });
  }
  const templates = data.templates.map(cleanTemplate);
  return {
    templates,
    selectedId: cleanText(data.selectedId)
  };
}

function writeTemplates(payload) {
  const templates = Array.isArray(payload && payload.templates) ? payload.templates.map(cleanTemplate) : [];
  const data = { templates, selectedId: cleanText(payload && payload.selectedId) };
  const file = templatesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function addonBuilderPath() {
  const configured = settings.get().addonBuilder;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }
  return settings.detectAddonBuilder();
}

function readPrefix(source) {
  for (let index = 0; index < PREFIX_FILES.length; index += 1) {
    const file = path.join(source, PREFIX_FILES[index]);
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      // $PBOPREFIX$ files may hold "prefix=..." lines; the plain form is just the path.
      const line = text.split(/\r?\n/).map((part) => part.trim()).find(Boolean) || '';
      const value = line.replace(/^prefix\s*=\s*/i, '').replace(/;$/, '').trim();
      if (value) {
        return { prefix: value, from: PREFIX_FILES[index] };
      }
    }
  }
  return { prefix: path.basename(source), from: '' };
}

function patternList(text) {
  return String(text || '')
    .split(/[;\r\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isInside(folder, target) {
  const relative = path.relative(folder, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function defaultExcludeFile(builder) {
  const file = path.join(path.dirname(path.dirname(builder)), 'PboUtils', 'exclude.lst');
  return fs.existsSync(file) ? file : '';
}

// What a pack would do, without running it. Every problem that would make a pack
// fail or write into the wrong place is caught here, before AddonBuilder starts.
function plan(input, only) {
  const template = cleanTemplate(input);
  const problems = [];
  const builder = addonBuilderPath();
  if (!builder) {
    problems.push('AddonBuilder.exe was not found. Set its path in Settings.');
  }
  const destination = files.cleanFolderInput(template.destination);
  if (!destination) {
    problems.push('Choose a destination folder.');
  }
  const addons = destination ? path.join(destination, template.addonsFolder) : '';
  const keys = destination ? path.join(destination, template.keysFolder) : '';

  const privateKey = files.cleanFolderInput(template.privateKey);
  if (privateKey) {
    if (!fs.existsSync(privateKey)) {
      problems.push(`Private key not found: ${privateKey}`);
    } else if (!privateKey.toLowerCase().endsWith('.biprivatekey')) {
      problems.push('The private key must be a .biprivatekey file.');
    } else if (destination && isInside(destination, privateKey)) {
      problems.push('The private key is inside the destination. It would be uploaded with the mod. Keep it somewhere else.');
    }
  }
  let publicKey = files.cleanFolderInput(template.publicKey);
  if (!publicKey && privateKey) {
    const sibling = privateKey.replace(/\.biprivatekey$/i, '.bikey');
    publicKey = fs.existsSync(sibling) ? sibling : '';
  }
  if (publicKey && !fs.existsSync(publicKey)) {
    problems.push(`Public key not found: ${publicKey}`);
  }

  const excludeFile = files.cleanFolderInput(template.excludeFile);
  if (excludeFile && !fs.existsSync(excludeFile)) {
    problems.push(`Exclusion list not found: ${excludeFile}`);
  }

  const chosen = template.packs.filter((pack) => (only ? pack.id === only : pack.enabled));
  if (chosen.length === 0) {
    problems.push(only ? 'That pack is not in the template.' : 'No pack is ticked.');
  }
  const names = new Map();
  const packs = chosen.map((pack) => {
    const source = files.cleanFolderInput(pack.source);
    const entry = { id: pack.id, source, name: source ? path.basename(source) : '', prefix: '', prefixFrom: '' };
    if (!source) {
      problems.push('A pack has no source folder.');
      return entry;
    }
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      problems.push(`Source folder not found: ${source}`);
      return entry;
    }
    if (destination && (isInside(source, destination) || isInside(destination, source))) {
      problems.push(`Source and destination overlap: ${source}`);
    }
    const key = entry.name.toLowerCase();
    if (names.has(key)) {
      problems.push(`Two packs would both write ${entry.name}.pbo: ${names.get(key)} and ${source}`);
    }
    names.set(key, source);
    const found = pack.prefix ? { prefix: pack.prefix, from: 'template' } : readPrefix(source);
    entry.prefix = found.prefix;
    entry.prefixFrom = found.from;
    entry.hasConfig = fs.existsSync(path.join(source, 'config.cpp')) || fs.existsSync(path.join(source, 'config.bin'));
    return entry;
  });

  return {
    template,
    builder,
    destination,
    addons,
    keys,
    privateKey,
    publicKey,
    excludeFile: excludeFile || (builder ? defaultExcludeFile(builder) : ''),
    files: template.files || settings.get().filesTemplate || settings.DEFAULT_FILES,
    packs,
    problems
  };
}

// exclude.lst: one pattern per line, ";" starts a comment.
function excludeLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(';'));
}

// A DayZ exclude pattern as a test on a path relative to the source, written with
// backslashes. "*" also crosses folders, as in exclude.lst ("*\Temp\*"). A pattern
// without a folder part also matches the file name alone.
function globToRegExp(pattern) {
  const normal = pattern.replace(/\//g, '\\');
  const body = normal
    .split('')
    .map((char) => {
      if (char === '*') {
        return '.*';
      }
      if (char === '?') {
        return '.';
      }
      return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  const regex = new RegExp(`^${body}$`, 'i');
  const nameOnly = !normal.includes('\\');
  return (relative) => regex.test(relative)
    || regex.test(`\\${relative}`)
    || (nameOnly && regex.test(relative.slice(relative.lastIndexOf('\\') + 1)));
}

// Copies source into stage without the excluded files. Hard links where the drive
// allows it, so big texture folders cost no copy time.
function stageSource(source, stage, excludes) {
  const skipped = [];
  const walk = (folder, relative) => {
    fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
      const rel = relative ? `${relative}\\${entry.name}` : entry.name;
      const from = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (excludes.some((test) => test(`${rel}\\`) || test(rel))) {
          skipped.push(`${rel}\\`);
          return;
        }
        walk(from, rel);
        return;
      }
      if (!entry.isFile()) {
        return;
      }
      if (excludes.some((test) => test(rel))) {
        skipped.push(rel);
        return;
      }
      const to = path.join(stage, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try {
        fs.linkSync(from, to);
      } catch (_error) {
        fs.copyFileSync(from, to);
      }
    });
  };
  fs.mkdirSync(stage, { recursive: true });
  walk(source, '');
  return { skipped };
}

function runBuilder(builder, args, progress) {
  return new Promise((resolve) => {
    let output = '';
    let pending = '';
    const child = spawn(builder, args, { windowsHide: true });
    const take = (chunk) => {
      const text = chunk.toString();
      output += text;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      lines.forEach((line) => {
        if (/error|warn|fail|exception|Build finished|Signing PBO/i.test(line)) {
          progress(`  ${line.trim()}`);
        }
      });
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (error) => resolve({ code: -1, output: `${output}\n${error.message}` }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (_error) {
    return 0;
  }
}

function listByExtension(folder, extension) {
  try {
    return fs.readdirSync(folder).filter((name) => name.toLowerCase().endsWith(extension));
  } catch (_error) {
    return [];
  }
}

// Packs every ticked source of a template (or the one pack named by only) with
// AddonBuilder into <destination>\<addons>, signs with the private key when one is
// set, and puts the public key into <destination>\<keys>.
async function pack(input, only, progress) {
  const say = typeof progress === 'function' ? progress : () => {};
  const job = plan(input, only);
  if (job.problems.length > 0) {
    job.problems.forEach((problem) => say(problem));
    return { ok: false, error: job.problems[0], problems: job.problems, results: [] };
  }

  fs.mkdirSync(job.addons, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-updater-pack-'));
  const includeFile = path.join(work, 'include.lst');
  fs.writeFileSync(includeFile, `${patternList(job.files).join(';')}\n`, 'utf8');
  // AddonBuilder 1.0.240639 crashes on -exclude (ArgumentNullException in its texture
  // header task), so exclusions are applied here: each source is copied into a staging
  // folder without the excluded files, and that copy is packed. AddonBuilder still
  // applies its own DayZ Tools exclude.lst on top. A private key never goes in.
  const excludes = [
    ...(job.excludeFile && job.excludeFile !== defaultExcludeFile(job.builder) ? excludeLines(fs.readFileSync(job.excludeFile, 'utf8')) : []),
    ...patternList(job.template.excludePatterns),
    '*.biprivatekey'
  ].map(globToRegExp);

  say(`Pack ${job.template.name}: ${job.packs.length} PBO${job.packs.length === 1 ? '' : 's'} into ${job.addons}`);
  say(job.privateKey ? `Signing with ${path.basename(job.privateKey)}` : 'No private key, the PBOs stay unsigned.');
  const keysBefore = new Set(listByExtension(job.addons, '.bikey'));

  const results = [];
  for (let index = 0; index < job.packs.length; index += 1) {
    const entry = job.packs[index];
    const pbo = path.join(job.addons, `${entry.name}.pbo`);
    const before = mtime(pbo);
    // Signatures of the old PBO do not fit the new one.
    listByExtension(job.addons, '.bisign')
      .filter((name) => name.toLowerCase().startsWith(`${entry.name.toLowerCase()}.pbo.`))
      .forEach((name) => fs.unlinkSync(path.join(job.addons, name)));
    const temp = path.join(work, `temp-${index}`);
    fs.mkdirSync(temp, { recursive: true });
    say(`[${index + 1}/${job.packs.length}] ${entry.name}  prefix ${entry.prefix}${entry.prefixFrom ? ` (${entry.prefixFrom})` : ' (folder name)'}`);
    // The staging folder keeps the source folder name, AddonBuilder names the PBO after it.
    const stage = path.join(work, `stage-${index}`, entry.name);
    let staged;
    try {
      staged = stageSource(entry.source, stage, excludes);
    } catch (error) {
      results.push({ id: entry.id, name: entry.name, pbo, ok: false, error: `Could not copy the source. ${error.message}`, signed: false, size: 0 });
      say(`  FAILED Could not copy the source. ${error.message}`);
      continue;
    }
    if (staged.skipped.length > 0) {
      say(`  excluded ${staged.skipped.length} file${staged.skipped.length === 1 ? '' : 's'}: ${staged.skipped.slice(0, 5).join(', ')}${staged.skipped.length > 5 ? ', ...' : ''}`);
    }
    const args = [
      stage,
      job.addons,
      '-clear',
      `-prefix=${entry.prefix}`,
      `-temp=${temp}`,
      `-include=${includeFile}`
    ];
    if (!job.template.binarize) {
      args.push('-packonly');
    }
    if (job.privateKey) {
      args.push(`-sign=${job.privateKey}`);
    }
    if (!entry.hasConfig) {
      say('  No config.cpp in the source. DayZ will not load this PBO as an addon.');
    }
    const run = await runBuilder(job.builder, args, say);
    const after = mtime(pbo);
    let error = '';
    // AddonBuilder exits with 0 even after a [FATAL] crash, so its log is read too.
    const fatal = run.output.split(/\r?\n/).find((line) => /\[(FATAL|ERROR)\s*\]/.test(line));
    if (run.code !== 0 || fatal) {
      const lines = run.output.split(/\r?\n/).filter((line) => /error|fail|exception|fatal/i.test(line)).slice(0, 3);
      error = `AddonBuilder exit ${run.code}. ${lines.map((line) => line.replace(/^\[[^\]]*\]\s*/, '')).join(' ').trim()}`.trim();
    } else if (!after) {
      error = 'AddonBuilder finished, but no PBO was written.';
    } else if (after <= before) {
      // An old PBO left in place looks like success. Only a new file counts.
      error = 'AddonBuilder finished, but the PBO was not replaced.';
    }
    let signed = false;
    if (!error && job.privateKey) {
      const keyName = path.basename(job.privateKey).replace(/\.biprivatekey$/i, '');
      const sig = path.join(job.addons, `${entry.name}.pbo.${keyName}.bisign`);
      signed = mtime(sig) >= after - 2000;
      if (!signed) {
        error = `Packed, but ${path.basename(sig)} was not written.`;
      }
    }
    const size = after ? fs.statSync(pbo).size : 0;
    results.push({ id: entry.id, name: entry.name, pbo, ok: !error, error, signed, size });
    say(error ? `  FAILED ${error}` : `  ok ${entry.name}.pbo (${Math.max(1, Math.round(size / 1024))} KB${signed ? ', signed' : ''})`);
  }

  // AddonBuilder copies the public key next to the PBOs. It belongs in keys\.
  const keyMessages = [];
  if (job.privateKey) {
    fs.mkdirSync(job.keys, { recursive: true });
    listByExtension(job.addons, '.bikey')
      .filter((name) => !keysBefore.has(name))
      .forEach((name) => {
        const from = path.join(job.addons, name);
        const to = path.join(job.keys, name);
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
        keyMessages.push(`Moved ${name} to ${job.keys}`);
      });
  }
  if (job.publicKey) {
    fs.mkdirSync(job.keys, { recursive: true });
    const to = path.join(job.keys, path.basename(job.publicKey));
    if (path.resolve(to).toLowerCase() !== path.resolve(job.publicKey).toLowerCase()) {
      fs.copyFileSync(job.publicKey, to);
      keyMessages.push(`Copied ${path.basename(job.publicKey)} to ${job.keys}`);
    }
  }
  keyMessages.forEach((line) => say(line));

  fs.rmSync(work, { recursive: true, force: true });
  const failed = results.filter((result) => !result.ok);
  say(failed.length === 0
    ? `Pack finished. ${results.length} PBO${results.length === 1 ? '' : 's'} in ${job.addons}`
    : `Pack finished with errors. ${results.length - failed.length} ok, ${failed.length} failed.`);
  return {
    ok: failed.length === 0,
    error: failed.length ? failed.map((result) => `${result.name}: ${result.error}`).join('\n') : '',
    destination: job.destination,
    addons: job.addons,
    keys: job.keys,
    results
  };
}

module.exports = {
  addonBuilderPath,
  pack,
  plan,
  readTemplates,
  writeTemplates
};
