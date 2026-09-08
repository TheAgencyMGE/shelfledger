/**
 * The rules behind the radar tabs. These decide what a collector sees first,
 * so they get tested directly rather than through the page.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stagesFor,
  withStages,
  countByStage,
  filterReleases,
  facets,
  sortReleases,
  sortByFirstSeen,
  newlyDiscovered,
  availabilityLabel,
} from '../src/assets/js/stages.js';

const TODAY = new Date('2026-09-08T00:00:00Z');

const release = (over = {}) => ({
  id: 'x',
  sourceId: 'test',
  manufacturer: 'Test Co',
  line: 'Test Line',
  category: 'action-figure',
  name: 'Test Figure',
  releaseDate: null,
  preorderDate: null,
  price: null,
  currency: null,
  availability: null,
  limitedRunSize: null,
  exclusive: null,
  isNewRelease: false,
  isLimitedDrop: false,
  firstSeen: '2026-01-01',
  ...over,
});

test('everything lands in the all bucket', () => {
  assert.ok(stagesFor(release(), TODAY).includes('all'));
});

test('something first seen in the last two weeks is just announced', () => {
  assert.ok(stagesFor(release({ firstSeen: '2026-09-07' }), TODAY).includes('just-announced'));
  assert.ok(stagesFor(release({ firstSeen: '2026-09-08' }), TODAY).includes('just-announced'));
  assert.ok(!stagesFor(release({ firstSeen: '2026-07-01' }), TODAY).includes('just-announced'));
});

test('a stated preorder is a preorder', () => {
  assert.ok(stagesFor(release({ availability: 'pre-order' }), TODAY).includes('preorder'));
});

test('an opened preorder that has not shipped counts even with no stock state', () => {
  // Tamashii publishes both dates and no availability at all.
  const r = release({ preorderDate: '2026-08-01', releaseDate: '2026-12-01' });
  assert.ok(stagesFor(r, TODAY).includes('preorder'));
});

test('a preorder that has not opened yet is not a preorder', () => {
  const r = release({ preorderDate: '2026-10-01', releaseDate: '2027-02-01' });
  assert.ok(!stagesFor(r, TODAY).includes('preorder'));
});

test('releasing soon reaches ninety days ahead and no further', () => {
  assert.ok(stagesFor(release({ releaseDate: '2026-09-20' }), TODAY).includes('soon'));
  assert.ok(stagesFor(release({ releaseDate: '2026-12-05' }), TODAY).includes('soon'));
  assert.ok(!stagesFor(release({ releaseDate: '2027-06-01' }), TODAY).includes('soon'));
  assert.ok(!stagesFor(release({ releaseDate: '2026-08-01' }), TODAY).includes('soon'), 'past is not soon');
});

test('in stock is available now', () => {
  assert.ok(stagesFor(release({ availability: 'in-stock' }), TODAY).includes('available'));
  assert.ok(!stagesFor(release({ availability: 'waitlist' }), TODAY).includes('available'));
});

test('new releases covers flagged rows and anything out in the last month', () => {
  assert.ok(stagesFor(release({ isNewRelease: true }), TODAY).includes('new'));
  assert.ok(stagesFor(release({ releaseDate: '2026-08-20' }), TODAY).includes('new'));
  assert.ok(!stagesFor(release({ releaseDate: '2026-05-01' }), TODAY).includes('new'));
});

test('exclusives covers retailer exclusives and limited runs', () => {
  assert.ok(stagesFor(release({ exclusive: 'Target' }), TODAY).includes('exclusive'));
  assert.ok(stagesFor(release({ limitedRunSize: 1200 }), TODAY).includes('exclusive'));
  assert.ok(stagesFor(release({ isLimitedDrop: true }), TODAY).includes('exclusive'));
  assert.ok(!stagesFor(release(), TODAY).includes('exclusive'));
});

test('a release can sit in several buckets at once', () => {
  const stages = stagesFor(
    release({ availability: 'pre-order', releaseDate: '2026-09-30', limitedRunSize: 750 }),
    TODAY,
  );
  for (const expected of ['preorder', 'soon', 'exclusive']) assert.ok(stages.includes(expected));
});

test('counts add up per bucket', () => {
  const list = withStages(
    [
      release({ id: 'a', availability: 'pre-order' }),
      release({ id: 'b', availability: 'in-stock' }),
      release({ id: 'c', limitedRunSize: 500 }),
    ],
    TODAY,
  );
  const counts = countByStage(list);
  assert.equal(counts.all, 3);
  assert.equal(counts.preorder, 1);
  assert.equal(counts.available, 1);
  assert.equal(counts.exclusive, 1);
});

/* --------------------------------------------------------------- filters */

