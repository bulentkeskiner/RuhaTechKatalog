import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { FORM_SECTIONS, ALL_FIELD_KEYS, FORCED_FIELDS, emptyProduct } from './schema.js';
import {
  subscribeProducts, createProduct, updateProduct, deleteProduct,
  productExists, bulkUpsertProducts, getAllProductsOnce,
} from './products-store.js';
import { escapeHtml, debounce, toast, formatPrice, downloadTextFile, compressImageFile } from './utils.js';
import { productsToCSV, csvToProducts } from './csv.js';
import {
  getGithubSettings, saveGithubSettings, publishCsvToGithub, publicRawUrl,
  uploadImageToGithub, uploadVideoToGithub,
} from './github-publish.js';
import { subscribeTags, addTag, deleteTag, renameTag, seedTagsFromProducts } from './tags-store.js';

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.replace('index.html'); return; }
  document.getElementById('userEmail').textContent = user.email || 'Yönetici';
  boot();
});

document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));

// ---------------------------------------------------------------------------
// Nav + mobile sidebar
// ---------------------------------------------------------------------------
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('scrim');
document.getElementById('hamburger').addEventListener('click', () => {
  sidebar.classList.add('open'); scrim.classList.add('open');
});
scrim.addEventListener('click', closeSidebar);
function closeSidebar() { sidebar.classList.remove('open'); scrim.classList.remove('open'); }

document.querySelectorAll('.nav-item[data-route]').forEach((btn) => {
  btn.addEventListener('click', () => { location.hash = btn.dataset.route; });
});

// ---------------------------------------------------------------------------
// Basit hash yönlendirme — ürün ekle/düzenle artık modal değil, tam sayfa bir
// görünüm (#/products/new, #/products/edit/<id>). Böylece geri tuşu ve
// sayfa yenileme de beklendiği gibi çalışır.
// ---------------------------------------------------------------------------
function showView(viewId) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.querySelectorAll('.nav-item[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === viewId);
  });
  window.scrollTo(0, 0);
  closeSidebar();
}

function handleRoute() {
  const hash = location.hash || '#/dashboard';
  if (hash.startsWith('#/products/edit/')) {
    const id = decodeURIComponent(hash.slice('#/products/edit/'.length));
    showView('productFormView');
    openProductForm(id);
  } else if (hash === '#/products/new') {
    showView('productFormView');
    openProductForm(null);
  } else if (hash === '#/products') {
    showView('productsView');
  } else if (hash === '#/tags') {
    showView('tagsView');
  } else if (hash === '#/settings') {
    showView('settingsView');
  } else {
    showView('dashboardView');
    renderStats();
  }
}
window.addEventListener('hashchange', handleRoute);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let products = [];
let tags = [];
let sortKey = 'title';
let sortDir = 1;
let githubSettings = null;

let firstLoad = true;
let tagsSeeded = false;

function boot() {
  loadGithubSettings();
  subscribeProducts((items) => {
    products = items;
    populateFilterOptions();
    renderTable();
    renderStats();
    maybeSeedTags();
    if (firstLoad) { firstLoad = false; handleRoute(); }
  }, (err) => {
    console.error(err);
    toast('Ürünler yüklenemedi: ' + err.message, 'err');
  });
  subscribeTags((items) => {
    tags = items;
    renderTagsTable();
    populateTagSelects();
    maybeSeedTags();
  });
}

