import { db } from './firebase-init.js';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, writeBatch,
  query, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const tagsCol = collection(db, 'tags');
const productsCol = collection(db, 'products');
const TAG_PRODUCT_FIELDS = ['product_tags_0', 'product_tags_1', 'product_tags_2'];

function tagDocId(name) {
  // Firestore doküman ID'si '/' içeremez; adı olabildiğince okunur biçimde saklarız.
  return encodeURIComponent(name.trim());
}

export function subscribeTags(onChange) {
  return onSnapshot(tagsCol, (snap) => {
    const items = [];
    snap.forEach((d) => items.push(d.data().name));
    items.sort((a, b) => a.localeCompare(b, 'tr'));
    onChange(items);
  });
}

export async function addTag(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Etiket adı boş olamaz.');
  await setDoc(doc(tagsCol, tagDocId(trimmed)), { name: trimmed, createdAt: serverTimestamp() }, { merge: true });
}

export async function deleteTag(name) {
  await deleteDoc(doc(tagsCol, tagDocId(name)));
}

/** Etiketi yeniden adlandırır ve bu etiketi kullanan tüm ürünlerde de günceller. */
export async function renameTag(oldName, newName) {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;

  await setDoc(doc(tagsCol, tagDocId(trimmed)), { name: trimmed, createdAt: serverTimestamp() }, { merge: true });

  for (const field of TAG_PRODUCT_FIELDS) {
    const snap = await getDocs(query(productsCol, where(field, '==', oldName)));
    if (snap.empty) continue;
    const batch = writeBatch(db);
    snap.forEach((d) => batch.update(d.ref, { [field]: trimmed }));
    await batch.commit();
  }

  await deleteDoc(doc(tagsCol, tagDocId(oldName)));
}

/**
 * Ürünlerde kullanılan ama henüz 'tags' koleksiyonunda olmayan etiketleri otomatik ekler.
 * Yalnızca eksik olanları yazar (idempotent) — her açılışta güvenle çalıştırılabilir.
 */
export async function seedTagsFromProducts(products, existingTags) {
  const existing = new Set(existingTags);
  const found = new Set();
  for (const p of products) {
    for (const field of TAG_PRODUCT_FIELDS) {
      const v = (p[field] || '').trim();
      if (v) found.add(v);
    }
  }
  const missing = [...found].filter((t) => !existing.has(t));
  if (!missing.length) return 0;
  const batch = writeBatch(db);
  for (const name of missing) {
    batch.set(doc(tagsCol, tagDocId(name)), { name, createdAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  return missing.length;
}
