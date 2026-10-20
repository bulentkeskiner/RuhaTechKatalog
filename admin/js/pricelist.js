import { escapeHtml, debounce, toast, parsePriceNumber } from './utils.js';

// ---------------------------------------------------------------------------
// Fiyat Listesi: ürün seç → şablon seç → önizle → PDF oluştur / paylaş.
//
// PDF tamamen tarayıcıda üretilir: önizlemedeki her A4 sayfası html2canvas ile
// görüntüye çevrilip jsPDF'e eklenir. Bu iki kütüphane yalnızca "PDF Oluştur"a
// basıldığında yüklenir. Ürün görselleri önce küçültülüp blob URL olarak
// önbelleğe alınır; hem önizleme hızlı açılır hem de PDF dosyası şişmez.
// ---------------------------------------------------------------------------

const PAGE_W = 794;       // A4, 96 dpi CSS pikseli
const PAGE_H = 1123;
const PDF_W = 595.28;     // A4, pt
const PDF_H = 841.89;
const RENDER_SCALE = 2;   // PDF sayfa çözünürlüğü (~190 dpi)
const JPEG_QUALITY = 0.88;
const THUMB_MAX = 480;    // önbelleğe alınan ürün görselinin en uzun kenarı (px)
const STORAGE_KEY = 'ruhatech.pricelist.v1';
const NO_CATEGORY = 'Diğer';
const SELECTED_FILTER = '__selected__';
const ROUTE_LIST = '#/pricelist';
const ROUTE_PREVIEW = '#/pricelist/onizleme';
const LOGO_URL = 'img/ruhatech-logo.png';

const LIB_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

// `caps`: hangi metinlerin büyük harfle basılacağı. CSS text-transform yerine
// JS'te tr-TR ile çevriliyor; html2canvas text-transform'u Türkçe "i → İ"
// kuralına uymadan uyguluyor.
const TEMPLATES = [
  {
    id: 'gece', name: 'Gece', desc: 'Koyu başlık, renkli kategori bantları', cols: 4, mockCells: 8,
    caps: { title: true, badge: true, subtitle: true, cat: true, count: true, foot: true },
    fonts: ['800 16px "Plus Jakarta Sans"', '700 16px "Plus Jakarta Sans"', '600 16px "Plus Jakarta Sans"'],
  },
  {
    id: 'vitrin', name: 'Vitrin', desc: 'Sıcak tonlar, büyük ürün görselleri', cols: 3, mockCells: 6,
    caps: { brand: true, badge: true },
    fonts: ['600 16px "Fraunces"', '700 16px "DM Sans"', '500 16px "DM Sans"', '400 16px "DM Sans"'],
  },
];

// Kategori bantlarında sırayla kullanılan renkler.
const CAT_COLORS = [
  '#2446d8', '#7a3fe0', '#ee6a1c', '#0f9488', '#d63a78', '#2f9a48',
  '#d4940a', '#0e86c4', '#d93b3b', '#4c50d6', '#8a5a2b', '#55657d',
];

const DEFAULT_OPTIONS = {
  template: 'gece',
  groupByCategory: true,
  showCode: true,
  sort: 'title',
  catOrderMode: 'alpha',   // 'alpha' | 'custom'
  catOrder: [],            // özel sıralamada kategori adları, sırasıyla
  title: 'Fiyat Listesi',
  badge: 'Toptan',
  subtitle: 'Adet fiyatı · Amerikan Doları (USD)',
  brand: 'RuhaTech',
  contact: 'WhatsApp +90 545 638 73 47',
};
const TEXT_KEYS = ['title', 'badge', 'subtitle', 'brand', 'contact'];

// Önce Türkçe karakterli alt kümeler de yüklensin diye document.fonts.load'a verilir.
const FONT_SAMPLE = 'AaİıŞşĞğÜüÖöÇç0123456789$·';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let products = [];
let selected = new Set();
let options = { ...DEFAULT_OPTIONS };
let catFilter = '';
let currentStep = 1;
let pages = [];             // önizlemedeki .pl-page elemanları; PDF bunlardan üretilir
let previewDirty = true;
let renderSeq = 0;
let generating = false;
let pdfResult = null;       // { file, name, url }
let logoOk = false;         // logo dosyası yüklenebildi mi (yüklenemezse "RT" rozeti kullanılır)
let catDrag = null;         // kategori sürükleme durumu
let catOrderKey = '';       // kategori listesinin son çizilen içeriği

