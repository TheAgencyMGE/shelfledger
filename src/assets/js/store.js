/**
 * Collection operations. Everything the UI does to your data goes through here.
 *
 * Views subscribe with onChange() and re-read, rather than patching their own
 * copies, with a dataset this size that is simpler and always correct, and it
 * keeps two open tabs from drifting apart.
 */

import * as db from './db.js';
import { normaliseItem, validateItem } from './model.js';

const listeners = new Set();

/** Subscribe to any write. Returns an unsubscribe function. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce() {
  for (const fn of listeners) fn();
}

export async function allItems() {
  const items = await db.getAll(db.STORE_ITEMS);
  return items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export async function itemsByStatus(status) {
  return (await allItems()).filter((i) => i.status === status);
}

export async function getItem(id) {
  return db.get(db.STORE_ITEMS, id);
}

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.errors = errors;
  }
}

export async function saveItem(input) {
  const existing = input.id ? await getItem(input.id) : null;
  const item = normaliseItem({
    ...input,
    addedAt: existing?.addedAt ?? input.addedAt,
    updatedAt: new Date().toISOString(),
  });
  const errors = validateItem(item);
  if (errors.length) throw new ValidationError(errors);
  await db.put(db.STORE_ITEMS, item);
  announce();
  return item;
}

export async function setStatus(id, status) {
  const item = await getItem(id);
  if (!item) throw new Error('That item is no longer in your collection.');
  return saveItem({ ...item, status });
}

export async function adjustQuantity(id, delta) {
  const item = await getItem(id);
  if (!item) throw new Error('That item is no longer in your collection.');
  return saveItem({ ...item, quantity: Math.max(1, item.quantity + delta) });
}

export async function deleteItem(id) {
  await db.remove(db.STORE_ITEMS, id);
  announce();
}

/** Replace the whole collection in one transaction. Used by import. */
export async function replaceCollection(items) {
  const clean = items.map(normaliseItem);
  await db.replaceAll(db.STORE_ITEMS, clean);
  announce();
  return clean.length;
}

export async function putMany(items) {
  const clean = items.map(normaliseItem);
  await db.putMany(db.STORE_ITEMS, clean);
  announce();
  return clean.length;
}

export async function clearCollection() {
  await db.clear(db.STORE_ITEMS);
  announce();
}

/** Distinct values for the filter dropdowns, in alphabetical order. */
export async function facets() {
  const items = await allItems();
  const pick = (field) =>
    [...new Set(items.map((i) => i[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { licenses: pick('license'), series: pick('series'), categories: pick('category') };
}

/* ------------------------------------------------------------- settings */

export async function getSetting(key, fallback = null) {
  const row = await db.get(db.STORE_SETTINGS, key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.put(db.STORE_SETTINGS, { key, value });
  return value;
}

export async function allSettings() {
  const rows = await db.getAll(db.STORE_SETTINGS);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function replaceSettings(settings) {
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
  await db.replaceAll(db.STORE_SETTINGS, rows);
}