const feed = () =>
  withStages(
    [
      release({ id: 'f1', manufacturer: 'Funko', line: 'Pop!', category: 'vinyl-figure', name: 'Pop! Batman' }),
      release({ id: 'm1', manufacturer: 'Mezco', line: 'One:12 Collective', name: 'Punisher' }),
      release({
        id: 't1',
        manufacturer: 'Bandai Spirits',
        line: 'S.H.Figuarts',
        category: 'anime-figure',
        name: 'Son Goku',
        availability: 'in-stock',
      }),
    ],
    TODAY,
  );

test('filters narrow by manufacturer, line and category', () => {
  assert.equal(filterReleases(feed(), { manufacturer: 'Mezco' }).length, 1);
  assert.equal(filterReleases(feed(), { line: 'S.H.Figuarts' }).length, 1);
  assert.equal(filterReleases(feed(), { category: 'vinyl-figure' }).length, 1);
  assert.equal(filterReleases(feed(), {}).length, 3);
});

test('search matches across name, line and manufacturer', () => {
  assert.equal(filterReleases(feed(), { text: 'batman' }).length, 1);
  assert.equal(filterReleases(feed(), { text: 'figuarts' }).length, 1);
  assert.equal(filterReleases(feed(), { text: 'mezco punisher' }).length, 1);
  assert.equal(filterReleases(feed(), { text: 'mezco batman' }).length, 0, 'every word has to land');
});

test('filters combine, and the stage filter applies too', () => {
  assert.equal(filterReleases(feed(), { stage: 'available' }).length, 1);
  assert.equal(filterReleases(feed(), { stage: 'available', manufacturer: 'Funko' }).length, 0);
});

test('wishlist only keeps matched rows', () => {
  const list = feed();
  list[0].match = { itemId: 'w1', itemName: 'Batman', score: 1, reason: 'name' };
  assert.equal(filterReleases(list, { wishlistOnly: true }).length, 1);
});

test('facets list every distinct value once, sorted', () => {
  const { manufacturers, lines, categories } = facets(feed());
  assert.deepEqual(manufacturers, ['Bandai Spirits', 'Funko', 'Mezco']);
  assert.equal(lines.length, 3);
  assert.deepEqual(categories, ['action-figure', 'anime-figure', 'vinyl-figure']);
});

/* ---------------------------------------------------------------- order */

test('upcoming leads, then undated, then what already shipped', () => {
  const sorted = sortReleases(
    [
      release({ id: 'past', name: 'past', releaseDate: '2025-06-01' }),
      release({ id: 'undated', name: 'undated' }),
      release({ id: 'far', name: 'far', releaseDate: '2027-01-01' }),
      release({ id: 'soon', name: 'soon', releaseDate: '2026-09-20' }),
    ],
    TODAY,
  );
  assert.deepEqual(sorted.map((r) => r.id), ['soon', 'far', 'undated', 'past']);
});

test('shipped items are ordered most recent first', () => {
  const sorted = sortReleases(
    [
      release({ id: 'older', releaseDate: '2024-01-01' }),
      release({ id: 'newer', releaseDate: '2026-08-01' }),
    ],
    TODAY,
  );
  assert.deepEqual(sorted.map((r) => r.id), ['newer', 'older']);
});

test('the just announced view orders by discovery, newest first', () => {
  const sorted = sortByFirstSeen([
    release({ id: 'old', firstSeen: '2026-01-01' }),
    release({ id: 'new', firstSeen: '2026-09-08' }),
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ['new', 'old']);
});

/* ------------------------------------------------------- new discoveries */

test('nothing is badged when the whole feed shares one discovery date', () => {
  // The first run, and the day a source is added. Badging everything says
  // nothing, so the marker is withheld.
  const all = [1, 2, 3, 4].map((n) => release({ id: `r${n}`, firstSeen: '2026-09-08' }));
  assert.equal(newlyDiscovered(all).size, 0);
});

test('nothing is badged when a bulk import dominates the feed', () => {
  const list = [
    ...[1, 2, 3].map((n) => release({ id: `new${n}`, firstSeen: '2026-09-08' })),
    ...[1, 2].map((n) => release({ id: `old${n}`, firstSeen: '2026-01-01' })),
  ];
  assert.equal(newlyDiscovered(list).size, 0, '3 of 5 is not news');
});

test('a small handful of fresh finds does get badged', () => {
  const list = [
    release({ id: 'fresh', firstSeen: '2026-09-08' }),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => release({ id: `old${n}`, firstSeen: '2026-01-01' })),
  ];
  const flagged = newlyDiscovered(list);
  assert.equal(flagged.size, 1);
  assert.ok(flagged.has('fresh'));
});

test('availability labels cover the vocabulary the sources produce', () => {
  assert.equal(availabilityLabel('pre-order'), 'Preorder');
  assert.equal(availabilityLabel('waitlist'), 'Waitlist');
  assert.equal(availabilityLabel('in-stock'), 'In stock');
  assert.equal(availabilityLabel('out-of-stock'), 'Sold out');
  assert.equal(availabilityLabel('nonsense'), null);
});