const $ = (id) => document.getElementById(id);
const up = (s) => String(s ?? '').toLocaleUpperCase('tr-TR');

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (Array.isArray(saved.selected)) selected = new Set(saved.selected);
    if (saved.options) options = { ...DEFAULT_OPTIONS, ...saved.options };
  } catch (_) {
    // Bozuk/erişilemeyen kayıt: varsayılanlarla devam.
  }
  if (!TEMPLATES.some((t) => t.id === options.template)) options.template = DEFAULT_OPTIONS.template;
  if (!Array.isArray(options.catOrder)) options.catOrder = [];
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selected: [...selected], options }));
  } catch (_) {
    // Gizli sekme vb. — seçim yalnızca bu oturumda kalır.
  }
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
function getTemplate() { return TEMPLATES.find((t) => t.id === options.template) || TEMPLATES[0]; }
function categoryOf(p) { return String(p.product_tags_0 || '').trim() || NO_CATEGORY; }
/** Fiyatı girilmemiş (boş / 0) ürünler için null döner; listede "Fiyat sorunuz" yazar. */
function priceOf(p) {
  const n = parsePriceNumber(p.price);
  return n !== null && n > 0 ? n : null;
}
function byTitle(a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'tr', { numeric: true }); }
function catCompare(a, b) {
  if (a === b) return 0;
  if (a === NO_CATEGORY) return 1;
  if (b === NO_CATEGORY) return -1;
  return a.localeCompare(b, 'tr');
}
function isViewActive() { return $('priceListView')?.classList.contains('active'); }

/** Kategori adlarını seçili sıralamaya göre dizer (özelde listede olmayanlar sona, A–Z). */
function sortCategories(names) {
  if (options.catOrderMode !== 'custom') return names.sort(catCompare);
  const pos = new Map(options.catOrder.map((n, i) => [n, i]));
  return names.sort((a, b) => {
    const ia = pos.has(a) ? pos.get(a) : Infinity;
    const ib = pos.has(b) ? pos.get(b) : Infinity;
    return ia === ib ? catCompare(a, b) : ia - ib;
  });
}

let logoPromise = null;
function loadLogo() {
  if (!logoPromise) {
    logoPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = LOGO_URL;
    });
  }
  return logoPromise;
}

function initials(name) {
  const caps = name.match(/\p{Lu}/gu) || [];
  if (caps.length >= 2) return caps.slice(0, 2).join('');
  const words = name.trim().split(/\s+/);
  return up(words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2));
}

/** İletişim metnindeki telefon numarasını wa.me formatına (90XXXXXXXXXX) çevirir. */
function whatsappNumber() {
  const d = (options.contact.match(/\d/g) || []).join('');
  if (d.length < 10) return '';
  if (d.length === 10) return '90' + d;
  if (d.length === 11 && d[0] === '0') return '9' + d;
  return d;
}

function productLink(p) {
  const number = whatsappNumber();
  if (number) {
    const msg = `Merhaba, ${p.title} (${p.id}) ürünü hakkında bilgi almak istiyorum.`;
    return `https://wa.me/${number}?text=${encodeURIComponent(msg)}`;
  }
  return /^https?:\/\//.test(p.link || '') ? p.link : '';
}

function fileName() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const slug = (s) => s.replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = [slug(options.brand), slug(options.title) || 'Fiyat-Listesi', date].filter(Boolean).join('-');
  return base + '.pdf';
}

function formatSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

