/**
 * The shape of a collection entry, and the rules for cleaning one up.
 *
 * Deliberately free of DOM and IndexedDB references so the same code runs in
 * the browser and under `node --test`.
 */

export const STATUSES = ['have', 'want', 'had'];
export const CONDITIONS = ['boxed', 'loose', 'unknown'];
export const CATEGORIES = ['funko-pop', 'action-figure', 'anime-figure', 'statue', 'other'];

export const STATUS_LABELS = {
  have: 'Have',
  want: 'Want',
  had: 'Had',
};

/** RFC 4122 v4 id, falling back to Math.random on very old engines. */
export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function str(value, max = 300) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function oneOf(value, allowed, fallback) {
  const v = str(value).toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

function posInt(value, fallback = 1) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 9999);
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function isoDate(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Normalise anything item-shaped into a valid entry. Used on every write and
 * on every imported record, so a hand-edited backup file cannot put junk into
 * the database.
 */
export function normaliseItem(input = {}) {
  const now = new Date().toISOString();
  const name = str(input.name, 200);
  return {
    id: str(input.id, 64) || newId(),
    catalogId: str(input.catalogId, 64) || null,
    name,
    number: str(input.number, 32) || null,
    license: str(input.license, 120) || null,
    series: str(input.series, 120) || null,
    category: oneOf(input.category, CATEGORIES, 'funko-pop'),
    status: oneOf(input.status, STATUSES, 'have'),
    quantity: posInt(input.quantity, 1),
    condition: oneOf(input.condition, CONDITIONS, 'unknown'),
    exclusive: str(input.exclusive, 80) || null,
    chase: Boolean(input.chase),
    barcode: str(input.barcode, 32).replace(/\s+/g, '') || null,
    paid: money(input.paid),
    notes: str(input.notes, 2000),
    addedAt: isoDate(input.addedAt || now),
    updatedAt: isoDate(input.updatedAt || now),
  };
}

/** An item is only usable if it has something to call it. */
export function validateItem(item) {
  const errors = [];
  if (!item.name) errors.push('Give the item a name.');
  if (!STATUSES.includes(item.status)) errors.push('Pick have, want, or had.');
  if (!Number.isInteger(item.quantity) || item.quantity < 1) errors.push('Quantity must be 1 or more.');
  return errors;
}

/** Summary counts for the ledger footing at the top of a list. */
export function tally(items) {
  const out = { have: 0, want: 0, had: 0, copies: 0, licenses: 0 };
  const licenses = new Set();
  for (const item of items) {
    if (out[item.status] !== undefined) out[item.status] += 1;
    if (item.status === 'have') out.copies += item.quantity;
    if (item.license) licenses.add(item.license);
  }
  out.licenses = licenses.size;
  return out;
}
