import { db } from './firebase-init.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const SETTINGS_REF = doc(db, 'settings', 'github');
const IMAGE_FOLDER = 'urun-fotolari';

export async function getGithubSettings() {
  const snap = await getDoc(SETTINGS_REF);
  return snap.exists() ? snap.data() : { owner: '', repo: '', branch: 'main', path: 'ruhatech-catalog.csv', token: '' };
}

export async function saveGithubSettings(settings) {
  await setDoc(SETTINGS_REF, settings, { merge: true });
}

export function publicRawUrl(settings, pathOverride) {
  if (!settings.owner || !settings.repo || (!settings.path && !pathOverride)) return '';
  const branch = settings.branch || 'main';
  const path = pathOverride ?? settings.path;
  return `https://raw.githubusercontent.com/${settings.owner}/${settings.repo}/${branch}/${path}`;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function apiRequest(url, settings, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${settings.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
}

/** GitHub reposunda verilen yola base64 içerik yazar (yoksa oluşturur, varsa günceller). */
async function putFileToGithub(path, base64Content, settings, commitMessage) {
  if (!settings.owner || !settings.repo || !settings.token) {
    throw new Error('GitHub ayarları eksik. Önce "⚙ Facebook Bağlantısı"ndan doldurun.');
  }
  const branch = settings.branch || 'main';
  const apiBase = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;

  let sha;
  const getRes = await apiRequest(`${apiBase}?ref=${encodeURIComponent(branch)}`, settings);
  if (getRes.ok) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    throw new Error(await githubErrorMessage(getRes));
  }

  const body = { message: commitMessage, content: base64Content, branch, ...(sha ? { sha } : {}) };
  let putRes = await apiRequest(apiBase, settings, { method: 'PUT', body: JSON.stringify(body) });

  if (!putRes.ok && putRes.status === 409) {
    const retryGet = await apiRequest(`${apiBase}?ref=${encodeURIComponent(branch)}`, settings);
    if (retryGet.ok) {
      const data = await retryGet.json();
      putRes = await apiRequest(apiBase, settings, { method: 'PUT', body: JSON.stringify({ ...body, sha: data.sha }) });
    }
  }
  if (!putRes.ok) throw new Error(await githubErrorMessage(putRes));

  return publicRawUrl(settings, path);
}

/** Katalog CSV metnini ayarlardaki dosya yoluna yazar. */
export async function publishCsvToGithub(csvText, settings) {
  if (!settings.path) throw new Error('GitHub ayarları eksik. Önce "⚙ Facebook Bağlantısı"ndan doldurun.');
  return putFileToGithub(
    settings.path,
    utf8ToBase64(csvText),
    settings,
    `Katalog güncellendi (${new Date().toLocaleString('tr-TR')})`,
  );
}

/**
 * Bir ürün görselini GitHub reposundaki urun-fotolari/ klasörüne yükler.
 * fileNameHint: genelde ürün id'si; dosya adı çakışmasın diye zaman damgasıyla birleştirilir.
 */
export async function uploadImageToGithub(file, settings, fileNameHint) {
  const path = buildUploadPath(file, fileNameHint, IMAGE_FOLDER);
  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  return putFileToGithub(path, base64, settings, `Ürün görseli eklendi: ${path.split('/').pop()}`);
}

const VIDEO_FOLDER = 'urun-videolari';
// GitHub Contents API (dosya oluşturma/güncelleme) tek istekte ~100MB base64 içerik kabul
// ediyor; base64 kodlama ham dosyayı ~%33 büyüttüğü için 50MB'lık bir video ~67MB'a çıkar —
// bu da sınırın altında kalıp isteğin zaman aşımına uğramaması için yeterli pay bırakıyor.
const MAX_VIDEO_MB = 50;
const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;

/** Bir ürün videosunu GitHub reposundaki urun-videolari/ klasörüne yükler. */
export async function uploadVideoToGithub(file, settings, fileNameHint) {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(`Video çok büyük (${(file.size / 1024 / 1024).toFixed(1)}MB). En fazla ${MAX_VIDEO_MB}MB olmalı.`);
  }
  const path = buildUploadPath(file, fileNameHint, VIDEO_FOLDER);
  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  return putFileToGithub(path, base64, settings, `Ürün videosu eklendi: ${path.split('/').pop()}`);
}

function buildUploadPath(file, fileNameHint, folder) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const safeHint = (fileNameHint || 'dosya').toString().trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dosya';
  return `${folder}/${safeHint}-${Date.now()}.${ext}`;
}

async function githubErrorMessage(res) {
  let detail = '';
  try { detail = (await res.json()).message || ''; } catch (_) { /* yok say */ }
  if (res.status === 401) return 'GitHub token geçersiz veya yetkisiz.';
  if (res.status === 403) return 'GitHub yetki hatası (token izinlerini kontrol edin).';
  if (res.status === 404) return 'Repo veya dosya yolu bulunamadı.';
  return `GitHub hatası (${res.status}): ${detail || 'bilinmeyen hata'}`;
}