// ---------------------------------------------------------------------------
// Adım 1 — ürün seçimi
// ---------------------------------------------------------------------------
function visibleProducts() {
  const q = $('plSearch').value.trim().toLocaleLowerCase('tr-TR');
  return products.filter((p) => {
    if (catFilter === SELECTED_FILTER) {
      if (!selected.has(p.id)) return false;
    } else if (catFilter && categoryOf(p) !== catFilter) {
      return false;
    }
    if (q) {
      const hay = `${p.title || ''} ${p.id || ''} ${p.brand || ''}`.toLocaleLowerCase('tr-TR');
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort(byTitle);
}

function renderChips() {
  const stats = new Map();
  for (const p of products) {
    const c = categoryOf(p);
    const s = stats.get(c) || { total: 0, sel: 0 };
    s.total++;
    if (selected.has(p.id)) s.sel++;
    stats.set(c, s);
  }
  if (catFilter && catFilter !== SELECTED_FILTER && !stats.has(catFilter)) catFilter = '';

  const chips = [];
  if (selected.size || catFilter === SELECTED_FILTER) {
    chips.push({ value: SELECTED_FILTER, label: 'Seçilenler', n: selected.size, extra: ' pl-chip-selected' });
  }
  chips.push({ value: '', label: `Tümü (${products.length})`, n: 0 });
  [...stats.keys()].sort(catCompare).forEach((name) => {
    chips.push({ value: name, label: `${name} (${stats.get(name).total})`, n: stats.get(name).sel });
  });

  $('plChips').innerHTML = chips.map((c) => `
    <button type="button" class="group-chip${c.extra || ''}${c.value === catFilter ? ' active' : ''}" data-cat="${escapeHtml(c.value)}">${escapeHtml(c.label)}${c.n ? `<span class="pl-chip-n">${c.n}</span>` : ''}</button>
  `).join('');
}

const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function renderList() {
  const list = visibleProducts();
  const el = $('plList');
  $('plVisibleCount').textContent = `${list.length} ürün listeleniyor`;
  $('plSelectAll').textContent = list.length ? `Tümünü seç (${list.length})` : 'Tümünü seç';
  $('plSelectAll').disabled = !list.length;
  $('plUnselectAll').disabled = !list.some((p) => selected.has(p.id));

  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">${products.length ? 'Bu filtreye uyan ürün yok.' : 'Ürünler yükleniyor…'}</div>`;
    return;
  }
  el.innerHTML = list.map((p) => {
    const price = priceOf(p);
    const out = p.availability && p.availability !== 'in stock';
    return `
    <button type="button" class="pl-item" data-id="${escapeHtml(p.id)}" aria-pressed="${selected.has(p.id)}">
      <span class="pl-item-thumb">${p.image_link ? `<img src="${escapeHtml(p.image_link)}" alt="" loading="lazy">` : ''}</span>
      <span class="pl-item-main">
        <span class="pl-item-title">${escapeHtml(p.title || '(başlıksız)')}</span>
        <span class="pl-item-meta">${escapeHtml(p.id)} · ${price === null ? '<span class="warn">fiyat yok</span>' : price.toFixed(2) + ' $'}${out ? ' · <span class="bad">Stok dışı</span>' : ''}</span>
      </span>
      <span class="pl-check" aria-hidden="true">${CHECK_SVG}</span>
    </button>`;
  }).join('');
}

function updateSelectionUI() {
  const n = selected.size;
  $('plSelCount').textContent = n;
  $('plStepCount').textContent = n ? String(n) : '';
  $('plClearAll').hidden = !n;
  $('plUnselectAll').disabled = !visibleProducts().some((p) => selected.has(p.id));
}

function onSelectionChanged() {
  saveState();
  previewDirty = true;
  updateSelectionUI();
  renderChips();
}

function renderStep1() {
  renderChips();
  renderList();
  updateSelectionUI();
}

// ---------------------------------------------------------------------------
// Adım 2 — şablon, seçenekler, önizleme
// ---------------------------------------------------------------------------
function renderTemplatePicker() {
  $('plTemplates').innerHTML = TEMPLATES.map((t) => {
    const cells = '<i></i>'.repeat(t.mockCells);
    return `
    <button type="button" class="pl-tpl" data-tpl="${t.id}" aria-pressed="${t.id === options.template}">
      <span class="pl-mock mock-${t.id}" aria-hidden="true">
        <span class="m-hero"><u></u><b></b><s></s></span>
        <span class="m-cat"></span><span class="m-grid">${cells}</span>
        <span class="m-cat"></span><span class="m-grid">${cells}</span>
      </span>
      <span class="pl-tpl-name">${escapeHtml(t.name)}</span>
      <span class="pl-tpl-desc">${escapeHtml(t.desc)}</span>
    </button>`;
  }).join('');
}

function fillOptionsForm() {
  $('plGroup').checked = options.groupByCategory;
  $('plShowCode').checked = options.showCode;
  $('plSort').value = options.sort;
  $('plCatOrderMode').value = options.catOrderMode;
  for (const k of TEXT_KEYS) $('plText_' + k).value = options[k];
  $('plTemplates').querySelectorAll('.pl-tpl').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tpl === options.template));
}

function setOption(key, value) {
  options[key] = value;
  saveState();
  previewDirty = true;
  schedulePreview();
}

function selectedItems() {
  const cmp = {
    title: byTitle,
    priceAsc: (a, b) => ((priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity)) || byTitle(a, b),
    priceDesc: (a, b) => ((priceOf(b) ?? -Infinity) - (priceOf(a) ?? -Infinity)) || byTitle(a, b),
    code: (a, b) => String(a.id).localeCompare(String(b.id), 'tr', { numeric: true }),
  }[options.sort] || byTitle;
  return products.filter((p) => selected.has(p.id)).sort(cmp);
}

function groupItems(items) {
  if (!options.groupByCategory) return [{ name: null, items }];
  const map = new Map();
  for (const p of items) {
    const c = categoryOf(p);
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(p);
  }
  return sortCategories([...map.keys()]).map((name) => ({ name, items: map.get(name) }));
}

// ---- Kategori sırası (özel sıralama listesi) --------------------------------
function catOrderNames() {
  return [...$('plCatOrderList').querySelectorAll('.pl-co-item')].map((el) => el.dataset.cat);
}

