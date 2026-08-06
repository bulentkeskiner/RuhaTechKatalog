import { CSV_COLUMNS, CSV_TO_FIELD, FIELD_TO_CSV } from './schema.js';
import { parseCSV, toCSVRow, formatPrice, parsePriceNumber } from './utils.js';

const COMMENT_ROW = [
  '# Zorunlu | Ürün için benzersiz bir içerik kodu.',
  '# Zorunlu | Ürün başlığı.',
  '# Zorunlu | Ürün açıklaması.',
  '# Zorunlu | Stok durumu: in stock; out of stock',
  '# Zorunlu | Durum: new; used; refurbished',
  '# Zorunlu | Fiyat, örn. 12.99 USD',
  '# Zorunlu | Ürün sayfası / iletişim linki.',
  '# Zorunlu | Ana görsel URL.',
  '# İsteğe bağlı | Ek görsel URL\'leri (virgülle ayrılmış).',
  '# Zorunlu | Marka.',
  '# İsteğe bağlı | Google ürün kategorisi.',
  '# İsteğe bağlı | Facebook ürün kategorisi.',
  '# İsteğe bağlı | Satılabilir adet.',
  '# İsteğe bağlı | İndirimli fiyat.',
  '# İsteğe bağlı | İndirim tarih aralığı.',
  '# İsteğe bağlı | Varyant grup ID.',
  '# İsteğe bağlı | Cinsiyet: female; male; unisex',
  '# İsteğe bağlı | Renk.',
  '# İsteğe bağlı | Beden.',
  '# İsteğe bağlı | Yaş grubu.',
  '# İsteğe bağlı | Materyal.',
  '# İsteğe bağlı | Desen.',
  '# İsteğe bağlı | Gönderim bilgisi.',
  '# İsteğe bağlı | Gönderim ağırlığı.',
  '# İsteğe bağlı | Açıklama notu.',
  '# İsteğe bağlı | Açıklama notu URL.',
  '# İsteğe bağlı | Video URL.',
  '# İsteğe bağlı | Video etiketi.',
  '# İsteğe bağlı | GTIN / Barkod.',
  '# İsteğe bağlı | Etiket 1.',
  '# İsteğe bağlı | Etiket 2.',
  '# İsteğe bağlı | Etiket 3.',
  '# İsteğe bağlı | Stil.',
];

/** Firestore ürün nesnesini Meta/Facebook CSV formatına uygun tek satıra çevirir. */
export function productToCSVRow(p) {
  return CSV_COLUMNS.map((col) => {
    const field = CSV_TO_FIELD[col];
    if (field === 'price' || field === 'sale_price') {
      const v = p[field];
      return v === '' || v === null || v === undefined ? '' : formatPrice(v);
    }
    return p[field] ?? '';
  });
}

/**
 * `includeHelpRow: true` yalnızca elle indirilen CSV'de (Excel'de açıp okumak için)
 * kullanılmalı. Facebook/WhatsApp'ın canlı feed URL'sinde İLK satır mutlaka gerçek
 * sütun adları (id,title,...) olmalı — açıklama satırı orada olursa Meta bunu header
 * sanıp hiçbir sütunu tanıyamaz ve besleme tamamen geçersiz olur.
 */
export function productsToCSV(products, { includeHelpRow = false } = {}) {
  const header = CSV_COLUMNS;
  const lines = includeHelpRow ? [toCSVRow(COMMENT_ROW), toCSVRow(header)] : [toCSVRow(header)];
  for (const p of products) lines.push(toCSVRow(productToCSVRow(p)));
  return lines.join('\r\n') + '\r\n';
}

/** CSV metnini parse edip Firestore'a yazılabilir ürün nesneleri döndürür. */
export function csvToProducts(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV boş görünüyor.');

  let headerIdx = 0;
  if (rows[0][0] && rows[0][0].trim().startsWith('#')) headerIdx = 1;
  const header = rows[headerIdx].map((h) => h.trim());

  const products = [];
  const warnings = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw || !raw.length) continue;
    const obj = {};
    header.forEach((col, idx) => {
      const field = CSV_TO_FIELD[col];
      if (!field) return;
      obj[field] = (raw[idx] || '').trim();
    });
    if (!obj.id) { warnings.push(`Satır ${i + 1}: id boş, atlandı.`); continue; }

    if (obj.price !== undefined) {
      const n = parsePriceNumber(obj.price);
      obj.price = n === null ? '' : n;
    }
    if (obj.sale_price !== undefined) {
      const n = parsePriceNumber(obj.sale_price);
      obj.sale_price = n === null ? '' : n;
    }
    if (obj.quantity_to_sell_on_facebook !== undefined && obj.quantity_to_sell_on_facebook !== '') {
      const n = parseInt(obj.quantity_to_sell_on_facebook, 10);
      obj.quantity_to_sell_on_facebook = isNaN(n) ? '' : n;
    }
    products.push(obj);
  }
  return { products, warnings };
}
