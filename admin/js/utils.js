export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function toast(message, type = 'ok') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

export function formatPrice(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '';
  return num.toFixed(2) + ' USD';
}

export function parsePriceNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).toString().replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

// ---- CSV (RFC4180-lite) ----
export function parseCSV(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim() !== ''));
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSVRow(values) {
  return values.map(csvEscape).join(',');
}

/**
 * Telefon fotoğrafları genelde birkaç MB olur; GitHub Contents API ~1MB üzeri
 * dosyaları reddediyor. Yüklemeden önce görseli canvas üzerinden küçültüp
 * sıkıştırarak bu sınırın altına indirir. Sıkıştırma başarısız/gereksizse
 * (örn. zaten küçük, ya da tarayıcı decode edemedi) orijinal dosyayı döndürür.
 */
export async function compressImageFile(file, { maxDim = 1600, maxBytes = 900 * 1024, startQuality = 0.85 } = {}) {
  if (!file.type || !file.type.startsWith('image/') || file.type === 'image/gif' || file.size <= maxBytes) return file;

  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch (_) { return file; }

  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let quality = startQuality;
  let blob = await canvasToBlob(canvas, quality);
  while (blob && blob.size > maxBytes && quality > 0.35) {
    quality -= 0.15;
    blob = await canvasToBlob(canvas, quality);
  }

  if (!blob || blob.size >= file.size) return file;
  const name = file.name.replace(/\.\w+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