function renderCatOrder() {
  const grouped = options.groupByCategory;
  $('plCatOrderRow').hidden = !grouped;
  const box = $('plCatOrder');
  box.hidden = !grouped || options.catOrderMode !== 'custom';
  if (box.hidden || catDrag) return;

  const counts = new Map();
  for (const p of products) {
    if (!selected.has(p.id)) continue;
    const c = categoryOf(p);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const names = sortCategories([...counts.keys()]);
  // İçerik aynıysa yeniden çizme: ok tuşlarındaki odak kaybolmasın.
  const key = names.map((n) => `${n}:${counts.get(n)}`).join('|');
  if (key === catOrderKey) return;
  catOrderKey = key;
  const last = names.length - 1;
  $('plCatOrderList').innerHTML = names.length ? names.map((name, i) => `
    <li class="pl-co-item" data-cat="${escapeHtml(name)}">
      <span class="pl-co-handle" title="Sürükleyerek taşıyın" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
      </span>
      <span class="pl-co-num">${i + 1}</span>
      <span class="pl-co-name">${escapeHtml(name)}</span>
      <span class="pl-co-count">${counts.get(name)}</span>
      <button type="button" class="pl-co-btn" data-move="-1" aria-label="${escapeHtml(name)} yukarı taşı"${i === 0 ? ' disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 15 6-6 6 6"/></svg>
      </button>
      <button type="button" class="pl-co-btn" data-move="1" aria-label="${escapeHtml(name)} aşağı taşı"${i === last ? ' disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>
      </button>
    </li>`).join('') : '<li class="pl-co-empty">Seçili ürün yok.</li>';
}

/** Ekrandaki sırayı kaydeder; şu an seçili olmayan kategorilerin önceki sırası korunur. */
function commitCatOrder(names) {
  setOption('catOrder', [...names, ...options.catOrder.filter((n) => !names.includes(n))]);
}

function wireCatOrder() {
  const list = $('plCatOrderList');

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-move]');
    if (!btn || btn.disabled) return;
    const cat = btn.closest('.pl-co-item').dataset.cat;
    const names = catOrderNames();
    const i = names.indexOf(cat);
    const j = i + Number(btn.dataset.move);
    if (j < 0 || j >= names.length) return;
    [names[i], names[j]] = [names[j], names[i]];
    commitCatOrder(names);
    renderCatOrder();
    const moved = [...list.querySelectorAll('.pl-co-item')].find((el) => el.dataset.cat === cat);
    const again = moved?.querySelector(`[data-move="${btn.dataset.move}"]`);
    (again && !again.disabled ? again : moved?.querySelector('.pl-co-btn:not([disabled])'))?.focus();
  });

  // Tutamaktan sürükle-bırak (fare ve dokunmatik). İşaretçi listeye bağlanır;
  // satır DOM'da taşınırken yakalama kaybolmasın.
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.pl-co-handle');
    if (!handle || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const item = handle.closest('.pl-co-item');
    catDrag = { item, pointerId: e.pointerId };
    item.classList.add('dragging');
    list.setPointerCapture(e.pointerId);
  });
  list.addEventListener('pointermove', (e) => {
    if (!catDrag || e.pointerId !== catDrag.pointerId) return;
    const y = e.clientY;
    const before = [...list.children].find((el) => {
      if (el === catDrag.item) return false;
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (before) {
      if (catDrag.item.nextElementSibling !== before) list.insertBefore(catDrag.item, before);
    } else if (list.lastElementChild !== catDrag.item) {
      list.appendChild(catDrag.item);
    }
    list.querySelectorAll('.pl-co-num').forEach((n, i) => { n.textContent = i + 1; });
    // Ekranın kenarına yaklaşınca sayfayı kaydır (alttaki sabit çubuğu hesaba kat).
    if (y < 80) window.scrollBy(0, -14);
    else if (y > window.innerHeight - 110) window.scrollBy(0, 14);
  });
  const endDrag = (e) => {
    if (!catDrag || e.pointerId !== catDrag.pointerId) return;
    catDrag.item.classList.remove('dragging');
    catDrag = null;
    commitCatOrder(catOrderNames());
    renderCatOrder();
  };
  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);
}

// ---- Görsel önbelleği -------------------------------------------------------
const thumbResults = new Map();   // url -> blob URL | null (yüklenemedi)
const thumbPromises = new Map();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Görsel yüklenemedi'));
    img.src = src;
  });
}

