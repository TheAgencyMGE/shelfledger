/**
 * The backup file format.
 *
 * This file is the closest thing ShelfLedger has to an account. It is the only
 * way a collection moves between devices, so it stays boring on purpose: plain
 * JSON, every field spelled out, no compression, no ids that mean anything
 * outside your own browser. You should be able to open it in a text editor and
 * understand it.
 */

import { normaliseItem, validateItem } from './model.js';

export const FORMAT = 'shelfledger.backup';
export const FORMAT_VERSION = 1;

/** Serialise a collection into the object that gets written to disk. */
export function buildExport(items, settings = {}, { now = new Date() } = {}) {
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: now.toISOString(),
    app: 'ShelfLedger',
    itemCount: items.length,
    items: items.map(normaliseItem).sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
    settings,
  };
}

export function serialise(items, settings, opts) {
  return JSON.stringify(buildExport(items, settings, opts), null, 2);
}

/** A filename that sorts chronologically and says what it is. */
export function backupFilename(now = new Date()) {
  const d = now.toISOString().slice(0, 10);
  return `shelfledger-backup-${d}.json`;
}

export class ImportError extends Error {}

/**
 * Read a backup file back. Throws ImportError with a message meant for a person
 * rather than a console. Unknown fields are dropped, bad records are reported
 * rather than silently skipped.
 */
export function parseImport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('That file is not valid JSON. Pick the .json file ShelfLedger exported.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ImportError('That file does not look like a ShelfLedger backup.');
  }
  if (raw.format !== FORMAT) {
    throw new ImportError(
      `Expected a ShelfLedger backup, found "${raw.format ?? 'no format marker'}".`,
    );
  }
  if (Number(raw.formatVersion) > FORMAT_VERSION) {
    throw new ImportError(
      `That backup was written by a newer version of ShelfLedger (format ${raw.formatVersion}). Update the app, then import again.`,
    );
  }
  if (!Array.isArray(raw.items)) {
    throw new ImportError('That backup has no items list.');
  }

  const items = [];
  const skipped = [];
  for (const [index, record] of raw.items.entries()) {
    const item = normaliseItem(record);
    const errors = validateItem(item);
    if (errors.length) {
      skipped.push({ index, name: record?.name ?? '(no name)', errors });
      continue;
    }
    items.push(item);
  }

  return {
    items,
    skipped,
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
    exportedAt: raw.exportedAt ?? null,
  };
}

/**
 * Merge imported items into existing ones without creating duplicates: same id
 * wins by whichever was updated last. Used by the "merge" import mode.
 */
export function mergeItems(existing, incoming) {
  const byId = new Map(existing.map((i) => [i.id, i]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const item of incoming) {
    const current = byId.get(item.id);
    if (!current) {
      byId.set(item.id, item);
      added += 1;
    } else if (item.updatedAt > current.updatedAt) {
      byId.set(item.id, item);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }
  return { items: [...byId.values()], added, updated, unchanged };
}
