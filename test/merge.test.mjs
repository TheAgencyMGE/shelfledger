/**
 * Identity, merging, and the rules that decide when something is new.
 *
 * The announcement tests are the ones that matter. The bug they exist to stop
 * is a product from 2025 being presented as just announced because the scraper
 * happened to see it for the first time today.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseText,
  normaliseMaker,
  displayMaker,
  skuDigits,
  titleTokens,
  identityKeys,
  groupListings,
} from '../src/assets/js/identity.mjs';
import {
  announcementFor,
  bestAvailability,
  mergeGroup,
  mergeListings,
  applyHistory,
} from '../scripts/merge.mjs';
import { dropStaleAnnouncements } from '../scripts/scrape-releases.mjs';

const listing = (over = {}) => ({
  id: 'x',
  sourceId: 'test',
  sourceKind: 'retailer',
  retailer: 'Test Shop',
  manufacturer: 'Test Co',
  name: 'Test Figure Alpha',
  sku: null,
  price: null,
  currency: null,
  availability: null,
  listedDate: null,
  listingKind: null,
  releaseDate: null,
  preorderDate: null,
  arrivalDate: null,
  ...over,
});

/* -------------------------------------------------------------- identity */

test('text normalisation strips case, accents and punctuation', () => {
  assert.equal(normaliseText('Pokémon Café!'), 'pokemon cafe');
  assert.equal(normaliseText(''), '');
});

test('manufacturer aliases collapse to one key', () => {
  assert.equal(normaliseMaker('Bandai Tamashii Nations'), 'bandai');
  assert.equal(normaliseMaker('Bandai Spirits'), 'bandai');
  assert.equal(normaliseMaker('McFarlane Toys'), 'mcfarlane');
  assert.equal(normaliseMaker('Mezco Toyz'), normaliseMaker('Mezco'));
});

test('manufacturers get one display name so filters group', () => {
  assert.equal(displayMaker('Bandai Spirits'), 'Bandai Tamashii Nations');
  assert.equal(displayMaker('Mezco'), 'Mezco Toyz');
  assert.equal(displayMaker('Some New Brand'), 'Some New Brand', 'unknown makers keep their name');
});

test('retailer SKUs reduce to the manufacturer item number', () => {
  assert.equal(skuDigits('FU99383'), '99383');
  assert.equal(skuDigits('99383'), '99383');
  assert.equal(skuDigits('MF16805A'), '16805');
  assert.equal(skuDigits('AB12'), '', 'short numbers are not identity');
  assert.equal(skuDigits(null), '');
});

test('title tokens drop packaging and format noise', () => {
  assert.deepEqual(
    titleTokens('Marvel Legends Series Spider-Man 6-Inch Action Figure'),
    ['legends', 'man', 'marvel', 'spider'],
  );
  assert.ok(!titleTokens('Batman 1/6 Scale Figure').includes('scale'));
});

test('a listing with a SKU gets a manufacturer-scoped key', () => {
  const keys = identityKeys(listing({ manufacturer: 'Funko', sku: 'FU99383', name: 'Pop! Nikki Bloody Vinyl' }));
  assert.ok(keys.includes('sku:funko:99383'));
});

/* ---------------------------------------------------------------- groups */