/** Ürünlerde kullanılan ama Etiketler listesinde olmayan değerleri bir kere otomatik ekler. */
async function maybeSeedTags() {
  if (tagsSeeded || !products.length) return;
  tagsSeeded = true;
  try {
    const added = await seedTagsFromProducts(products, tags);
    if (added) toast(`${added} mevcut etiket otomatik olarak Etiketler listesine eklendi.`);
  } catch (err) {
    console.error('Etiket otomatik doldurma hatası:', err);
  }
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------
function renderStats() {
  const total = products.length;
  const inStock = products.filter((p) => p.availability === 'in stock').length;
  const outStock = total - inStock;
  const withImage = products.filter((p) => p.image_link).length;
  const withoutImage = total - withImage;
  const brands = new Set(products.map((p) => p.brand).filter(Boolean));
  const categories = new Set(products.map((p) => p.google_product_category).filter(Boolean));
  const withoutBrand = products.filter((p) => !p.brand).length;
  const totalValue = products.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0);

  const cards = [
    { label: 'Toplam Ürün', value: total, sub: `${categories.size} kategori` },
    { label: 'Stokta', value: inStock, sub: `${outStock} stok dışı`, subClass: outStock ? 'bad' : 'good' },
    { label: 'Görseli Olan', value: withImage, sub: `${withoutImage} görselsiz`, subClass: withoutImage ? 'bad' : 'good' },
    { label: 'Marka Sayısı', value: brands.size, sub: `${withoutBrand} markasız ürün`, subClass: withoutBrand ? 'bad' : 'good' },
    { label: 'Toplam Katalog Değeri', value: '$' + totalValue.toFixed(0), sub: 'tüm ürün fiyatları toplamı' },
  ];

  document.getElementById('statGrid').innerHTML = cards.map((c) => `
    <div class="stat-card">
      <div class="label">${escapeHtml(c.label)}</div>
      <div class="value mono">${c.value}</div>
      <div class="sub ${c.subClass || ''}">${escapeHtml(c.sub)}</div>
    </div>
  `).join('');

  renderBreakdown('groupBreakdown', products, 'product_tags_0');
  renderBreakdown('brandBreakdown', products, 'brand');
}