async function makeThumb(url) {
  let img;
  try {
    img = await loadImage(url);
  } catch (_) {
    // Bazı tarayıcılar listede CORS'suz yüklenmiş görseli önbellekten verip
    // reddediyor; önbelleği atlatarak bir kez daha dene.
    img = await loadImage(url + (url.includes('?') ? '&' : '?') + 'pl=1');
  }
  const scale = Math.min(1, THUMB_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  if (!blob) throw new Error('Görsel işlenemedi');
  return URL.createObjectURL(blob);
}

function getThumb(url) {
  if (!thumbPromises.has(url)) {
    thumbPromises.set(url, makeThumb(url).then(
      (res) => { thumbResults.set(url, res); return res; },
      () => { thumbResults.set(url, null); return null; },
    ));
  }
  return thumbPromises.get(url);
}

async function prepareThumbs(items, onProgress) {
  const urls = [...new Set(items.map((p) => p.image_link).filter(Boolean))];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      await getThumb(url);
      done++;
      onProgress(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
}

async function loadFonts(tpl) {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all(tpl.fonts.map((f) => document.fonts.load(f, FONT_SAMPLE)));
  } catch (_) {
    // Yazı tipi gelmezse yedek yazı tipiyle devam edilir.
  }
}

// ---- Sayfa oluşturma --------------------------------------------------------
function offscreenHost(id) {
  let host = document.getElementById(id);
  if (!host) {
    host = document.createElement('div');
    host.id = id;
    host.className = 'pl-offscreen';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
  }
  return host;
}

function pageParts(tpl) {
  const c = tpl.caps;
  const t = (key, value) => escapeHtml(c[key] ? up(value) : value);
  const title = options.title.trim();
  const badge = options.badge.trim();
  const subtitle = options.subtitle.trim();
  const brand = options.brand.trim();
  const contact = options.contact.trim();
  const wa = whatsappNumber();
  const date = new Date().toLocaleDateString('tr-TR');

  // Logo varsa: ilk sayfada büyük logo, diğer sayfaların üst şeridinde ve her
  // sayfanın alt bilgisinde küçük logo. Yoksa baş harflerden oluşan rozet.
  const mark = logoOk
    ? `<img class="pl-logo-sm" src="${LOGO_URL}" alt="">`
    : (brand ? `<span class="pl-mark">${escapeHtml(initials(brand))}</span>` : '');
  const brandHTML = mark || brand
    ? `<span class="pl-brand">${mark}${brand ? `<span>${t('brand', brand)}</span>` : ''}</span>`
    : '<span class="pl-brand"></span>';
  const subHTML = badge || subtitle
    ? `<div class="pl-hero-sub">${badge ? `<span class="pl-badge">${t('badge', badge)}</span>` : ''}${subtitle ? `<span class="pl-subtitle">${t('subtitle', subtitle)}</span>` : ''}</div>`
    : '';

  const hero = `<header class="pl-hero">
      <div class="pl-hero-top">${logoOk ? '<span class="pl-brand"></span>' : brandHTML}<span class="pl-meta"><span class="pl-date">${date}</span><span class="pl-pageno"></span></span></div>
      <div class="pl-hero-main">
        ${logoOk ? `<img class="pl-logo" src="${LOGO_URL}" alt="${escapeHtml(brand)}">` : ''}
        <div class="pl-hero-text"><h1 class="pl-title">${t('title', title)}</h1>${subHTML}</div>
      </div>
    </header>`;
  const mini = `<header class="pl-minihead">${brandHTML}<span class="pl-minihead-title">${t('title', [title, badge].filter(Boolean).join(' · '))}</span><span class="pl-pageno"></span></header>`;
  const foot = `<footer class="pl-foot">
      ${logoOk ? `<img class="pl-foot-logo" src="${LOGO_URL}" alt="">` : ''}
      ${brand ? `<span class="pl-foot-brand">${t('foot', brand)}</span>` : ''}
      ${brand && contact ? '<span class="pl-foot-dot"></span>' : ''}
      ${contact ? `<span class="pl-foot-contact"${wa ? ` data-href="https://wa.me/${wa}"` : ''}>${t('foot', contact)}</span>` : ''}
      <span class="pl-pageno"></span>
    </footer>`;
  return { hero, mini, foot };
}

function createPage(tpl, parts, first) {
  const page = document.createElement('div');
  page.className = `pl-page plt-${tpl.id}${logoOk ? ' has-logo' : ''}`;
  page.innerHTML = (first ? parts.hero : parts.mini) + '<main class="pl-body"></main>' + parts.foot;
  return page;
}

function catBlockEl(tpl, block, continued) {
  const c = tpl.caps;
  const el = document.createElement('div');
  el.className = 'pl-cat';
  el.dataset.kind = 'cat';
  el.style.setProperty('--cat', block.color);
  const count = `${block.group.items.length} ürün`;
  el.innerHTML = `<span class="pl-cat-index">${String(block.index + 1).padStart(2, '0')}</span>`
    + `<span class="pl-cat-name">${escapeHtml(c.cat ? up(block.group.name) : block.group.name)}</span>`
    + (continued ? `<span class="pl-cat-cont">${c.cat ? up('devam') : 'devam'}</span>` : '')
    + `<span class="pl-cat-count">${escapeHtml(c.count ? up(count) : count)}</span>`;
  return el;
}

function cardHTML(p) {
  const thumb = p.image_link ? thumbResults.get(p.image_link) : null;
  const price = priceOf(p);
  const href = productLink(p);
  return `<div class="pl-card"${href ? ` data-href="${escapeHtml(href)}"` : ''}>
    <div class="pl-card-img">${thumb ? `<img src="${thumb}" alt="">` : '<span class="pl-noimg"></span>'}</div>
    <div class="pl-card-info">
      ${options.showCode && p.id ? `<div class="pl-code">${escapeHtml(p.id)}</div>` : ''}
      <div class="pl-card-title">${escapeHtml(p.title || '')}</div>
    </div>
    ${price === null
    ? '<div class="pl-price"><span class="pl-price-ask">Fiyat sorunuz</span></div>'
    : `<div class="pl-price"><span class="pl-price-num">${price.toFixed(2)}</span><span class="pl-price-cur">$</span></div>`}
  </div>`;
}

function rowBlockEl(tpl, block) {
  const el = document.createElement('div');
  el.className = 'pl-row';
  el.dataset.kind = 'row';
  el.style.setProperty('--cols', tpl.cols);
  el.style.setProperty('--cat', block.color);
  el.innerHTML = block.items.map(cardHTML).join('');
  return el;
}

/** Son eleman sayfa gövdesinin alt sınırını aşıyor mu? */
function overflows(body) {
  const last = body.lastElementChild;
  if (!last) return false;
  const limit = body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom || '0');
  return last.getBoundingClientRect().bottom > limit + 0.5;
}

