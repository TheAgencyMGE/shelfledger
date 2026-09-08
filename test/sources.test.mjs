/**
 * Adapter parsing tests, run against fixed strings copied from the real pages.
 * CI must never depend on someone else's site being up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, UNSUPPORTED, unsupportedForOutput } from '../scripts/sources/index.mjs';
import * as funko from '../scripts/sources/funko.mjs';
import * as mezco from '../scripts/sources/mezco.mjs';
import * as tamashii from '../scripts/sources/tamashii.mjs';

const SEP_2026 = new Date('2026-09-08T00:00:00Z');

/* ------------------------------------------------------------- registry */

test('every source exposes the shape the orchestrator expects', () => {
  assert.ok(SOURCES.length >= 3);
  for (const source of SOURCES) {
    const { meta } = source;
    for (const key of ['id', 'label', 'manufacturer', 'homepage', 'category']) {
      assert.ok(meta[key], `${meta.id ?? 'source'} is missing meta.${key}`);
    }
    assert.equal(typeof source.collect, 'function', `${meta.id} has no collect()`);
    assert.doesNotThrow(() => new URL(meta.homepage), `${meta.id} homepage is not a URL`);
  }
});

test('source ids are unique', () => {
  const ids = SOURCES.map((s) => s.meta.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('unsupported manufacturers each carry a concrete reason', () => {
  assert.ok(UNSUPPORTED.length > 0);
  for (const entry of UNSUPPORTED) {
    assert.ok(entry.id && entry.label, 'needs an id and a label');
    assert.ok(entry.reason && entry.reason.length > 30, `${entry.id} needs a real reason`);
    assert.ok(Array.isArray(entry.lines) && entry.lines.length, `${entry.id} should name its lines`);
  }
  // Nothing may be listed as both working and unsupported.
  const working = new Set(SOURCES.map((s) => s.meta.id));
  for (const entry of UNSUPPORTED) assert.ok(!working.has(entry.id), `${entry.id} is in both lists`);
});

test('the unsupported list is safe to publish', () => {
  for (const entry of unsupportedForOutput()) {
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'label', 'lines', 'reason']);
  }
});

/* ---------------------------------------------------------------- funko */

test('funko reads its line off the product name', () => {
  assert.equal(funko.lineFromName('Pop! Batman Beyond'), 'Pop!');
  assert.equal(funko.lineFromName('Bitty Pop! Marvel 4-Pack'), 'Bitty Pop!');
  assert.equal(funko.lineFromName('Vinyl Soda Batman'), 'Vinyl Soda');
  assert.equal(funko.lineFromName('Something Else'), null);
});

test('a drop months behind stays in the past rather than jumping a year ahead', () => {
  assert.equal(funko.resolveDropDate('Apr', '10', SEP_2026), '2026-04-10');
  assert.equal(funko.resolveDropDate('Sep', '08', SEP_2026), '2026-09-08');
});

test('january dates seen in late december roll into the new year', () => {
  assert.equal(funko.resolveDropDate('Jan', '05', new Date('2026-12-28T00:00:00Z')), '2027-01-05');
});

test('nonsense dates are rejected rather than guessed at', () => {
  assert.equal(funko.resolveDropDate('Xxx', '10', SEP_2026), null);
  assert.equal(funko.resolveDropDate('Apr', '31', SEP_2026), null);
});

const FUNKO_TILE = `
<div class="loyalty-exclusive-stamp-badge">
  <div class="loyalty-exclusive-start-date d-none">
    <div class="ss-month text-uppercase">Sep</div>
    <div class="ss-day font-weight-bold">08</div>
  </div>
  <div class="ss-available-qty font-weight-bold">1,200</div>
  <div class="ss-available-label text-uppercase"> Pieces </div>
</div>
<a href="https://funko.com/pop-grid-xenomorph-glow/93416.html">img</a>
`;

test('funko drop badges bind date and run size to the item number', () => {
  const badges = funko.parseDropBadges(FUNKO_TILE, SEP_2026);
  assert.deepEqual(badges.get('93416'), { releaseDate: '2026-09-08', limitedRunSize: 1200 });
});

test('a badge counting something other than pieces is not a run size', () => {
  const badges = funko.parseDropBadges(FUNKO_TILE.replace('Pieces', 'Days'), SEP_2026);
  assert.equal(badges.get('93416').limitedRunSize, undefined);
});

test('funko products become releases with the shared field set', () => {
  const product = {
    '@type': 'Product',
    '@id': 'https://funko.com/pop-batman/93125.html',
    name: 'Pop! Batman Beyond',
    sku: '93125',
    offers: { price: 14.99, priceCurrency: 'USD', availability: 'http://schema.org/InStock' },
  };
  const r = funko.toRelease(product, { channel: 'new-release', badges: new Map(), today: SEP_2026 });
  assert.equal(r.id, 'funko-93125');
  assert.equal(r.manufacturer, 'Funko');
  assert.equal(r.line, 'Pop!');
  assert.equal(r.category, 'vinyl-figure');
  assert.equal(r.price, 14.99);
  assert.equal(r.availability, 'in-stock');
  assert.equal(r.isNewRelease, true);
});

/* ---------------------------------------------------------------- mezco */

const MEZCO_TILE = `
<div class="thumb-wrap"><div class="thumb">
  <div class="default-badge new-arrival-badge"></div>
  <a class="thumb-img" href="https://www.mezcotoyz.com/peacemaker"><img src="x.jpg" /></a>
  <div class="thumb-content"><div class="thumb-name">
    <a href="https://www.mezcotoyz.com/peacemaker">
      <span class="brand">One:12 Collective</span>
      <span class="model">Peacemaker</span>
    </a></div>
    <div class="thumb-description"><div class="prices-wrap">
      <span class="thumb-price"><span id="store_price">$116.00</span></span></div>
      <div class="shipping-dates">Ships Feb - Apr 2027</div>
      <div class="item-availability pre-order"> Pre-Order </div>
    </div>
  </div>
</div></div>
`;

test('mezco tiles give a line, a name, a price, a window and a stock state', () => {
  const [r] = mezco.parseListing(MEZCO_TILE);
  assert.equal(r.id, 'mezco-peacemaker');
  assert.equal(r.manufacturer, 'Mezco');
  assert.equal(r.line, 'One:12 Collective');
  assert.equal(r.name, 'Peacemaker');
  assert.equal(r.price, 116);
  assert.equal(r.currency, 'USD');
  assert.equal(r.availability, 'pre-order');
  assert.equal(r.releaseWindow, 'Feb - Apr 2027');
  assert.equal(r.releaseDate, '2027-02-01', 'the window start is the planning date');
  assert.equal(r.isNewRelease, true, 'the new arrival badge was read');
});

test('mezco waitlists are their own state, not silently dropped', () => {
  const [r] = mezco.parseListing(MEZCO_TILE.replace('Pre-Order', 'Join Waitlist'));
  assert.equal(r.availability, 'waitlist');
});

test('mezco shipping windows parse in both the range and single month forms', () => {
  assert.deepEqual(mezco.parseShipWindow('Ships Sept 2026'), {
    releaseDate: '2026-09-01',
    window: 'Sept 2026',
  });
  assert.deepEqual(mezco.parseShipWindow('Ships May - July 2026'), {
    releaseDate: '2026-05-01',
    window: 'May - July 2026',
  });
  assert.deepEqual(mezco.parseShipWindow(''), { releaseDate: null, window: null });
});

test('mezco markup with no tiles yields nothing rather than throwing', () => {
  assert.deepEqual(mezco.parseListing('<html></html>'), []);
  assert.deepEqual(mezco.parseListing(''), []);
});

/* ------------------------------------------------------------- tamashii */

const TAMASHII_TILE = `
<li class="productList__item swiper-slide"><div><a href="/item/13830/">
  <ul class="_icon-resale"><li>再販</li></ul>
  <div class="productList__txtBox">
    <p class="productList__brand">S.H.Figuarts</p>
    <p class="productList__name">ピッコロ SUPER HERO</p>
  </div>
  <div class="productList__meta">
    <p class="productList__category _colorBlue">一般店頭販売商品</p>
    <p class="productList__date">
      <time datetime="2026-01-08">2026年1月8日</time>予約開始<br>
      <time datetime="2026-07-25">2026年7月25日</time>発売
    </p>
  </div>
</a></div></li>
`;

test('tamashii tiles give a line, a name and both dates', () => {
  const [r] = tamashii.parseListing(TAMASHII_TILE);
  assert.equal(r.id, 'tamashii-13830');
  assert.equal(r.manufacturer, 'Bandai Spirits');
  assert.equal(r.line, 'S.H.Figuarts');
  assert.equal(r.category, 'anime-figure');
  assert.equal(r.preorderDate, '2026-01-08', 'the first date is when preorders open');
  assert.equal(r.releaseDate, '2026-07-25', 'the second is the release');
  assert.equal(r.isReissue, true);
  assert.equal(r.url, 'https://tamashiiweb.com/item/13830/');
});

test('tamashii handles a tile with only one date', () => {
  const single = TAMASHII_TILE.replace(
    /<time datetime="2026-01-08">[\s\S]*?予約開始<br>/,
    '',
  );
  const [r] = tamashii.parseListing(single);
  assert.equal(r.preorderDate, null);
  assert.equal(r.releaseDate, '2026-07-25');
});

test('tamashii date parsing is order sensitive and tolerates none', () => {
  assert.deepEqual(tamashii.parseDates(''), { preorderDate: null, releaseDate: null });
  assert.deepEqual(tamashii.parseDates('<time datetime="2026-03-01">x</time>'), {
    preorderDate: null,
    releaseDate: '2026-03-01',
  });
});

test('tamashii sorts statue lines into their own category', () => {
  const statue = TAMASHII_TILE.replace('S.H.Figuarts', 'Figuarts ZERO');
  const [r] = tamashii.parseListing(statue);
  assert.equal(r.category, 'statue');
});

test('tamashii markup with no tiles yields nothing rather than throwing', () => {
  assert.deepEqual(tamashii.parseListing('<html></html>'), []);
});