function renderBreakdown(elId, list, field) {
  const counts = {};
  for (const p of list) {
    const k = (p[field] || '').trim();
    if (!k) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = entries.length ? entries[0][1] : 1;
  const el = document.getElementById(elId);
  if (!entries.length) { el.innerHTML = '<p style="color:var(--muted); font-size:13px;">Veri yok.</p>'; return; }
  el.innerHTML = entries.map(([name, count]) => `
    <div class="bar-row">
      <div class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div>
      <div class="count mono">${count}</div>
    </div>
  `).join('');
}

document.getElementById('refreshStatsBtn').addEventListener('click', renderStats);

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function uniqueSorted(list, field) {
  return [...new Set(list.map((p) => p[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
}

function fillSelect(select, values) {
  const current = select.value;
  select.innerHTML = '<option value="">Tümü</option>' + values.map((v) =>
    `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (values.includes(current)) select.value = current;
}

let groupFilter = '';

function populateFilterOptions() {
  fillSelect(document.getElementById('fBrand'), uniqueSorted(products, 'brand'));
  renderGroupChips();
}

function renderGroupChips() {
  const scroller = document.getElementById('groupScroller');
  const groups = uniqueSorted(products, 'product_tags_0');
  if (groupFilter && !groups.includes(groupFilter)) groupFilter = '';

  const chips = [{ value: '', label: 'Tümü' }, ...groups.map((g) => ({ value: g, label: g }))];
  scroller.innerHTML = chips.map((c) => `
    <button type="button" class="group-chip${c.value === groupFilter ? ' active' : ''}" data-group="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>
  `).join('');

  scroller.querySelectorAll('.group-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      groupFilter = btn.dataset.group;
      scroller.querySelectorAll('.group-chip').forEach((b) => b.classList.toggle('active', b === btn));
      renderTable();
    });
  });
}

const filterIds = ['fSearch', 'fBrand', 'fStock', 'fImage', 'fPriceMin', 'fPriceMax'];
filterIds.forEach((id) => {
  const el = document.getElementById(id);
  const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
  el.addEventListener(evt, debounce(renderTable, 120));
});
document.getElementById('resetFiltersBtn').addEventListener('click', () => {
  document.getElementById('fSearch').value = '';
  ['fBrand', 'fStock', 'fImage'].forEach((id) => document.getElementById(id).value = '');
  document.getElementById('fPriceMin').value = '';
  document.getElementById('fPriceMax').value = '';
  groupFilter = '';
  renderGroupChips();
  renderTable();
});

function getFiltered() {
  const q = document.getElementById('fSearch').value.trim().toLowerCase();
  const fBrand = document.getElementById('fBrand').value;
  const fStock = document.getElementById('fStock').value;
  const fImage = document.getElementById('fImage').value;
  const fPriceMin = document.getElementById('fPriceMin').value;
  const fPriceMax = document.getElementById('fPriceMax').value;

  let list = products.filter((p) => {
    if (q) {
      const hay = ALL_FIELD_KEYS.map((k) => String(p[k] ?? '')).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (fBrand && p.brand !== fBrand) return false;
    if (groupFilter && p.product_tags_0 !== groupFilter) return false;
    if (fStock === 'in' && p.availability !== 'in stock') return false;
    if (fStock === 'out' && p.availability === 'in stock') return false;
    if (fImage === 'yes' && !p.image_link) return false;
    if (fImage === 'no' && p.image_link) return false;
    if (fPriceMin || fPriceMax) {
      const price = parseFloat(p.price);
      if (isNaN(price)) return false;
      if (fPriceMin && price < parseFloat(fPriceMin)) return false;
      if (fPriceMax && price > parseFloat(fPriceMax)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === 'price') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; return (va - vb) * sortDir; }
    va = String(va ?? ''); vb = String(vb ?? '');
    return va.localeCompare(vb, 'tr') * sortDir;
  });

  return list;
}

document.querySelectorAll('#productsTable thead th[data-sort]').forEach((th) => {
  if (th.dataset.sort === '_thumb') return;
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
    renderTable();
  });
});

// ---------------------------------------------------------------------------
// Table render
// ---------------------------------------------------------------------------
function renderTable() {
  const list = getFiltered();
  document.getElementById('resultCount').textContent = `${list.length} / ${products.length} ürün`;
  const tbody = document.getElementById('productsTbody');

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">Ürün bulunamadı.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((p) => {
    const inStock = p.availability === 'in stock';
    return `
    <tr>
      <td class="thumb" data-label="">${p.image_link
        ? `<img src="${escapeHtml(p.image_link)}" alt="" loading="lazy">`
        : `<div class="noimg"></div>`}</td>
      <td class="name" data-label="Ürün">
        <div class="title">${escapeHtml(p.title || '(başlıksız)')}</div>
        <div class="id mono">${escapeHtml(p.id)}</div>
      </td>
      <td data-label="Marka">${escapeHtml(p.brand || '—')}</td>
      <td class="price" data-label="Fiyat">${p.price !== '' && p.price !== undefined ? formatPrice(p.price) : '—'}</td>
      <td data-label="Stok"><span class="pill ${inStock ? 'good' : 'bad'}">${inStock ? 'Stokta' : 'Stok Dışı'}</span></td>
      <td data-label="Grup">${escapeHtml(p.product_tags_0 || '—')}</td>
      <td class="actions" data-label="">
        <button class="icon-btn" data-edit="${escapeHtml(p.id)}" title="Düzenle" aria-label="Düzenle">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button class="icon-btn danger" data-delete="${escapeHtml(p.id)}" title="Sil" aria-label="Sil">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    location.hash = '#/products/edit/' + encodeURIComponent(btn.dataset.edit);
  }));
  tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', () => openDeleteConfirm(btn.dataset.delete)));
}

// ---------------------------------------------------------------------------
// Ürün ekle/düzenle (tam sayfa görünüm)
// ---------------------------------------------------------------------------
const productForm = document.getElementById('productForm');
const productFormBody = document.getElementById('productFormBody');
let editingOldId = null;

const IMAGE_FIELD_TYPES = ['image', 'images'];
const UPLOAD_FIELD_TYPES = ['image', 'images', 'video'];

function buildFormHTML() {
  return FORM_SECTIONS.map((section) => `
    <div class="form-section"${section.onlyOnAdd ? ' data-only-add="1"' : ''}>
      <h4>${escapeHtml(section.title)}</h4>
      <div class="form-grid">
        ${section.fields.map((f) => {
          const wide = (f.type === 'textarea' || UPLOAD_FIELD_TYPES.includes(f.type)) ? ' span-2' : '';
          const req = f.required ? ' <span class="required-mark">*</span>' : '';

          if (f.type === 'video') {
            return `<div class="field${wide}">
              <label for="pf_${f.key}">${escapeHtml(f.label)}</label>
              <div class="image-upload">
                <div class="thumbs" id="pf_${f.key}_thumb"><div class="thumb-box empty">Yok</div></div>
                <div class="image-upload-body">
                  <input id="pf_${f.key}" name="${f.key}" type="text" class="url-readonly" readonly tabindex="-1" placeholder="Aşağıdan video seçin">
                  <input type="file" id="pf_${f.key}_file" accept="video/*">
                  <div class="upload-status" id="pf_${f.key}_status"></div>
                </div>
              </div>
              ${f.help ? `<div class="help-text">${escapeHtml(f.help)}</div>` : ''}
            </div>`;
          }

          if (IMAGE_FIELD_TYPES.includes(f.type)) {
            const multiple = f.type === 'images' ? ' multiple' : '';
            return `<div class="field${wide}">
              <label for="pf_${f.key}">${escapeHtml(f.label)}${req}</label>
              <div class="image-upload">
                <div class="thumbs" id="pf_${f.key}_thumb"><div class="thumb-box empty">Yok</div></div>
                <div class="image-upload-body">
                  <input id="pf_${f.key}" name="${f.key}" type="text" class="url-readonly" readonly tabindex="-1" ${f.required ? 'required' : ''} placeholder="Aşağıdan görsel seçin">
                  <input type="file" id="pf_${f.key}_file" accept="image/*"${multiple}>
                  <div class="upload-status" id="pf_${f.key}_status"></div>
                </div>
              </div>
              ${f.help ? `<div class="help-text">${escapeHtml(f.help)}</div>` : ''}
            </div>`;
          }

          let control;
          if (f.type === 'select') {
            control = `<select id="pf_${f.key}" name="${f.key}" ${f.required ? 'required' : ''}>
              ${f.options.map(([val, label]) => `<option value="${escapeHtml(val)}">${escapeHtml(label)}</option>`).join('')}
            </select>`;
          } else if (f.type === 'tagselect') {
            control = `<select id="pf_${f.key}" name="${f.key}"><option value="">— Seç —</option></select>`;
          } else if (f.type === 'textarea') {
            control = `<textarea id="pf_${f.key}" name="${f.key}" rows="3" ${f.required ? 'required' : ''} ${f.maxLength ? `maxlength="${f.maxLength}"` : ''} placeholder="${escapeHtml(f.placeholder || '')}"></textarea>`;
          } else {
            control = `<input id="pf_${f.key}" name="${f.key}" type="${f.type}" ${f.required ? 'required' : ''}
              ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''}
              ${f.maxLength ? `maxlength="${f.maxLength}"` : ''}
              placeholder="${escapeHtml(f.placeholder || '')}">`;
          }
          return `<div class="field${wide}">
            <label for="pf_${f.key}">${escapeHtml(f.label)}${req}</label>
            ${control}
            ${f.help ? `<div class="help-text">${escapeHtml(f.help)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}
productFormBody.innerHTML = buildFormHTML();
wireUploads();

const TAG_SELECT_KEYS = FORM_SECTIONS.flatMap((s) => s.fields).filter((f) => f.type === 'tagselect').map((f) => f.key);

function populateTagSelects(keepValues) {
  for (const key of TAG_SELECT_KEYS) {
    const select = document.getElementById('pf_' + key);
    if (!select) continue;
    const current = keepValues ? keepValues[key] : select.value;
    const options = [...tags];
    if (current && !options.includes(current)) options.push(current);
    select.innerHTML = '<option value="">— Seç —</option>' +
      options.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    select.value = current || '';
  }
}

function fillForm(product) {
  for (const key of ALL_FIELD_KEYS) {
    const el = document.getElementById('pf_' + key);
    if (!el) continue;
    el.value = product[key] ?? '';
  }
  populateTagSelects(product);
  updateImageThumb('image_link');
  updateImageThumb('additional_image_link');
  updateVideoPreview('video_url');

  document.querySelectorAll('.form-section[data-only-add]').forEach((sec) => {
    sec.style.display = editingOldId ? 'none' : '';
  });
}

// ---------------------------------------------------------------------------
// Görsel yükleme (GitHub'a doğrudan yükler)
// ---------------------------------------------------------------------------
function updateImageThumb(key) {
  const box = document.getElementById(`pf_${key}_thumb`);
  const input = document.getElementById(`pf_${key}`);
  if (!box || !input) return;
  const field = FORM_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === key);
  const removable = field && field.type === 'images';
  const urls = input.value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!urls.length) { box.innerHTML = `<div class="thumb-box empty">Yok</div>`; return; }
  box.innerHTML = urls.map((u, i) => `
    <div class="thumb-box">
      <img src="${escapeHtml(u)}" alt="" loading="lazy">
      ${removable ? `<button type="button" class="thumb-remove" data-remove-idx="${i}" title="Kaldır" aria-label="Görseli kaldır">×</button>` : ''}
    </div>
  `).join('');
}

function updateVideoPreview(key) {
  const box = document.getElementById(`pf_${key}_thumb`);
  const input = document.getElementById(`pf_${key}`);
  if (!box || !input) return;
  const url = input.value.trim();
  box.innerHTML = url
    ? `<div class="thumb-box"><video src="${escapeHtml(url)}" muted></video></div>`
    : `<div class="thumb-box empty">Yok</div>`;
}

function wireUploads() {
  for (const type of UPLOAD_FIELD_TYPES) {
    const field = FORM_SECTIONS.flatMap((s) => s.fields).find((f) => f.type === type);
    if (!field) continue;
    const key = field.key;
    const fileInput = document.getElementById(`pf_${key}_file`);
    const textInput = document.getElementById(`pf_${key}`);
    const status = document.getElementById(`pf_${key}_status`);
    const isVideo = type === 'video';
    const multiple = type === 'images';
    const updatePreview = isVideo ? updateVideoPreview : updateImageThumb;
    const uploadFn = isVideo ? uploadVideoToGithub : uploadImageToGithub;
    const noun = isVideo ? 'video' : 'görsel';

    textInput.addEventListener('input', () => updatePreview(key));

    if (multiple) {
      document.getElementById(`pf_${key}_thumb`).addEventListener('click', (e) => {
        const btn = e.target.closest('.thumb-remove');
        if (!btn) return;
        const idx = parseInt(btn.dataset.removeIdx, 10);
        const urls = textInput.value.split(',').map((s) => s.trim()).filter(Boolean);
        urls.splice(idx, 1);
        textInput.value = urls.join(',');
        updatePreview(key);
      });
    }

    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;

      if (!githubSettings || !githubSettings.owner || !githubSettings.repo || !githubSettings.token) {
        status.textContent = 'Önce "Ayarlar" sayfasından GitHub bilgilerini kaydedin.';
        status.className = 'upload-status error';
        fileInput.value = '';
        return;
      }

      const idHint = document.getElementById('pf_id').value || 'urun';
      status.className = 'upload-status uploading';

      const existing = textInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      let uploadedCount = 0;
      const failed = [];

      for (const file of files) {
        status.textContent = `Yükleniyor… (${uploadedCount + failed.length + 1}/${files.length})`;
        try {
          const toUpload = isVideo ? file : await compressImageFile(file);
          const url = await uploadFn(toUpload, githubSettings, idHint);
          if (multiple) existing.push(url); else existing[0] = url;
          textInput.value = (multiple ? existing : [existing[0]]).join(',');
          updatePreview(key);
          uploadedCount++;
        } catch (err) {
          failed.push(`${file.name}: ${err.message}`);
        }
      }

      if (failed.length) {
        status.textContent = `${uploadedCount}/${files.length} ${noun} yüklendi. Başarısız — ${failed.join(' · ')}`;
        status.className = 'upload-status error';
      } else {
        status.textContent = `${uploadedCount} ${noun} yüklendi.`;
        status.className = 'upload-status';
      }
      fileInput.value = '';
    });
  }
}

function readForm() {
  const obj = {};
  for (const key of ALL_FIELD_KEYS) {
    const el = document.getElementById('pf_' + key);
    obj[key] = el ? el.value.trim() : '';
  }
  if (obj.price !== '') obj.price = parseFloat(obj.price.toString().replace(',', '.'));
  return { ...obj, ...FORCED_FIELDS };
}

function openProductForm(id) {
  editingOldId = id || null;
  document.getElementById('productFormTitle').textContent = id ? 'Ürünü Düzenle' : 'Yeni Ürün';
  const product = id ? products.find((p) => p.id === id) : emptyProduct();
  fillForm(product || emptyProduct());
}

function goToProducts() { location.hash = '#/products'; }

document.getElementById('addProductBtn').addEventListener('click', () => { location.hash = '#/products/new'; });
document.getElementById('backToProductsBtn').addEventListener('click', goToProducts);
document.getElementById('cancelProductBtn').addEventListener('click', goToProducts);

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = readForm();

  if (!data.id) { toast('Ürün kodu (SKU) zorunludur.', 'err'); return; }
  if (!data.title || !data.description || !data.brand || !data.link || !data.image_link) {
    toast('Facebook için zorunlu alanları (★) doldurun.', 'err');
    return;
  }
  if (data.price === '' || isNaN(data.price)) { toast('Geçerli bir fiyat girin.', 'err'); return; }

  const saveBtn = document.getElementById('saveProductBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span>';

  try {
    if (editingOldId) {
      if (data.id !== editingOldId && await productExists(data.id)) {
        throw new Error(`"${data.id}" kodlu ürün zaten var.`);
      }
      await updateProduct(editingOldId, data);
      toast('Ürün güncellendi.');
    } else {
      if (await productExists(data.id)) throw new Error(`"${data.id}" kodlu ürün zaten var.`);
      await createProduct(data);
      toast('Ürün eklendi.');
    }
    goToProducts();
    autoPublish();
  } catch (err) {
    toast(err.message || 'Kaydedilemedi.', 'err');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Kaydet';
  }
});

// ---------------------------------------------------------------------------
// Silme onayı
// ---------------------------------------------------------------------------
const confirmModal = document.getElementById('confirmModal');
let pendingDeleteId = null;

function openDeleteConfirm(id) {
  const product = products.find((p) => p.id === id);
  pendingDeleteId = id;
  document.getElementById('confirmProductName').textContent = product ? product.title || product.id : id;
  confirmModal.classList.add('open');
}
function closeDeleteConfirm() { confirmModal.classList.remove('open'); pendingDeleteId = null; }

document.getElementById('closeConfirmModal').addEventListener('click', closeDeleteConfirm);
document.getElementById('cancelDeleteBtn').addEventListener('click', closeDeleteConfirm);
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeDeleteConfirm(); });

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('confirmDeleteBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const product = products.find((p) => p.id === pendingDeleteId);
    await deleteProduct(pendingDeleteId, product?.title);
    toast('Ürün silindi.');
    closeDeleteConfirm();
    autoPublish();
  } catch (err) {
    toast('Silinemedi: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sil';
  }
});

// ---------------------------------------------------------------------------
// CSV içe / dışa aktar
// ---------------------------------------------------------------------------
document.getElementById('csvExportBtn').addEventListener('click', () => {
  const csv = productsToCSV(products, { includeHelpRow: true });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`ruhatech-catalog-${stamp}.csv`, csv);
  toast(`${products.length} ürün CSV olarak indirildi.`);
});

const csvImportInput = document.getElementById('csvImportInput');
document.getElementById('csvImportBtn').addEventListener('click', () => csvImportInput.click());
csvImportInput.addEventListener('change', async () => {
  const file = csvImportInput.files[0];
  if (!file) return;
  const text = await file.text();
  csvImportInput.value = '';

  let parsed;
  try {
    parsed = csvToProducts(text);
  } catch (err) {
    toast('CSV okunamadı: ' + err.message, 'err');
    return;
  }
  if (!parsed.products.length) { toast('CSV içinde ürün bulunamadı.', 'err'); return; }

  const ok = confirm(`${parsed.products.length} ürün içe aktarılacak (aynı koda sahip ürünler güncellenir). Devam edilsin mi?`);
  if (!ok) return;

  toast(`İçe aktarılıyor: 0 / ${parsed.products.length}...`);
  try {
    await bulkUpsertProducts(parsed.products, (done, totalCount) => {
      if (done === totalCount) toast(`${totalCount} ürün içe aktarıldı.`);
    });
    autoPublish();
  } catch (err) {
    toast('İçe aktarma hatası: ' + err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// GitHub / Facebook yayınlama
// ---------------------------------------------------------------------------
const publishStatusRow = document.getElementById('publishStatusRow');
const publishStatusEl = document.getElementById('publishStatus');

async function loadGithubSettings() {
  githubSettings = await getGithubSettings();
  fillGithubForm(githubSettings);
}

function fillGithubForm(s) {
  document.getElementById('gh_owner').value = s.owner || '';
  document.getElementById('gh_repo').value = s.repo || '';
  document.getElementById('gh_branch').value = s.branch || 'main';
  document.getElementById('gh_path').value = s.path || 'ruhatech-catalog.csv';
  document.getElementById('gh_token').value = s.token || '';
  document.getElementById('gh_publicUrl').value = publicRawUrl(s) || '(bilgileri doldurup kaydedin)';
  const lastEl = document.getElementById('gh_lastPublish');
  lastEl.textContent = s.lastPublishedAt
    ? `Son yayın: ${new Date(s.lastPublishedAt).toLocaleString('tr-TR')}`
    : 'Henüz yayınlanmadı.';
}

function readGithubForm() {
  return {
    owner: document.getElementById('gh_owner').value.trim(),
    repo: document.getElementById('gh_repo').value.trim(),
    branch: document.getElementById('gh_branch').value.trim() || 'main',
    path: document.getElementById('gh_path').value.trim(),
    token: document.getElementById('gh_token').value.trim(),
  };
}

document.getElementById('githubForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = readGithubForm();
  await saveGithubSettings(s);
  githubSettings = { ...githubSettings, ...s };
  fillGithubForm(githubSettings);
  toast('Ayarlar kaydedildi.');
});

document.getElementById('testPublishBtn').addEventListener('click', async () => {
  const s = readGithubForm();
  await saveGithubSettings(s);
  githubSettings = { ...githubSettings, ...s };
  fillGithubForm(githubSettings);
  await queuePublish(true);
});

document.getElementById('copyPublicUrlBtn').addEventListener('click', async () => {
  const url = document.getElementById('gh_publicUrl').value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link kopyalandı.');
  } catch (_) {
    toast('Kopyalanamadı, elle seçip kopyalayın.', 'err');
  }
});

document.getElementById('publishNowBtn').addEventListener('click', () => queuePublish(true));

/** Ürün ekle/güncelle/sil sonrası sessizce (arka planda) yayınlar; hata olursa toast gösterir. */
function autoPublish() {
  queuePublish(false);
}

// runPublish, GitHub'daki dosyanın sha'sını okuyup üzerine yazdığı için aynı anda birden
// fazla çalışırsa (örn. iki ürün art arda kaydedilirse) ikinci istek eski sha ile çakışıp
// 409 hatası verir. Bu kuyruk aynı anda tek bir yayını garanti eder; yayın sürerken gelen
// ek istekler, mevcut yayın bitince tek seferde (en güncel verilerle) tekrar çalıştırılır.
let isPublishing = false;
let publishPending = false;

async function queuePublish(verbose) {
  if (isPublishing) {
    publishPending = true;
    return;
  }
  isPublishing = true;
  try {
    await runPublish(verbose);
  } finally {
    isPublishing = false;
    if (publishPending) {
      publishPending = false;
      queuePublish(false);
    }
  }
}

async function runPublish(verbose) {
  if (!githubSettings || !githubSettings.owner || !githubSettings.repo || !githubSettings.token) {
    if (verbose) toast('Önce "Ayarlar" sayfasından GitHub bilgilerini kaydedin.', 'err');
    return;
  }
  publishStatusRow.style.display = 'flex';
  publishStatusEl.textContent = 'Facebook beslemesi güncelleniyor…';
  try {
    const freshProducts = await getAllProductsOnce();
    const csv = productsToCSV(freshProducts);
    await publishCsvToGithub(csv, githubSettings);
    const now = Date.now();
    githubSettings.lastPublishedAt = now;
    await saveGithubSettings({ lastPublishedAt: now });
    document.getElementById('gh_lastPublish').textContent = `Son yayın: ${new Date(now).toLocaleString('tr-TR')}`;
    publishStatusEl.textContent = `Facebook beslemesi güncel (${new Date(now).toLocaleTimeString('tr-TR')})`;
    if (verbose) toast('Katalog GitHub\'a yayınlandı.');
  } catch (err) {
    publishStatusEl.textContent = 'Facebook beslemesi güncellenemedi: ' + err.message;
    // Otomatik (sessiz) yayınlar başarısız olduğunda kullanıcıyı uyarı balonuyla rahatsız
    // etmiyoruz; hata durum satırında görünür kalır. Manuel yayınlarda uyarı gösterilir.
    if (verbose) toast('Yayınlanamadı: ' + err.message, 'err');
  }
}

// ---------------------------------------------------------------------------
// Etiketler sayfası
// ---------------------------------------------------------------------------
function renderTagsTable() {
  const tbody = document.getElementById('tagsTbody');
  if (!tbody) return;
  if (!tags.length) {
    tbody.innerHTML = `<tr><td colspan="2"><div class="empty-state">Henüz etiket yok.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = tags.map((name) => `
    <tr>
      <td class="tag-name" data-label="Etiket">
        <span class="tag-name-view">${escapeHtml(name)}</span>
        <input class="input tag-name-edit" type="text" value="${escapeHtml(name)}" style="display:none; max-width:260px;">
      </td>
      <td class="actions" data-label="">
        <button class="icon-btn" data-rename="${escapeHtml(name)}" title="Yeniden adlandır" aria-label="Yeniden adlandır">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button class="icon-btn danger" data-remove="${escapeHtml(name)}" title="Sil" aria-label="Sil">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('tr');
      const view = row.querySelector('.tag-name-view');
      const editInput = row.querySelector('.tag-name-edit');
      const oldName = btn.dataset.rename;

      if (editInput.style.display === 'none') {
        view.style.display = 'none';
        editInput.style.display = '';
        editInput.focus();
        editInput.select();

        const commit = async () => {
          const newName = editInput.value.trim();
          editInput.removeEventListener('blur', commit);
          if (!newName || newName === oldName) { view.style.display = ''; editInput.style.display = 'none'; return; }
          try {
            await renameTag(oldName, newName);
            toast('Etiket güncellendi.');
          } catch (err) {
            toast('Güncellenemedi: ' + err.message, 'err');
          }
        };
        editInput.addEventListener('blur', commit, { once: true });
        editInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); editInput.blur(); }
          if (e.key === 'Escape') { editInput.value = oldName; editInput.blur(); }
        });
      }
    });
  });

  tbody.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.remove;
      if (!confirm(`"${name}" etiketi silinsin mi? Bu etiketi kullanan ürünlerdeki değer değişmez, sadece seçim listesinden kalkar.`)) return;
      try {
        await deleteTag(name);
        toast('Etiket silindi.');
      } catch (err) {
        toast('Silinemedi: ' + err.message, 'err');
      }
    });
  });
}

document.getElementById('addTagForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('newTagInput');
  const name = input.value.trim();
  if (!name) return;
  try {
    await addTag(name);
    input.value = '';
    toast('Etiket eklendi.');
  } catch (err) {
    toast('Eklenemedi: ' + err.message, 'err');
  }
});