/**
 * Seçili ürünleri A4 sayfalarına yerleştirir. Bloklar (kategori başlığı, ürün
 * satırı) sırayla eklenip taşma ölçülür; taşan blok yeni sayfaya geçer.
 * Kategori başlığı sayfa sonunda yalnız kalmaz, bölünen kategorinin yeni
 * sayfasında "devam" başlığı tekrarlanır.
 */
function buildPages(items, tpl) {
  const host = offscreenHost('plMeasureHost');
  host.innerHTML = '';
  const parts = pageParts(tpl);

  const blocks = [];
  groupItems(items).forEach((group, index) => {
    const color = CAT_COLORS[index % CAT_COLORS.length];
    if (group.name !== null) blocks.push({ type: 'cat', group, color, index });
    for (let i = 0; i < group.items.length; i += tpl.cols) {
      blocks.push({ type: 'row', group, color, index, items: group.items.slice(i, i + tpl.cols) });
    }
  });

  const result = [];
  let body;
  const newPage = () => {
    const page = createPage(tpl, parts, result.length === 0);
    host.appendChild(page);
    result.push(page);
    body = page.querySelector('.pl-body');
  };
  newPage();

  for (const block of blocks) {
    const el = block.type === 'cat' ? catBlockEl(tpl, block, false) : rowBlockEl(tpl, block);
    body.appendChild(el);
    if (body.children.length === 1 || !overflows(body)) continue;

    body.removeChild(el);
    let carried = null;
    if (block.type === 'row' && body.lastElementChild?.dataset.kind === 'cat' && body.children.length > 1) {
      carried = body.lastElementChild;
      body.removeChild(carried);
    }
    newPage();
    if (carried) body.appendChild(carried);
    else if (block.type === 'row' && block.group.name !== null) body.appendChild(catBlockEl(tpl, block, true));
    body.appendChild(el);
  }

  result.forEach((page, i) => {
    page.querySelectorAll('.pl-pageno').forEach((n) => { n.textContent = `${i + 1} / ${result.length}`; });
  });
  return result;
}

// ---- Önizleme ---------------------------------------------------------------
function previewScale() {
  const el = $('plPreview');
  const cs = getComputedStyle(el);
  const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return Math.min(0.7, Math.max(0.2, inner / PAGE_W));
}

function mountPreview() {
  const preview = $('plPreview');
  preview.innerHTML = '';
  const scale = previewScale();
  for (const page of pages) {
    const sheet = document.createElement('div');
    sheet.className = 'pl-sheet';
    sheet.style.width = `${PAGE_W * scale}px`;
    sheet.style.height = `${PAGE_H * scale}px`;
    page.style.transform = `scale(${scale})`;
    sheet.appendChild(page);
    preview.appendChild(sheet);
  }
}

function rescalePreview() {
  if (currentStep !== 2 || !pages.length || !isViewActive()) return;
  const scale = previewScale();
  $('plPreview').querySelectorAll('.pl-sheet').forEach((sheet) => {
    sheet.style.width = `${PAGE_W * scale}px`;
    sheet.style.height = `${PAGE_H * scale}px`;
    sheet.firstElementChild.style.transform = `scale(${scale})`;
  });
}

function setPreviewStatus(html) {
  $('plPreview').innerHTML = `<div class="pl-preview-status">${html}</div>`;
}

