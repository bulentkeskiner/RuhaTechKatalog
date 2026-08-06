import { db, auth } from './firebase-init.js';
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  writeBatch, serverTimestamp, addDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const productsCol = collection(db, 'products');
const activityCol = collection(db, 'activity');

export function subscribeProducts(onChange, onError) {
  return onSnapshot(productsCol, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ ...d.data(), _docId: d.id }));
    onChange(items);
  }, onError);
}

/** Anlık dinleyiciyi beklemeden, o anki güncel ürün listesini tek seferlik çeker. */
export async function getAllProductsOnce() {
  const snap = await getDocs(productsCol);
  const items = [];
  snap.forEach((d) => items.push({ ...d.data(), _docId: d.id }));
  return items;
}

export async function getProduct(id) {
  const snap = await getDoc(doc(db, 'products', id));
  return snap.exists() ? { ...snap.data(), _docId: snap.id } : null;
}

export async function productExists(id) {
  const snap = await getDoc(doc(db, 'products', id));
  return snap.exists();
}

export async function createProduct(product) {
  const ref = doc(db, 'products', product.id);
  await setDoc(ref, { ...product, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await logActivity('create', product.id, product.title);
}

export async function updateProduct(oldId, product) {
  if (oldId === product.id) {
    const ref = doc(db, 'products', oldId);
    await updateDoc(ref, { ...product, updatedAt: serverTimestamp() });
  } else {
    // SKU (doküman ID'si) değiştiyse: yeni dokümanı oluştur, eskisini sil.
    const newRef = doc(db, 'products', product.id);
    await setDoc(newRef, { ...product, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await deleteDoc(doc(db, 'products', oldId));
  }
  await logActivity('update', product.id, product.title);
}

export async function deleteProduct(id, title) {
  await deleteDoc(doc(db, 'products', id));
  await logActivity('delete', id, title);
}

export async function bulkUpsertProducts(products, onProgress) {
  const CHUNK = 400;
  let done = 0;
  for (let i = 0; i < products.length; i += CHUNK) {
    const batch = writeBatch(db);
    const slice = products.slice(i, i + CHUNK);
    for (const p of slice) {
      const ref = doc(db, 'products', p.id);
      batch.set(ref, { ...p, updatedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    done += slice.length;
    if (onProgress) onProgress(done, products.length);
  }
}

async function logActivity(action, productId, title) {
  try {
    await addDoc(activityCol, {
      action, productId, title: title || '',
      uid: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      at: serverTimestamp(),
    });
  } catch (_) {
    // Aktivite kaydı ikincil bir özellik; başarısız olursa sessizce geç.
  }
}
