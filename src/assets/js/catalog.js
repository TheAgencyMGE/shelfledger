/**
 * The shared catalogue: a public, versioned dataset of items people collect.
 *
 * It ships as one shard per category so a phone only downloads what it needs,
 * and it is fetched from this same origin. That fetch is the only network
 * request the app ever makes, and it carries no information about you, it is
 * the same file everybody gets.
 */

import { BASE } from './ui.js';
import { searchEntries } from './search.js';

const shardCache = new Map();
let indexPromise = null;

function url(path) {
  return `${BASE}data/catalog/${path}`;
}

export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(url('index.json'), { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`Catalogue index returned ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

/** Expand column-oriented rows back into objects. */
function hydrate(payload) {
  const { fields, rows, category } = payload;
  return rows.map((row) => {
    const entry = { category };
    fields.forEach((field, i) => {
      entry[field] = row[i];
    });
    return entry;
  });
}

export async function loadShard(category) {
  if (shardCache.has(category)) return shardCache.get(category);
  const promise = fetch(url(`${category}.json`), { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`Catalogue shard "${category}" returned ${res.status}`);
      return res.json();
    })
    .then(hydrate)
    .catch((err) => {
      shardCache.delete(category);
      throw err;
    });
  shardCache.set(category, promise);
  return promise;
}

/** Load every shard. Called lazily, the first time someone searches. */
export async function loadAll() {
  const index = await loadIndex();
  const shards = await Promise.all(index.shards.map((s) => loadShard(s.category)));
  return shards.flat();
}

export async function search(query, limit = 25) {
  if (!query || query.trim().length < 2) return [];
  return searchEntries(query, await loadAll(), limit);
}

/** Exact barcode lookup. Returns null when nothing in the catalogue matches. */
export async function findByBarcode(barcode) {
  const clean = String(barcode).replace(/\D/g, '');
  if (!clean) return null;
  const entries = await loadAll();
  return (
    entries.find((e) => Array.isArray(e.barcodes) && e.barcodes.some((b) => String(b) === clean)) ??
    null
  );
}

/** Item-number lookup, which is how collectors usually identify a figure. */
export async function findByNumber(number) {
  const clean = String(number).trim();
  if (!clean) return null;
  const entries = await loadAll();
  return entries.find((e) => String(e.number) === clean) ?? null;
}

export async function stats() {
  const index = await loadIndex();
  return {
    version: index.version,
    updated: index.updated,
    total: index.shards.reduce((sum, s) => sum + s.count, 0),
    shards: index.shards,
  };
}

/** Turn a catalogue entry into the fields a new collection item starts with. */
export function toItemDraft(entry) {
  return {
    catalogId: entry.id ?? null,
    name: entry.name ?? '',
    number: entry.number ?? null,
    license: entry.license ?? null,
    series: entry.series ?? null,
    category: entry.category ?? 'funko-pop',
  };
}
