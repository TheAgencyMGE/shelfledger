/**
 * The rules behind the radar tabs, plus filtering and URL state.
 *
 * The first block is the important one: a release only reaches "just announced"
 * on published evidence, never because ShelfLedger noticed it.
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
  sortForStage,
  availabilityLabel,
  EMPTY_FILTER,
} from '../src/assets/js/stages.js';
import {
  filterFromSearch,
  searchFromFilter,
  isDefaultFilter,
  describeFilter,
} from '../src/assets/js/url-state.js';
import { toCsv, csvCell, exportFilename } from '../src/assets/js/exports.js';
import { inferLine, makerForLine } from '../src/assets/js/lines.mjs';

const TODAY = new Date('2026-09-08T00:00:00Z');

const release = (over = {}) => ({
  id: 'x',
  name: 'Test Figure',
  manufacturer: 'Test Co',
  line: null,
  license: null,
  category: 'action-figure',
  sku: null,
  announcedDate: null,
  announcedBy: null,
  announcementKind: null,
  preorderDate: null,
  releaseDate: null,
  releaseWindow: null,
  arrivalDate: null,
  restockedAt: null,
  availability: null,
  price: null,
  currency: null,
  limitedRunSize: null,
  exclusive: null,
  firstSeen: '2026-09-08',
  firstSeenByShelfLedger: '2026-09-08',
  offers: [],
  sourceIds: ['test'],
  ...over,
});

/* ------------------------------------------------ the "new" guarantee */

test('being seen for the first time today does NOT make something just announced', () => {
  // This is the bug the rework exists to fix.
  const r = release({ firstSeen: '2026-09-08', firstSeenByShelfLedger: '2026-09-08', announcedDate: null });
  assert.ok(!stagesFor(r, TODAY).includes('just-announced'));
});

test('a 2025 product scraped today is not new, in any bucket', () => {
  const r = release({
    releaseDate: '2025-06-01',
    firstSeen: '2026-09-08',
    firstSeenByShelfLedger: '2026-09-08',
    announcedDate: null,
  });
  const stages = stagesFor(r, TODAY);
  assert.ok(!stages.includes('just-announced'));
  assert.ok(!stages.includes('new-preorders'));
  assert.ok(!stages.includes('new-arrivals'));
  assert.ok(!stages.includes('soon'));
});

test('a published announcement date within three weeks is just announced', () => {
  assert.ok(stagesFor(release({ announcedDate: '2026-09-01' }), TODAY).includes('just-announced'));
  assert.ok(stagesFor(release({ announcedDate: '2026-09-08' }), TODAY).includes('just-announced'));
});

test('an announcement older than the window is no longer just announced', () => {
  assert.ok(!stagesFor(release({ announcedDate: '2026-07-01' }), TODAY).includes('just-announced'));
});

test('an announcement dated in the future is not treated as news', () => {
  assert.ok(!stagesFor(release({ announcedDate: '2026-10-01' }), TODAY).includes('just-announced'));
});

/* ------------------------------------------------------------- buckets */

test('new preorders needs a preorder listing date', () => {
  assert.ok(
    stagesFor(
      release({ announcedDate: '2026-09-02', announcementKind: 'new-preorder' }),
      TODAY,
    ).includes('new-preorders'),
  );
  assert.ok(stagesFor(release({ preorderDate: '2026-09-02' }), TODAY).includes('new-preorders'));
  assert.ok(!stagesFor(release({ availability: 'pre-order' }), TODAY).includes('new-preorders'));
});

test('releasing soon reaches ninety days ahead and no further', () => {
  assert.ok(stagesFor(release({ releaseDate: '2026-10-01' }), TODAY).includes('soon'));
  assert.ok(!stagesFor(release({ releaseDate: '2027-06-01' }), TODAY).includes('soon'));
  assert.ok(!stagesFor(release({ releaseDate: '2026-08-01' }), TODAY).includes('soon'));
});

test('available now follows stock, new arrivals follow a dated arrival', () => {
  assert.ok(stagesFor(release({ availability: 'in-stock' }), TODAY).includes('available'));
  assert.ok(stagesFor(release({ arrivalDate: '2026-09-05' }), TODAY).includes('new-arrivals'));
  assert.ok(!stagesFor(release({ arrivalDate: '2026-01-05' }), TODAY).includes('new-arrivals'));
});

