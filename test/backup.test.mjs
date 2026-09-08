/**
 * The backup file is the only way a collection survives a cleared browser, so
 * these tests care most about one thing: what goes out comes back identical.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExport,
  serialise,
  parseImport,
  mergeItems,
  backupFilename,
  ImportError,
  FORMAT,
} from '../src/assets/js/backup-format.js';
import { normaliseItem } from '../src/assets/js/model.js';

const sample = () => [
  normaliseItem({
    id: 'a1',
    name: 'Pop! Batman Beyond',
    number: '93125',
    license: 'DC Comics',
    series: 'Pop! Heroes',
    status: 'have',
    quantity: 2,
    condition: 'boxed',
    exclusive: 'Target',
    chase: true,
    barcode: '889698931250',
    paid: 12.5,
    notes: 'Corner ding on the box.',
    addedAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-02-03T04:05:06.000Z',
  }),
  normaliseItem({
    id: 'b2',
    name: 'Pop! Rhysand',
    status: 'want',
    category: 'funko-pop',
    addedAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  }),
];

test('export then import round-trips every field exactly', () => {
  const items = sample();
  const settings = { defaultCategory: 'funko-pop' };

  const text = serialise(items, settings);
  const restored = parseImport(text);

  assert.equal(restored.skipped.length, 0);
  assert.equal(restored.items.length, items.length);
  assert.deepEqual(restored.settings, settings);

  const byId = new Map(restored.items.map((i) => [i.id, i]));
  for (const original of items) {
    assert.deepEqual(byId.get(original.id), original, `item ${original.id} survived unchanged`);
  }
});

test('round-tripping twice is stable', () => {
  const once = parseImport(serialise(sample(), {}));
  const twice = parseImport(serialise(once.items, {}));
  assert.deepEqual(twice.items, once.items);
});

test('export names the format and counts the items', () => {
  const payload = buildExport(sample(), {}, { now: new Date('2026-05-05T00:00:00Z') });
  assert.equal(payload.format, FORMAT);
  assert.equal(payload.formatVersion, 1);
  assert.equal(payload.itemCount, 2);
  assert.equal(payload.exportedAt, '2026-05-05T00:00:00.000Z');
});

test('backup filename is dated and sortable', () => {
  assert.equal(backupFilename(new Date('2026-09-07T10:00:00Z')), 'shelfledger-backup-2026-09-07.json');
});

test('import refuses things that are not backups', () => {
  assert.throws(() => parseImport('not json at all'), ImportError);
  assert.throws(() => parseImport('[]'), ImportError);
  assert.throws(() => parseImport(JSON.stringify({ format: 'someoneelse' })), ImportError);
  assert.throws(
    () => parseImport(JSON.stringify({ format: FORMAT, formatVersion: 99, items: [] })),
    /newer version/,
  );
});

test('import reports unusable records instead of dropping them silently', () => {
  const text = JSON.stringify({
    format: FORMAT,
    formatVersion: 1,
    items: [{ name: 'Good one' }, { name: '' }, { notes: 'no name here' }],
  });
  const result = parseImport(text);
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0].errors[0], /name/i);
});

test('merge keeps the newer copy of an item and adds unseen ones', () => {
  const existing = [
    normaliseItem({ id: 'a', name: 'Old name', updatedAt: '2026-01-01T00:00:00.000Z' }),
    normaliseItem({ id: 'c', name: 'Only local', updatedAt: '2026-01-01T00:00:00.000Z' }),
  ];
  const incoming = [
    normaliseItem({ id: 'a', name: 'New name', updatedAt: '2026-06-01T00:00:00.000Z' }),
    normaliseItem({ id: 'b', name: 'Only in file', updatedAt: '2026-01-01T00:00:00.000Z' }),
  ];

  const result = mergeItems(existing, incoming);
  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 0);
  assert.equal(result.items.length, 3);
  assert.equal(result.items.find((i) => i.id === 'a').name, 'New name');
  assert.ok(result.items.find((i) => i.id === 'c'), 'local-only items are kept');
});

test('merge does not overwrite a newer local item with an older backup', () => {
  const existing = [normaliseItem({ id: 'a', name: 'Local newer', updatedAt: '2026-06-01T00:00:00.000Z' })];
  const incoming = [normaliseItem({ id: 'a', name: 'File older', updatedAt: '2026-01-01T00:00:00.000Z' })];
  const result = mergeItems(existing, incoming);
  assert.equal(result.unchanged, 1);
  assert.equal(result.items[0].name, 'Local newer');
});
