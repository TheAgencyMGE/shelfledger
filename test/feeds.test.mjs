/**
 * Static feeds. These are a public interface: a broken feed is worse than no
 * feed, because readers keep hitting it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRss, buildJsonFeed, facetFeeds, slug } from '../scripts/feeds.mjs';

const OPTS = {
  title: 'ShelfLedger radar',
  description: 'New announcements, preorders and releases.',
  siteUrl: 'https://example.test/shelfledger/',
  feedUrl: 'https://example.test/shelfledger/feed.xml',
  generatedAt: '2026-09-08T00:00:00.000Z',
};

const release = (over = {}) => ({
  id: 'ee-fu99383',
  name: 'Obsession Nikki Bloody Funko Pop! Vinyl Figure',
  manufacturer: 'Funko',
  line: 'Pop!',
  license: 'Obsession',
  category: 'vinyl-figure',
  sku: 'FU99383',
  announcedDate: '2026-09-08',
  preorderDate: '2026-09-08',
  releaseDate: '2026-11-01',
  releaseWindow: null,
  availability: 'pre-order',
  price: 14.99,
  currency: 'USD',
  limitedRunSize: null,
  firstSeen: '2026-09-08',
  url: 'https://example.test/product/nikki',
  offers: [{ seller: 'Entertainment Earth', price: 14.99, sourceId: 'ee' }],
  ...over,
});

test('the RSS feed is well formed and self-referencing', () => {
  const xml = buildRss([release()], OPTS);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2\.0"/);
  assert.equal((xml.match(/<item>/g) ?? []).length, 1);
  assert.equal((xml.match(/<\/item>/g) ?? []).length, 1);
  assert.match(xml, /<atom:link href="https:\/\/example\.test\/shelfledger\/feed\.xml" rel="self"/);
  assert.match(xml, /<pubDate>.*2026.*<\/pubDate>/);
});

test('feed entries carry the facts a subscriber needs', () => {
  const xml = buildRss([release({ limitedRunSize: 1200 })], OPTS);
  assert.match(xml, /Funko Pop!/);
  assert.match(xml, /Releases 2026-11-01/);
  assert.match(xml, /Limited to 1200 pieces/);
  assert.match(xml, /At Entertainment Earth/);
});

test('XML special characters are escaped, not emitted raw', () => {
  const xml = buildRss([release({ name: 'Batman & Robin <Deluxe> "Set"' })], OPTS);
  assert.match(xml, /Batman &amp; Robin &lt;Deluxe&gt; &quot;Set&quot;/);
  assert.ok(!/<title>Batman & Robin/.test(xml));
});

test('an item with no announcement date still gets a stable timestamp', () => {
  const xml = buildRss([release({ announcedDate: null, firstSeen: '2026-08-01' })], OPTS);
  assert.match(xml, /<pubDate>.*Aug 2026.*<\/pubDate>/);
});

test('the JSON feed follows the JSON Feed spec and keeps the structured fields', () => {
  const feed = JSON.parse(buildJsonFeed([release()], OPTS));
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(feed.items.length, 1);
  const [item] = feed.items;
  assert.equal(item.id, 'shelfledger:ee-fu99383');
  assert.equal(item.url, 'https://example.test/product/nikki');
  assert.deepEqual(item.tags, ['Funko', 'Pop!', 'Obsession']);
  assert.equal(item._shelfledger.announcedDate, '2026-09-08');
  assert.equal(item._shelfledger.offers.length, 1);
});

test('feeds are ordered newest announcement first', () => {
  const feed = JSON.parse(
    buildJsonFeed(
      [
        release({ id: 'old', announcedDate: '2026-08-01' }),
        release({ id: 'new', announcedDate: '2026-09-08' }),
      ],
      OPTS,
    ),
  );
  assert.deepEqual(feed.items.map((i) => i.id), ['shelfledger:new', 'shelfledger:old']);
});

test('facet feeds only exist where there is enough to subscribe to', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    release({ id: `m${i}`, manufacturer: 'Hasbro', line: 'Marvel Legends' }),
  );
  const few = [release({ id: 'one', manufacturer: 'Tiny Co', line: 'Tiny Line' })];
  const feeds = facetFeeds([...many, ...few]);
  const labels = feeds.map((f) => f.label);
  assert.ok(labels.includes('Hasbro'));
  assert.ok(labels.includes('Marvel Legends'));
  assert.ok(!labels.includes('Tiny Co'), 'one release is not a feed');
});

test('a facet feed names the same filter the radar page uses', () => {
  const feeds = facetFeeds(
    Array.from({ length: 9 }, (_, i) => release({ id: `m${i}`, line: 'Marvel Legends' })),
  );
  const line = feeds.find((f) => f.field === 'line');
  assert.equal(line.file, 'line-marvel-legends.xml');
  assert.equal(line.query, '?line=Marvel%20Legends');
});

test('slugs are safe for filenames', () => {
  assert.equal(slug('Star Wars The Black Series'), 'star-wars-the-black-series');
  assert.equal(slug('S.H.Figuarts'), 's-h-figuarts');
  assert.equal(slug('One:12 Collective'), 'one-12-collective');
});