test('restocks come from a recorded stock change, not from a guess', () => {
  assert.ok(stagesFor(release({ restockedAt: '2026-09-06' }), TODAY).includes('restocks'));
  assert.ok(!stagesFor(release({ restockedAt: '2026-02-06' }), TODAY).includes('restocks'));
  assert.ok(!stagesFor(release({ availability: 'in-stock' }), TODAY).includes('restocks'));
});

test('exclusives covers retailer exclusives and limited runs', () => {
  assert.ok(stagesFor(release({ exclusive: 'Target' }), TODAY).includes('exclusive'));
  assert.ok(stagesFor(release({ limitedRunSize: 1200 }), TODAY).includes('exclusive'));
  assert.ok(!stagesFor(release(), TODAY).includes('exclusive'));
});

test('counts add up per bucket', () => {
  const list = withStages(
    [
      release({ id: 'a', announcedDate: '2026-09-05' }),
      release({ id: 'b', availability: 'in-stock' }),
      release({ id: 'c', limitedRunSize: 500 }),
    ],
    TODAY,
  );
  const counts = countByStage(list);
  assert.equal(counts.all, 3);
  assert.equal(counts['just-announced'], 1);
  assert.equal(counts.available, 1);
  assert.equal(counts.exclusive, 1);
});

/* ------------------------------------------------------------- filters */

const feed = () =>
  withStages(
    [
      release({
        id: 'a',
        manufacturer: 'Hasbro',
        line: 'Marvel Legends',
        license: 'Marvel',
        name: 'Marvel Legends Spider-Man',
        price: 24.99,
        releaseDate: '2026-10-01',
        availability: 'pre-order',
        offers: [{ seller: 'Entertainment Earth', sourceId: 'ee' }],
      }),
      release({
        id: 'b',
        manufacturer: 'Medicom',
        line: 'MAFEX',
        name: 'MAFEX Batman',
        price: 99.99,
        releaseDate: '2027-03-01',
        availability: 'in-stock',
        offers: [{ seller: 'BigBadToyStore', sourceId: 'bbts' }],
      }),
      release({
        id: 'c',
        manufacturer: 'Bandai Tamashii Nations',
        line: 'S.H.Figuarts',
        category: 'anime-figure',
        name: 'S.H.Figuarts Goku',
        price: 54.99,
        offers: [{ seller: 'Entertainment Earth', sourceId: 'ee' }],
      }),
    ],
    TODAY,
  );

test('filters narrow by maker, line, category and seller', () => {
  assert.equal(filterReleases(feed(), { manufacturer: 'Hasbro' }).length, 1);
  assert.equal(filterReleases(feed(), { line: 'MAFEX' }).length, 1);
  assert.equal(filterReleases(feed(), { category: 'anime-figure' }).length, 1);
  assert.equal(filterReleases(feed(), { retailer: 'Entertainment Earth' }).length, 2);
  assert.equal(filterReleases(feed(), {}).length, 3);
});

test('price and date ranges narrow the list', () => {
  assert.equal(filterReleases(feed(), { minPrice: '50' }).length, 2);
  assert.equal(filterReleases(feed(), { maxPrice: '30' }).length, 1);
  assert.equal(filterReleases(feed(), { from: '2027-01-01' }).length, 1);
  assert.equal(filterReleases(feed(), { to: '2026-12-31' }).length, 1);
});

test('search matches across name, line and maker, and every word must land', () => {
  assert.equal(filterReleases(feed(), { text: 'mafex' }).length, 1);
  assert.equal(filterReleases(feed(), { text: 'hasbro legends' }).length, 1);
  assert.equal(filterReleases(feed(), { text: 'hasbro mafex' }).length, 0);
});

test('facets list every distinct value once, including sellers', () => {
  const f = facets(feed());
  assert.deepEqual(f.manufacturers, ['Bandai Tamashii Nations', 'Hasbro', 'Medicom']);
  assert.deepEqual(f.retailers, ['BigBadToyStore', 'Entertainment Earth']);
  assert.ok(f.lines.includes('Marvel Legends'));
});

