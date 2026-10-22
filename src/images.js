const fs = require('fs');
const path = require('path');
const workshop = require('./workshop');

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const DETAILS_URL = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';

function imagesDir() {
  return path.join(workshop.modDataRoot(), 'Images');
}

function fileExtension(file) {
  let ext = path.extname(String(file || '')).slice(1).toLowerCase();
  if (ext === 'jpeg') {
    ext = 'jpg';
  }
  return EXTENSIONS.includes(ext) ? ext : 'jpg';
}

function previewKey(id) {
  return String(id || '').trim().replace(/[^\w-]/g, '');
}

function storePreview(id, sourcePath) {
  const key = previewKey(id);
  const source = path.resolve(String(sourcePath || ''));
  if (!key || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return '';
  }
  const ext = fileExtension(source);
  const dir = imagesDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${key}.${ext}`);
  if (path.resolve(dest).toLowerCase() !== source.toLowerCase()) {
    fs.copyFileSync(source, dest);
  }
  EXTENSIONS.forEach((old) => {
    const previous = path.join(dir, `${key}.${old}`);
    if (old !== ext && fs.existsSync(previous)) {
      fs.unlinkSync(previous);
    }
  });
  return dest;
}

function findPreview(publishedId) {
  const id = String(publishedId || '').trim();
  if (!/^\d+$/.test(id)) {
    return '';
  }
  const dir = imagesDir();
  for (let index = 0; index < EXTENSIONS.length; index += 1) {
    const file = path.join(dir, `${id}.${EXTENSIONS[index]}`);
    if (fs.existsSync(file)) {
      return file;
    }
  }
  return '';
}

function extensionFor(url, contentType) {
  let fromUrl = '';
  try {
    fromUrl = path.extname(new URL(url).pathname).slice(1).toLowerCase();
  } catch (error) {
    fromUrl = '';
  }
  if (fromUrl === 'jpeg') {
    return 'jpg';
  }
  if (EXTENSIONS.includes(fromUrl)) {
    return fromUrl;
  }
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) {
    return 'png';
  }
  if (type.includes('gif')) {
    return 'gif';
  }
  if (type.includes('webp')) {
    return 'webp';
  }
  return 'jpg';
}

async function fetchDetails(ids) {
  const unique = [];
  (ids || []).forEach((value) => {
    const id = String(value || '').trim();
    if (/^\d+$/.test(id) && !unique.includes(id)) {
      unique.push(id);
    }
  });
  const details = [];
  for (let offset = 0; offset < unique.length; offset += 50) {
    const batch = unique.slice(offset, offset + 50);
    const body = new URLSearchParams();
    body.set('itemcount', String(batch.length));
    batch.forEach((id, index) => {
      body.set(`publishedfileids[${index}]`, id);
    });
    const response = await fetch(DETAILS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!response.ok) {
      throw new Error(`Steam preview lookup failed (${response.status}).`);
    }
    const payload = await response.json();
    const rows = payload && payload.response && payload.response.publishedfiledetails;
    if (Array.isArray(rows)) {
      details.push(...rows);
    }
  }
  return details;
}

async function downloadPreview(publishedId, previewUrl) {
  const id = String(publishedId || '').trim();
  if (!/^\d+$/.test(id) || !previewUrl) {
    return '';
  }
  const response = await fetch(previewUrl);
  if (!response.ok) {
    return '';
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) {
    return '';
  }
  const ext = extensionFor(previewUrl, response.headers.get('content-type'));
  const dir = imagesDir();
  fs.mkdirSync(dir, { recursive: true });
  EXTENSIONS.forEach((old) => {
    const previous = path.join(dir, `${id}.${old}`);
    if (old !== ext && fs.existsSync(previous)) {
      fs.unlinkSync(previous);
    }
  });
  const file = path.join(dir, `${id}.${ext}`);
  fs.writeFileSync(file, bytes);
  return file;
}

async function ensurePreview(publishedId) {
  const id = String(publishedId || '').trim();
  if (!/^\d+$/.test(id)) {
    return '';
  }
  const details = await fetchDetails([id]);
  const url = details[0] && details[0].preview_url;
  const saved = await downloadPreview(id, url);
  return saved || findPreview(id);
}

module.exports = {
  downloadPreview,
  ensurePreview,
  fetchDetails,
  findPreview,
  imagesDir,
  storePreview
};
