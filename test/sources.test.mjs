/**
 * Adapter parsing, run against fixed markup copied from the real pages.
 * CI must never depend on someone else's site being up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, UNSUPPORTED, unsupportedForOutput } from '../scripts/sources/index.mjs';
import * as funko from '../scripts/sources/funko.mjs';
import * as mezco from '../scripts/sources/mezco.mjs';
import * as tamashii from '../scripts/sources/tamashii.mjs';
import * as ee from '../scripts/sources/entertainment-earth.mjs';
import * as bbts from '../scripts/sources/bigbadtoystore.mjs';

const SEP_2026 = new Date('2026-09-08T00:00:00Z');

/* ------------------------------------------------------------- registry */

test('every source exposes the shape the orchestrator expects', () => {
  assert.ok(SOURCES.length >= 5);
  for (const source of SOURCES) {
    const { meta } = source;
    for (const key of ['id', 'label', 'homepage', 'kind']) {
      assert.ok(meta[key], `${meta.id ?? 'source'} is missing meta.${key}`);
    }
    assert.ok(['retailer', 'manufacturer'].includes(meta.kind), `${meta.id} has an odd kind`);
    assert.equal(typeof source.collect, 'function', `${meta.id} has no collect()`);
    assert.doesNotThrow(() => new URL(meta.homepage), `${meta.id} homepage is not a URL`);
  }
});

test('source ids are unique and retailers run before manufacturers', () => {
  const ids = SOURCES.map((s) => s.meta.id);
  assert.equal(new Set(ids).size, ids.length);
  const firstManufacturer = SOURCES.findIndex((s) => s.meta.kind === 'manufacturer');
  const lastRetailer = SOURCES.map((s) => s.meta.kind).lastIndexOf('retailer');
  assert.ok(lastRetailer < firstManufacturer, 'retailers supply the listing dates, so they go first');
});

test('unsupported entries each carry a concrete reason', () => {
  assert.ok(UNSUPPORTED.length > 0);
  const working = new Set(SOURCES.map((s) => s.meta.id));
  for (const entry of UNSUPPORTED) {
    assert.ok(entry.id && entry.label);
    assert.ok(entry.reason && entry.reason.length > 30, `${entry.id} needs a real reason`);
    assert.ok(Array.isArray(entry.lines) && entry.lines.length);
    assert.ok(!working.has(entry.id), `${entry.id} is in both lists`);
  }
});

test('the published gap list is safe to serve', () => {
  for (const entry of unsupportedForOutput()) {
    assert.deepEqual(Object.keys(entry).sort(), ['coveredVia', 'id', 'label', 'lines', 'reason']);
  }
});

/* --------------------------------------------------- entertainment earth */

const EE_TILE = `
<div class="grid-view item product-tile">
  <div class="clickable-tile">
    <div class="promotion text-center">
      <span class="NewPre-Orders ribbon-text">New Pre-Orders</span>
      <span class="NewPre-Orders ribbon-date">Sep 08</span>
    </div>
    <a class="product-url product-link" href='/product/obsession-nikki/fu99383'><img /></a>
    <button class="btn add-to-cart" data-sku='FU99383' data-collect='Vinyl Figures'
      data-company='Funko' data-theme='Obsession' data-price="14.99"
      data-name="Obsession Nikki Bloody Funko Pop! Vinyl Figure"></button>
  </div>
</div>
`;

const EE_LD = `<script type="application/ld+json">{"@type":"CollectionPage","mainEntity":{"@type":"ItemList","itemListElement":[{"item":{"@type":"Product","name":"Obsession Nikki","offers":[{"@type":"Offer","sku":"FU99383","price":14.99,"priceCurrency":"USD","availability":"https://schema.org/InStock"}]}}]}}</script>`;

test('an EE tile yields maker, licence, category, sku, price and a listing date', () => {
  const [r] = ee.parseListing(EE_LD + EE_TILE, { today: SEP_2026 });
  assert.equal(r.id, 'ee-fu99383');
  assert.equal(r.sourceKind, 'retailer');
  assert.equal(r.manufacturer, 'Funko');
  assert.equal(r.license, 'Obsession');
  assert.equal(r.category, 'vinyl-figure');
  assert.equal(r.sku, 'FU99383');
  assert.equal(r.price, 14.99);
  assert.equal(r.availability, 'in-stock', 'availability comes from the ItemList');
  assert.equal(r.listedDate, '2026-09-08');
  assert.equal(r.listingKind, 'new-preorder');
  assert.equal(r.preorderDate, '2026-09-08');
});