test('upcoming leads, then undated, then what already shipped', () => {
  const sorted = sortReleases(
    [
      release({ id: 'past', name: 'past', releaseDate: '2025-06-01' }),
      release({ id: 'undated', name: 'undated' }),
      release({ id: 'soon', name: 'soon', releaseDate: '2026-09-20' }),
    ],
    TODAY,
  );
  assert.deepEqual(sorted.map((r) => r.id), ['soon', 'undated', 'past']);
});

test('announcement views order by announcement, newest first', () => {
  const sorted = sortForStage(
    [
      release({ id: 'older', announcedDate: '2026-09-01' }),
      release({ id: 'newer', announcedDate: '2026-09-07' }),
    ],
    'just-announced',
    TODAY,
  );
  assert.deepEqual(sorted.map((r) => r.id), ['newer', 'older']);
});

test('availability labels cover the vocabulary the sources produce', () => {
  assert.equal(availabilityLabel('waitlist'), 'Waitlist');
  assert.equal(availabilityLabel('in-stock'), 'In stock');
  assert.equal(availabilityLabel('nonsense'), null);
});

/* ----------------------------------------------------------- url state */

test('a filter round-trips through the query string', () => {
  const filter = {
    ...EMPTY_FILTER,
    stage: 'new-preorders',
    manufacturer: 'Hasbro',
    line: 'Marvel Legends',
    minPrice: '20',
    text: 'spider man',
  };
  const search = searchFromFilter(filter);
  assert.deepEqual(filterFromSearch(search), filter);
});

test('default values stay out of the URL', () => {
  assert.equal(searchFromFilter({ ...EMPTY_FILTER }), '');
  assert.equal(searchFromFilter({ ...EMPTY_FILTER, stage: 'all' }), '');
  assert.ok(isDefaultFilter({ ...EMPTY_FILTER }));
  assert.ok(!isDefaultFilter({ ...EMPTY_FILTER, line: 'MAFEX' }));
});

test('the shareable view described in the brief is one URL', () => {
  const filter = { ...EMPTY_FILTER, stage: 'new-preorders', line: 'Marvel Legends' };
  const search = searchFromFilter(filter);
  assert.match(search, /stage=new-preorders/);
  assert.match(search, /line=Marvel\+Legends|line=Marvel%20Legends/);
  assert.equal(filterFromSearch(search).line, 'Marvel Legends');
});

test('a filter describes itself for headings and feed titles', () => {
  const text = describeFilter(
    { ...EMPTY_FILTER, stage: 'just-announced', manufacturer: 'Hasbro' },
    { 'just-announced': 'Just announced' },
  );
  assert.equal(text, 'Just announced, Hasbro');
});

/* ------------------------------------------------------------- exports */

test('csv quotes only what needs quoting', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('has, comma'), '"has, comma"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
});

test('csv export has a header and one row per release', () => {
  const csv = toCsv(feed());
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^id,name,manufacturer/);
  assert.match(csv, /Marvel Legends Spider-Man/);
});

test('export filenames describe the view', () => {
  const name = exportFilename('csv', { stage: 'new-preorders', line: 'Marvel Legends' });
  assert.match(name, /^shelfledger-new-preorders-marvel-legends-\d{4}-\d{2}-\d{2}\.csv$/);
});

/* --------------------------------------------------------------- lines */

test('lines are only assigned when the title actually names them', () => {
  assert.equal(inferLine('Marvel Legends Series Spider-Man'), 'Marvel Legends');
  assert.equal(inferLine('Star Wars The Black Series Boba Fett'), 'Star Wars The Black Series');
  assert.equal(inferLine('S.H.Figuarts Son Goku'), 'S.H.Figuarts');
  assert.equal(inferLine('MAFEX Batman Hush'), 'MAFEX');
  assert.equal(inferLine('Some Generic Toy'), null, 'no guessing');
});

test('a line stated by the source beats anything inferred', () => {
  assert.equal(inferLine('Marvel Legends Spider-Man', 'One:12 Collective'), 'One:12 Collective');
});

test('lines know which maker they belong to when it is unambiguous', () => {
  assert.equal(makerForLine('Marvel Legends'), 'Hasbro');
  assert.equal(makerForLine('DC Multiverse'), 'McFarlane');
  assert.equal(makerForLine('S.H.Figuarts'), null, 'shared across Bandai sub-brands');
});
