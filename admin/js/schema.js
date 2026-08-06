// Ürün şeması: Firestore alan adı <-> Facebook/Meta CSV sütun adı eşlemesi.
// CSV sütun sırası, mevcut ruhatech-catalog.csv ile birebir aynı olmalı.
// Not: Facebook'un desteklediği alanların TAMAMI burada tanımlı kalır (CSV içe/dışa
// aktarım bunları korur) — ama FORM_SECTIONS'ta yalnızca gerçekten kullanılanlar
// gösterilir. Formda olmayan alanlar kayıtta FORCED_FIELDS ile hep boş/varsayılan yazılır.

export const CSV_COLUMNS = [
  'id', 'title', 'description', 'availability', 'condition', 'price', 'link',
  'image_link', 'additional_image_link', 'brand', 'google_product_category',
  'fb_product_category', 'quantity_to_sell_on_facebook', 'sale_price',
  'sale_price_effective_date', 'item_group_id', 'gender', 'color', 'size',
  'age_group', 'material', 'pattern', 'shipping', 'shipping_weight',
  'offer_disclaimer', 'offer_disclaimer_url', 'video[0].url', 'video[0].tag[0]',
  'gtin', 'product_tags[0]', 'product_tags[1]', 'product_tags[2]', 'style[0]',
];

// Firestore alan adları nokta/köşeli parantez içeremediği için sanitize edilir.
export const FIELD_TO_CSV = {
  id: 'id', title: 'title', description: 'description', availability: 'availability',
  condition: 'condition', price: 'price', link: 'link', image_link: 'image_link',
  additional_image_link: 'additional_image_link', brand: 'brand',
  google_product_category: 'google_product_category', fb_product_category: 'fb_product_category',
  quantity_to_sell_on_facebook: 'quantity_to_sell_on_facebook', sale_price: 'sale_price',
  sale_price_effective_date: 'sale_price_effective_date', item_group_id: 'item_group_id',
  gender: 'gender', color: 'color', size: 'size', age_group: 'age_group',
  material: 'material', pattern: 'pattern', shipping: 'shipping', shipping_weight: 'shipping_weight',
  offer_disclaimer: 'offer_disclaimer', offer_disclaimer_url: 'offer_disclaimer_url',
  video_url: 'video[0].url', video_tag: 'video[0].tag[0]', gtin: 'gtin',
  product_tags_0: 'product_tags[0]', product_tags_1: 'product_tags[1]',
  product_tags_2: 'product_tags[2]', style_0: 'style[0]',
};
export const CSV_TO_FIELD = Object.fromEntries(Object.entries(FIELD_TO_CSV).map(([k, v]) => [v, k]));

// Formda hiç sorulmayan alanlar — kayıt anında (add/edit fark etmez) hep bu
// değerlerle ezilir. Böylece eski (CSV'den içe aktarılmış) veriler de bir ürün
// her düzenlendiğinde temizlenmiş olur.
export const FORCED_FIELDS = {
  condition: 'new',
  sale_price: '',
  sale_price_effective_date: '',
  quantity_to_sell_on_facebook: '',
  fb_product_category: '',
  item_group_id: '',
  gtin: '',
  gender: '', age_group: '', color: '', size: '', material: '', pattern: '',
  shipping: '', shipping_weight: '',
  offer_disclaimer: '', offer_disclaimer_url: '',
  style_0: '',
  video_tag: '',
  product_tags_2: '',
};

// Form alanları — bölümlere ayrılmış, sıralı liste. Yalnızca burada olan alanlar
// ekle/düzenle sayfasında görünür.
export const FORM_SECTIONS = [
  {
    title: 'Temel Bilgiler',
    fields: [
      { key: 'id', label: 'Ürün Kodu (SKU)', type: 'text', required: true, help: 'Katalogda tek olmalı, örn. ARB013' },
      { key: 'title', label: 'Ürün Adı', type: 'text', required: true, maxLength: 200 },
      { key: 'description', label: 'Açıklama', type: 'textarea', required: true, maxLength: 9999 },
      { key: 'brand', label: 'Marka', type: 'text', required: true },
    ],
  },
  {
    title: 'Fiyat ve Stok',
    fields: [
      { key: 'availability', label: 'Stok Durumu', type: 'select', required: true,
        options: [['in stock', 'Stokta'], ['out of stock', 'Stok Dışı']] },
      { key: 'price', label: 'Fiyat (USD)', type: 'number', required: true, step: '0.01', min: '0' },
    ],
  },
  {
    title: 'Bağlantılar ve Görseller',
    fields: [
      { key: 'link', label: 'Ürün Sayfası Linki', type: 'text', required: true, placeholder: 'https://wa.me/...' },
      { key: 'image_link', label: 'Ana Görsel', type: 'image', required: true },
      { key: 'additional_image_link', label: 'Ek Görseller', type: 'images', help: 'Birden fazla dosya seçebilirsiniz' },
      { key: 'video_url', label: 'Ürün Videosu', type: 'video', help: 'İsteğe bağlı, en fazla 40MB' },
    ],
  },
  {
    title: 'Kategori',
    onlyOnAdd: true,
    fields: [
      { key: 'google_product_category', label: 'Google Ürün Kategorisi', type: 'text',
        placeholder: 'Electronics > Electronics Accessories > ...',
        help: 'Yalnızca yeni ürün eklerken sorulur; sonradan düzenleme ekranında gösterilmez.' },
    ],
  },
  {
    title: 'Etiketler',
    fields: [
      { key: 'product_tags_0', label: 'Etiket 1', type: 'tagselect' },
      { key: 'product_tags_1', label: 'Etiket 2', type: 'tagselect' },
    ],
  },
];

export const ALL_FIELD_KEYS = FORM_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export function emptyProduct() {
  const p = {};
  for (const k of Object.keys(FIELD_TO_CSV)) p[k] = '';
  p.availability = 'in stock';
  p.condition = 'new';
  return p;
}