test('an EE tile with no ribbon gets no listing date at all', () => {
  // This is what stops ordinary catalogue rows becoming announcements.
  const plain = EE_TILE.replace(/<div class="promotion[\s\S]*?<\/div>/, '');
  const [r] = ee.parseListing(plain, { today: SEP_2026 });
  assert.equal(r.listedDate, null);
  assert.equal(r.listingKind, null);
  assert.equal(r.preorderDate, null);
  assert.equal(r.arrivalDate, null);
});

test('a hot off the truck ribbon is an arrival, not a preorder', () => {
  const arrival = EE_TILE.replace('New Pre-Orders</span>', 'Hot Off The Truck</span>');
  const [r] = ee.parseListing(arrival, { today: SEP_2026 });
  assert.equal(r.listingKind, 'new-arrival');
  assert.equal(r.arrivalDate, '2026-09-08');
  assert.equal(r.preorderDate, null);
});

test('EE ribbon classification covers what the site prints', () => {
  assert.equal(ee.classifyRibbon('New Pre-Orders'), 'new-preorder');
  assert.equal(ee.classifyRibbon('Hot Off The Truck'), 'new-arrival');
  assert.equal(ee.classifyRibbon('Back In Stock'), 'restock');
  assert.equal(ee.classifyRibbon(''), null);
  assert.equal(ee.classifyRibbon('Something Else'), 'other');
});

test('a ribbon date never resolves into the future', () => {
  assert.equal(ee.resolveListingDate('Sep 08', SEP_2026), '2026-09-08');
  // December seen in September must be last year: listings are not posted ahead.
  assert.equal(ee.resolveListingDate('Dec 20', SEP_2026), '2025-12-20');
  assert.equal(ee.resolveListingDate('nonsense', SEP_2026), null);
  assert.equal(ee.resolveListingDate('', SEP_2026), null);
});

test('EE categories follow the collection the site assigns', () => {
  assert.equal(ee.categoryFor('Action Figures', 'x'), 'action-figure');
  assert.equal(ee.categoryFor('Statues', 'x'), 'statue');
  assert.equal(ee.categoryFor('', 'Something Plush'), 'plush');
});

/* ---------------------------------------------------------------- bbts */

const BBTS_TILE = `
<li class="search-results-item preorder-search-result">
  <div class="product-card">
    <div class="product-card-text">
      <h3 class="product-card-title"><a href="/product/ultraman-zero-figure-197122?variation=388346">Ultraman Zero Action Figure</a></h3>
      <div class="product-company">By: Cosmic Creations</div>
    </div>
    <div class="product-card-pricing">
      <div class="product-card-tag tag-preorder">PRE-ORDER</div>
      <div class="product-card-price"> $709.99 </div>
    </div>
  </div>
</li>
`;

test('a BBTS tile yields a name, maker, price and preorder state', () => {
  const [r] = bbts.parseListing(BBTS_TILE);
  assert.equal(r.id, 'bbts-197122');
  assert.equal(r.sourceKind, 'retailer');
  assert.equal(r.manufacturer, 'Cosmic Creations');
  assert.equal(r.name, 'Ultraman Zero Action Figure');
  assert.equal(r.price, 709.99);
  assert.equal(r.availability, 'pre-order');
  assert.match(r.url, /^https:\/\/www\.bigbadtoystore\.com\/product\//);
});

test('BBTS publishes no listing dates, so it claims none', () => {
  const [r] = bbts.parseListing(BBTS_TILE);
  assert.equal(r.listedDate, null);
  assert.equal(r.listingKind, null);
});

test('BBTS product ids come off the URL', () => {
  assert.equal(bbts.idFromUrl('/product/thing-197122?variation=1'), '197122');
  assert.equal(bbts.idFromUrl('/product/thing-197122'), '197122');
  assert.equal(bbts.idFromUrl('/product/no-id-here'), null);
});

/* ---------------------------------------------------------------- funko */

test('funko reads its line off the product name', () => {
  assert.equal(funko.lineFromName('Pop! Batman Beyond'), 'Pop!');
  assert.equal(funko.lineFromName('Bitty Pop! Marvel 4-Pack'), 'Bitty Pop!');
  assert.equal(funko.lineFromName('Something Else'), null);
});

test('a drop months behind stays in the past rather than jumping a year ahead', () => {
  assert.equal(funko.resolveDropDate('Apr', '10', SEP_2026), '2026-04-10');
  assert.equal(funko.resolveDropDate('Jan', '05', new Date('2026-12-28T00:00:00Z')), '2027-01-05');
  assert.equal(funko.resolveDropDate('Apr', '31', SEP_2026), null);
});

test('funko products become listings with the shared field set', () => {
  const r = funko.toRelease(
    {
      '@type': 'Product',
      '@id': 'https://funko.com/pop-batman/93125.html',
      name: 'Pop! Batman Beyond',
      sku: '93125',
      offers: { price: 14.99, priceCurrency: 'USD', availability: 'http://schema.org/InStock' },
    },
    { channel: 'new-release', badges: new Map(), today: SEP_2026 },
  );
  assert.equal(r.id, 'funko-93125');
  assert.equal(r.sourceKind, 'manufacturer');
  assert.equal(r.listedDate, null, 'a manufacturer page is not a dated listing');
  assert.equal(r.onNewReleasesPage, true);
});

/* ---------------------------------------------------------------- mezco */

const MEZCO_TILE = `
<div class="thumb-wrap"><div class="thumb">
  <div class="default-badge new-arrival-badge"></div>
  <a class="thumb-img" href="https://www.mezcotoyz.com/peacemaker"><img /></a>
  <span class="brand">One:12 Collective</span><span class="model">Peacemaker</span>
  <span id="store_price">$116.00</span>
  <div class="shipping-dates">Ships Feb - Apr 2027</div>
  <div class="item-availability pre-order"> Pre-Order </div>
</div></div>
`;

test('mezco tiles give a line, price, window and stock state', () => {
  const [r] = mezco.parseListing(MEZCO_TILE);
  assert.equal(r.id, 'mezco-peacemaker');
  assert.equal(r.line, 'One:12 Collective');
  assert.equal(r.price, 116);
  assert.equal(r.availability, 'pre-order');
  assert.equal(r.releaseDate, '2027-02-01');
  assert.equal(r.listedDate, null);
});

test('mezco waitlists are their own state', () => {
  const [r] = mezco.parseListing(MEZCO_TILE.replace('Pre-Order', 'Join Waitlist'));
  assert.equal(r.availability, 'waitlist');
});

test('mezco shipping windows parse in range and single month forms', () => {
  assert.deepEqual(mezco.parseShipWindow('Ships Sept 2026'), {
    releaseDate: '2026-09-01',
    window: 'Sept 2026',
  });
  assert.deepEqual(mezco.parseShipWindow(''), { releaseDate: null, window: null });
});

/* ------------------------------------------------------------- tamashii */

const TAMASHII_TILE = `
<li class="productList__item"><a href="/item/13830/">
  <ul class="_icon-resale"><li>x</li></ul>
  <p class="productList__brand">S.H.Figuarts</p>
  <p class="productList__name">Piccolo</p>
  <p class="productList__category _colorBlue">general</p>
  <p class="productList__date">
    <time datetime="2026-01-08">a</time>
    <time datetime="2026-07-25">b</time>
  </p>
</a></li>
`;

test('tamashii tiles give a line and both dates in order', () => {
  const [r] = tamashii.parseListing(TAMASHII_TILE);
  assert.equal(r.id, 'tamashii-13830');
  assert.equal(r.line, 'S.H.Figuarts');
  assert.equal(r.preorderDate, '2026-01-08');
  assert.equal(r.releaseDate, '2026-07-25');
  assert.equal(r.isReissue, true);
  assert.equal(r.listedDate, null);
});

test('tamashii sorts statue lines into their own category', () => {
  const [r] = tamashii.parseListing(TAMASHII_TILE.replace('S.H.Figuarts', 'Figuarts ZERO'));
  assert.equal(r.category, 'statue');
});

test('every adapter survives markup with nothing in it', () => {
  for (const parse of [ee.parseListing, bbts.parseListing, mezco.parseListing, tamashii.parseListing]) {
    assert.deepEqual(parse('<html></html>'), []);
    assert.deepEqual(parse(''), []);
  }
});
