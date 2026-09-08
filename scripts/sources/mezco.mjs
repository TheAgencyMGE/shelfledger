/**
 * Mezco Toyz, One:12 Collective and 5 Points.
 *
 * The category pages are server rendered. Each tile carries the line, the
 * model name, the price, a shipping window and a stock state, plus a badge
 * when the item is a new arrival. That is enough without touching a single
 * product page.
 *
 * Mezco prints a shipping window rather than a release date ("Ships Feb - Apr
 * 2027"). It is stored as a window and the start of it is used as the release
 * date, because a range you can plan around is better than no date at all.
 */

import { decodeEntities } from '../lib/source.mjs';

export const meta = {
  id: 'mezco',
  label: 'Mezco Toyz',
  manufacturer: 'Mezco',
  homepage: 'https://www.mezcotoyz.com/',
  retailer: 'Mezco Toyz',
  kind: 'manufacturer',
  category: 'action-figure',
};

const ORIGIN = 'https://www.mezcotoyz.com';

const PAGES = [
  '/category/one-12-collective/1.html',
  '/category/one-12-collective/2.html',
  '/category/5-points-category/categories/5-points/1.html',
];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function text(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/**
 * "Ships Feb - Apr 2027" and "Ships Nov 2026" both appear. Returns the first
 * month of the window as a date, plus the window text as written.
 */
export function parseShipWindow(raw) {
  if (!raw) return { releaseDate: null, window: null };
  const clean = text(raw).replace(/^ships\s*/i, '');
  const year = clean.match(/(20\d{2})/)?.[1];
  const month = clean.match(/([A-Za-z]{3,})/)?.[1];
  if (!year || !month) return { releaseDate: null, window: clean || null };
  const m = MONTHS[month.slice(0, 3).toLowerCase()];
  if (!m) return { releaseDate: null, window: clean };
  return { releaseDate: `${year}-${String(m).padStart(2, '0')}-01`, window: clean };
}

/**
 * Mezco labels its tiles with what you can do, not with stock levels, so
 * "Join Waitlist" is the common one and it means the run is spoken for. It is
 * kept as its own state rather than folded into out of stock, because a
 * waitlist is still worth acting on and a collector reads them differently.
 */
function availabilityOf(raw) {
  const v = text(raw).toLowerCase();
  if (!v) return null;
  if (v.includes('pre-order') || v.includes('preorder')) return 'pre-order';
  if (v.includes('waitlist') || v.includes('wait list')) return 'waitlist';
  if (v.includes('sold out') || v.includes('out of stock')) return 'out-of-stock';
  if (v.includes('add to cart') || v.includes('in stock') || v.includes('available')) {
    return 'in-stock';
  }
  if (v.includes('coming soon')) return 'announced';
  return null;
}

/** Slug off the product URL, used as a stable id since Mezco shows no SKU. */
function idFromUrl(url) {
  const slug = String(url).replace(/[?#].*$/, '').replace(/\/$/, '').split('/').pop();
  return slug ? `mezco-${slug}` : null;
}

/**
 * Split the listing on the tile wrapper and read each one. Regex rather than a
 * DOM parser because the shape is simple and this avoids a dependency.
 */
export function parseListing(html) {
  const releases = [];
  const chunks = String(html).split('class="thumb-wrap"').slice(1);

  for (const chunk of chunks) {
    const tile = chunk.slice(0, 6000);
    const url = tile.match(/<a class="thumb-img" href="([^"]+)"/)?.[1];
    if (!url) continue;

    const brand = tile.match(/<span class="brand">([\s\S]*?)<\/span>/)?.[1];
    const model = tile.match(/<span class="model">([\s\S]*?)<\/span>/)?.[1];
    const name = text(model ?? '');
    if (!name) continue;

    const priceRaw = tile.match(/id="store_price"[^>]*>\s*\$?([\d,]+\.\d{2})/)?.[1];
    const ship = tile.match(/<div class="shipping-dates">([\s\S]*?)<\/div>/)?.[1];
    const avail = tile.match(/<div class="item-availability[^"]*">([\s\S]*?)<\/div>/)?.[1];
    const { releaseDate, window } = parseShipWindow(ship);
    const line = text(brand ?? '') || null;

    releases.push({
      id: idFromUrl(url),
      sourceId: meta.id,
      sourceKind: 'manufacturer',
      manufacturer: meta.manufacturer,
      line,
      category: meta.category,
      sku: null,
      name,
      license: null,
      releaseDate,
      releaseWindow: window,
      preorderDate: null,
      price: priceRaw ? Number(priceRaw.replace(/,/g, '')) : null,
      currency: priceRaw ? 'USD' : null,
      availability: availabilityOf(avail),
      limitedRunSize: null,
      exclusive: null,
      onNewReleasesPage: /new-arrival-badge/.test(tile),
      listedDate: null,
      listingKind: null,
      arrivalDate: null,
      isLimitedDrop: false,
      retailer: meta.retailer,
      url: url.startsWith('http') ? url : `${ORIGIN}${url}`,
    });
  }
  return releases.filter((r) => r.id);
}

export async function collect({ fetchText, allowed, sleep, delay, log }) {
  const byId = new Map();
  const visited = [];

  for (const path of PAGES) {
    if (!allowed(path)) {
      log(`skip ${path}, disallowed by robots.txt`);
      continue;
    }
    const { text: html, url } = await fetchText(`${ORIGIN}${path}`);
    const found = parseListing(html);
    for (const release of found) if (!byId.has(release.id)) byId.set(release.id, release);
    log(`${path} ${found.length} products`);
    visited.push(url);
    await sleep(delay);
  }

  return { releases: [...byId.values()], visited };
}
