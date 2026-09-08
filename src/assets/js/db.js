/**
 * A very small IndexedDB wrapper.
 *
 * IndexedDB is the whole backend. Nothing in this file talks to the network,
 * and nothing outside this file talks to IndexedDB.
 */

const DB_NAME = 'shelfledger';
const DB_VERSION = 1;

export const STORE_ITEMS = 'items';
export const STORE_SETTINGS = 'settings';

let dbPromise = null;

function upgrade(db) {
  if (!db.objectStoreNames.contains(STORE_ITEMS)) {
    const items = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
    items.createIndex('status', 'status', { unique: false });
    items.createIndex('license', 'license', { unique: false });
    items.createIndex('series', 'series', { unique: false });
    items.createIndex('category', 'category', { unique: false });
    items.createIndex('catalogId', 'catalogId', { unique: false });
    items.createIndex('barcode', 'barcode', { unique: false });
    items.createIndex('updatedAt', 'updatedAt', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
    db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
  }
}

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so there is nowhere to keep your collection.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open the local database.'));
    request.onblocked = () =>
      reject(new Error('Another ShelfLedger tab is open and blocking an upgrade. Close it and reload.'));
  });
  return dbPromise;
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run `fn(store)` inside a transaction and resolve once it commits. */
export async function withStore(name, mode, fn) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result instanceof Promise ? undefined : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The write was rolled back.'));
    if (result instanceof Promise) result.then((v) => (result = v), reject);
  });
}

export async function getAll(name) {
  const db = await openDatabase();
  const tx = db.transaction(name, 'readonly');
  return promisify(tx.objectStore(name).getAll());
}

export async function get(name, key) {
  const db = await openDatabase();
  const tx = db.transaction(name, 'readonly');
  return promisify(tx.objectStore(name).get(key));
}

export async function put(name, value) {
  await withStore(name, 'readwrite', (store) => store.put(value));
  return value;
}

export async function putMany(name, values) {
  await withStore(name, 'readwrite', (store) => {
    for (const value of values) store.put(value);
  });
  return values.length;
}

export async function remove(name, key) {
  await withStore(name, 'readwrite', (store) => store.delete(key));
}

export async function clear(name) {
  await withStore(name, 'readwrite', (store) => store.clear());
}

/** Replace a store's entire contents in one transaction, so an import is atomic. */
export async function replaceAll(name, values) {
  await withStore(name, 'readwrite', (store) => {
    store.clear();
    for (const value of values) store.put(value);
  });
  return values.length;
}

/** Rough storage usage, when the browser is willing to say. */
export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