async function renderPreview() {
  if (currentStep !== 2 || !isViewActive()) { previewDirty = true; return; }
  const seq = ++renderSeq;
  previewDirty = false;
  renderCatOrder();
  const items = selectedItems();
  const genBtn = $('plGenerate');

  if (!items.length) {
    pages = [];
    $('plPageCount').textContent = '';
    genBtn.disabled = true;
    setPreviewStatus(`Henüz ürün seçmediniz.<br><a class="btn btn-primary" href="${ROUTE_LIST}">Ürün seç</a>`);
    return;
  }

  if (items.some((p) => p.image_link && !thumbResults.has(p.image_link))) {
    genBtn.disabled = true;
    setPreviewStatus('Görseller hazırlanıyor…');
    await prepareThumbs(items, (done, total) => {
      if (seq === renderSeq) setPreviewStatus(`Görseller hazırlanıyor… ${done} / ${total}`);
    });
    if (seq !== renderSeq) return;
  }

  const tpl = getTemplate();
  [logoOk] = await Promise.all([loadLogo(), loadFonts(tpl)]);
  if (seq !== renderSeq) return;

  pages = buildPages(items, tpl);
  mountPreview();
  $('plPageCount').textContent = `${pages.length} sayfa · ${items.length} ürün`;
  genBtn.disabled = generating;
}

const schedulePreview = debounce(() => renderPreview(), 250);

// ---------------------------------------------------------------------------
// PDF oluşturma
// ---------------------------------------------------------------------------
let libsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PDF araçları yüklenemedi. İnternet bağlantınızı kontrol edin.'));
    document.head.appendChild(s);
  });
}
function loadLibs() {
  if (!libsPromise) {
    libsPromise = Promise.all(LIB_URLS.map(loadScript)).catch((err) => { libsPromise = null; throw err; });
  }
  return libsPromise;
}

function addLinks(pdf, pageEl) {
  const base = pageEl.getBoundingClientRect();
  const k = PDF_W / PAGE_W;
  pageEl.querySelectorAll('[data-href]').forEach((el) => {
    const r = el.getBoundingClientRect();
    pdf.link((r.left - base.left) * k, (r.top - base.top) * k, r.width * k, r.height * k, { url: el.dataset.href });
  });
}

function setProgress(ratio, text) {
  $('plProgressBar').style.width = `${Math.round(ratio * 100)}%`;
  $('plProgressText').textContent = text;
}

function openModal(state) {
  $('plModalBusy').hidden = state !== 'busy';
  $('plModalDone').hidden = state !== 'done';
  $('plModal').classList.add('open');
}
function closeModal() {
  if (generating) return;
  $('plModal').classList.remove('open');
}

