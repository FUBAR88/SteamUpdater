const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

function helperCandidates() {
  const resources = process.resourcesPath || '';
  return [
    path.join(resources, 'steam-helper', 'SteamHelper.exe'),
    path.join(__dirname, '..', 'steam-helper', 'bin', 'Release', 'net48', 'SteamHelper.exe'),
    path.join(__dirname, '..', 'steam-helper', 'bin', 'Debug', 'net48', 'SteamHelper.exe')
  ];
}

function findHelper() {
  return helperCandidates().find((candidate) => fs.existsSync(candidate)) || '';
}

function splitTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildFetchRequest(publishedIds) {
  const request = buildRequest('fetch');
  request.publishedIds = (publishedIds || []).map((id) => String(id || '').trim()).filter(Boolean);
  return request;
}

function buildRequest(command, mod) {
  const workshop = (mod && mod.workshop) || {};
  const modCpp = (mod && mod.modCpp) || {};
  const current = settings.get();
  return {
    command,
    publisherDir: current.publisherDir,
    steamDir: current.steamDir,
    mode: mod && mod.uploadMode === 'contributor' ? 'contributor' : 'normal',
    publishedId: String(workshop.publishedId || '').trim(),
    contentFolder: mod && mod.contentFolder ? mod.contentFolder : '',
    title: workshop.title || '',
    description: workshop.description || '',
    changeNote: workshop.changeNote || '',
    visibility: workshop.visibility || 'public',
    tags: splitTags(workshop.tags),
    previewImage: workshop.previewImage || '',
    includePage: true,
    modName: modCpp.name || workshop.title || (mod && mod.displayName) || ''
  };
}

function parseResult(stdout) {
  const lines = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith('{')) {
      return JSON.parse(lines[index]);
    }
  }
  throw new Error(stdout.trim() || 'Steam helper returned no result.');
}

function runHelper(request, onProgress, timeoutMs) {
  const helper = findHelper();
  if (!helper) {
    return Promise.reject(new Error('Steam helper is not built. Run npm start from the SteamUpdater folder.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], {
      cwd: path.dirname(helper),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error('Steam helper timed out.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
        if (onProgress) {
          onProgress(line);
        }
      });
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        resolve(parseResult(stdout));
      } catch (error) {
        reject(new Error(stderr.trim() || error.message));
      }
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

module.exports = {
  buildFetchRequest,
  buildRequest,
  findHelper,
  runHelper
};