test('a retailer listing merges with the manufacturer listing of the same item', () => {
  const groups = groupListings([
    listing({ id: 'ee-1', sourceId: 'ee', manufacturer: 'Funko', sku: 'FU99383', name: 'Obsession Nikki Bloody Funko Pop! Vinyl Figure' }),
    listing({ id: 'fn-1', sourceId: 'funko', sourceKind: 'manufacturer', manufacturer: 'Funko', sku: '99383', name: 'Pop! Nikki (Bloody)' }),
    listing({ id: 'ee-2', sourceId: 'ee', manufacturer: 'NECA', sku: 'NC55555', name: 'Something Different' }),
  ]);
  const sizes = groups.map((g) => g.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

test('two products from one source never merge, however similar their titles', () => {
  // "-STORE LIMITED EDITION-" appears on many unrelated figures. A key that
  // matches two rows from the same source is a shared phrase, not an identity.
  const groups = groupListings([
    listing({ id: 'a', sourceId: 'tamashii', manufacturer: 'Bandai', name: 'Gundam STORE LIMITED EDITION' }),
    listing({ id: 'b', sourceId: 'tamashii', manufacturer: 'Bandai', name: 'Zeton STORE LIMITED EDITION' }),
  ]);
  assert.equal(groups.length, 2, 'they stay separate');
});

test('a source listing the same product twice does not collapse other matches', () => {
  const groups = groupListings([
    listing({ id: 'm1', sourceId: 'mezco', manufacturer: 'Mezco', name: 'Batman Animated Deluxe Boxed Set' }),
    listing({ id: 'm2', sourceId: 'mezco', manufacturer: 'Mezco', name: 'Batman Animated Deluxe Boxed Set' }),
  ]);
  assert.equal(groups.length, 2);
});

/* ---------------------------------------------------------- announcements */

test('no source date means no announcement date, ever', () => {
  const result = announcementFor([listing({ listedDate: null }), listing({ listedDate: null })]);
  assert.deepEqual(result, { announcedDate: null, announcedBy: null, announcementKind: null });
});

test('the earliest published listing date wins', () => {
  const result = announcementFor([
    listing({ sourceId: 'bbts', listedDate: '2026-09-05', listingKind: 'new-arrival' }),
    listing({ sourceId: 'ee', listedDate: '2026-09-01', listingKind: 'new-preorder' }),
  ]);
  assert.equal(result.announcedDate, '2026-09-01');
  assert.equal(result.announcedBy, 'ee');
  assert.equal(result.announcementKind, 'new-preorder');
});

test('an old product relisted today loses its announcement date', () => {
  const today = new Date('2026-09-08T00:00:00Z');
  const { releases, dropped } = dropStaleAnnouncements(
    [
      { id: 'old', name: 'Old figure', releaseDate: '2025-06-01', announcedDate: '2026-09-08', announcedBy: 'ee' },
      { id: 'new', name: 'New figure', releaseDate: '2026-11-01', announcedDate: '2026-09-08', announcedBy: 'ee' },
    ],
    today,
  );
  assert.equal(dropped, 1);
  assert.equal(releases[0].announcedDate, null, 'a 2025 release is not 2026 news');
  assert.equal(releases[0].staleAnnouncementDropped, true);
  assert.equal(releases[1].announcedDate, '2026-09-08', 'an upcoming release keeps it');
});

/* ----------------------------------------------------------------- merge */

test('availability picks the most useful state across sellers', () => {
  assert.equal(bestAvailability(['out-of-stock', 'in-stock']), 'in-stock');
  assert.equal(bestAvailability(['sold-out', 'pre-order']), 'pre-order');
  assert.equal(bestAvailability([null, null]), null);
});

test('the manufacturer wins for facts, retailers for what is happening now', () => {
  const merged = mergeGroup([
    listing({
      id: 'fn-1',
      sourceId: 'funko',
      sourceKind: 'manufacturer',
      retailer: 'Funko Shop',
      manufacturer: 'Funko',
      name: 'Pop! Nikki (Bloody)',
      sku: '99383',
      releaseDate: '2026-11-01',
      availability: 'pre-order',
      price: 14.99,
      currency: 'USD',
    }),
    listing({
      id: 'ee-1',
      sourceId: 'ee',
      retailer: 'Entertainment Earth',
      manufacturer: 'Funko',
      name: 'Obsession Nikki Bloody Funko Pop! Vinyl Figure',
      sku: 'FU99383',
      availability: 'in-stock',
      price: 12.99,
      currency: 'USD',
      listedDate: '2026-09-08',
      listingKind: 'new-preorder',
    }),
  ]);

  assert.equal(merged.name, 'Pop! Nikki (Bloody)', 'manufacturer names the product');
  assert.equal(merged.releaseDate, '2026-11-01');
  assert.equal(merged.availability, 'in-stock', 'best availability across sellers');
  assert.equal(merged.price, 12.99, 'lowest price across sellers');
  assert.equal(merged.announcedDate, '2026-09-08', 'the retailer supplies the listing date');
  assert.equal(merged.offers.length, 2);
  assert.equal(merged.offers[0].kind, 'manufacturer', 'the maker is listed first');
  assert.deepEqual(merged.sourceIds, ['ee', 'funko']);
});

test('merging a whole list produces one release per product', () => {
  const merged = mergeListings([
    listing({ id: 'ee-1', sourceId: 'ee', manufacturer: 'Funko', sku: 'FU99383', name: 'Nikki Bloody Funko Pop Vinyl' }),
    listing({ id: 'fn-1', sourceId: 'funko', sourceKind: 'manufacturer', manufacturer: 'Funko', sku: '99383', name: 'Pop! Nikki Bloody' }),
    listing({ id: 'ee-9', sourceId: 'ee', manufacturer: 'NECA', sku: 'NC77777', name: 'Unrelated Thing Here' }),
  ]);
  assert.equal(merged.length, 2);
});

/* --------------------------------------------------------------- history */

test('a first run is a baseline, not a pile of restocks', () => {
  const out = applyHistory(
    [{ id: 'a', name: 'x', availability: 'in-stock', sourceIds: ['ee'], offers: [] }],
    new Map(),
    '2026-09-08',
    { bootstrapSources: new Set(['ee']) },
  );
  assert.equal(out[0].baseline, true);
  assert.equal(out[0].restockedAt, null, 'nothing can be a restock with nothing to compare to');
  assert.equal(out[0].firstSeenByShelfLedger, '2026-09-08');
});

test('stock coming back after being sold out is recorded as a restock', () => {
  const previous = new Map([
    ['a', { id: 'a', availability: 'out-of-stock', firstSeen: '2026-08-01', firstSeenByShelfLedger: '2026-08-01' }],
  ]);
  const out = applyHistory(
    [{ id: 'a', name: 'x', availability: 'in-stock', sourceIds: ['ee'], offers: [] }],
    previous,
    '2026-09-08',
  );
  assert.equal(out[0].restockedAt, '2026-09-08');
  assert.equal(out[0].previousAvailability, 'out-of-stock');
  assert.equal(out[0].firstSeen, '2026-08-01', 'first seen is carried forward, not reset');
});

test('first seen is preserved and kept apart from announcement dates', () => {
  const previous = new Map([['a', { id: 'a', availability: 'in-stock', firstSeen: '2026-01-05' }]]);
  const out = applyHistory(
    [{ id: 'a', name: 'x', availability: 'in-stock', announcedDate: null, sourceIds: ['ee'], offers: [] }],
    previous,
    '2026-09-08',
  );
  assert.equal(out[0].firstSeen, '2026-01-05');
  assert.equal(out[0].announcedDate ?? null, null, 'seeing it is not announcing it');
});