async function generatePdf() {
  if (generating || !pages.length) return;
  generating = true;
  $('plGenerate').disabled = true;
  const list = pages.slice();
  const host = offscreenHost('plCaptureHost');
  openModal('busy');
  setProgress(0, 'Hazırlanıyor…');

  try {
    await loadLibs();
    await loadFonts(getTemplate());
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    pdf.setProperties({ title: `${options.brand} ${options.title}`.trim(), author: options.brand, creator: 'RuhaTech Yönetim Paneli' });

    for (let i = 0; i < list.length; i++) {
      setProgress(i / list.length, `Sayfa ${i + 1} / ${list.length} hazırlanıyor…`);
      await nextFrame();
      const clone = list[i].cloneNode(true);
      clone.style.transform = 'none';
      host.innerHTML = '';
      host.appendChild(clone);
      const canvas = await window.html2canvas(clone, {
        scale: RENDER_SCALE,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        // Yalnızca yakalanan sayfayı kopyala; panelin geri kalanı (ürün tablosu vb.)
        // her sayfada boşuna kopyalanmasın.
        ignoreElements: (el) => el !== document.body && document.body.contains(el) && !el.contains(clone) && !clone.contains(el),
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, PDF_W, PDF_H, undefined, 'FAST');
      addLinks(pdf, clone);
      canvas.width = 0;
      canvas.height = 0;
    }

    setProgress(1, 'Dosya kaydediliyor…');
    await nextFrame();
    const blob = pdf.output('blob');
    if (pdfResult) URL.revokeObjectURL(pdfResult.url);
    const name = fileName();
    pdfResult = { name, file: new File([blob], name, { type: 'application/pdf' }), url: URL.createObjectURL(blob) };

    const canShare = !!(navigator.canShare && navigator.canShare({ files: [pdfResult.file] }));
    $('plShare').hidden = !canShare;
    $('plDownload').classList.toggle('btn-primary', !canShare);
    $('plDoneInfo').textContent = `${list.length} sayfa · ${formatSize(blob.size)}`;
    openModal('done');
  } catch (err) {
    console.error(err);
    $('plModal').classList.remove('open');
    toast('PDF oluşturulamadı: ' + (err.message || err), 'err');
  } finally {
    host.innerHTML = '';
    generating = false;
    $('plGenerate').disabled = !pages.length;
  }
}

function downloadPdf() {
  if (!pdfResult) return;
  const a = document.createElement('a');
  a.href = pdfResult.url;
  a.download = pdfResult.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function sharePdf() {
  if (!pdfResult) return;
  try {
    await navigator.share({ files: [pdfResult.file], title: pdfResult.name });
  } catch (err) {
    if (err && err.name !== 'AbortError') toast('Paylaşılamadı: ' + err.message, 'err');
  }
}

// ---------------------------------------------------------------------------
// Dışa açık API (dashboard.js kullanır)
// ---------------------------------------------------------------------------
export function initPriceList() {
  loadState();
  renderTemplatePicker();
  fillOptionsForm();

  document.querySelectorAll('.pl-step').forEach((b) => b.addEventListener('click', () => {
    location.hash = b.dataset.step === '2' ? ROUTE_PREVIEW : ROUTE_LIST;
  }));

  // Adım 1
  $('plSearch').addEventListener('input', debounce(renderList, 150));
  $('plChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.group-chip');
    if (!chip) return;
    catFilter = chip.dataset.cat;
    renderChips();
    renderList();
  });
  $('plList').addEventListener('click', (e) => {
    const item = e.target.closest('.pl-item');
    if (!item) return;
    const id = item.dataset.id;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    item.setAttribute('aria-pressed', selected.has(id));
    onSelectionChanged();
  });
  $('plSelectAll').addEventListener('click', () => {
    visibleProducts().forEach((p) => selected.add(p.id));
    onSelectionChanged();
    renderList();
  });
  $('plUnselectAll').addEventListener('click', () => {
    visibleProducts().forEach((p) => selected.delete(p.id));
    onSelectionChanged();
    renderList();
  });
  $('plClearAll').addEventListener('click', () => {
    if (selected.size > 5 && !confirm(`${selected.size} ürünün seçimi kaldırılsın mı?`)) return;
    selected.clear();
    if (catFilter === SELECTED_FILTER) catFilter = '';
    onSelectionChanged();
    renderList();
  });
  $('plNext').addEventListener('click', () => {
    if (!selected.size) { toast('Önce en az bir ürün seçin.', 'err'); return; }
    location.hash = ROUTE_PREVIEW;
  });

  // Adım 2
  $('plTemplates').addEventListener('click', (e) => {
    const btn = e.target.closest('.pl-tpl');
    if (!btn || btn.dataset.tpl === options.template) return;
    $('plTemplates').querySelectorAll('.pl-tpl').forEach((b) => b.setAttribute('aria-pressed', b === btn));
    setOption('template', btn.dataset.tpl);
  });
  $('plGroup').addEventListener('change', (e) => {
    setOption('groupByCategory', e.target.checked);
    renderCatOrder();
  });
  $('plShowCode').addEventListener('change', (e) => setOption('showCode', e.target.checked));
  $('plSort').addEventListener('change', (e) => setOption('sort', e.target.value));
  $('plCatOrderMode').addEventListener('change', (e) => {
    setOption('catOrderMode', e.target.value);
    renderCatOrder();
  });
  wireCatOrder();
  for (const k of TEXT_KEYS) {
    $('plText_' + k).addEventListener('input', (e) => setOption(k, e.target.value));
  }
  $('plResetTexts').addEventListener('click', () => {
    for (const k of TEXT_KEYS) options[k] = DEFAULT_OPTIONS[k];
    fillOptionsForm();
    setOption('title', options.title);
  });
  $('plBack').addEventListener('click', () => { location.hash = ROUTE_LIST; });
  $('plGenerate').addEventListener('click', generatePdf);

  // Sonuç penceresi
  $('plShare').addEventListener('click', sharePdf);
  $('plDownload').addEventListener('click', downloadPdf);
  $('plModalClose').addEventListener('click', closeModal);
  $('plModal').addEventListener('click', (e) => { if (e.target === $('plModal')) closeModal(); });

  window.addEventListener('resize', debounce(rescalePreview, 150));
}

export function setPriceListProducts(items) {
  products = items;
  if (products.length) {
    const ids = new Set(products.map((p) => p.id));
    const before = selected.size;
    selected = new Set([...selected].filter((id) => ids.has(id)));
    if (selected.size !== before) saveState();
  }
  previewDirty = true;
  if (!isViewActive()) return;
  if (currentStep === 1) renderStep1();
  else schedulePreview();
}

export function showPriceList(step) {
  currentStep = step;
  $('plStep1').hidden = step !== 1;
  $('plStep2').hidden = step !== 2;
  document.querySelectorAll('.pl-step').forEach((b) => {
    const active = Number(b.dataset.step) === step;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  if (step === 1) {
    renderStep1();
  } else if (previewDirty || !pages.length) {
    renderPreview();
  } else {
    rescalePreview();
  }
}
