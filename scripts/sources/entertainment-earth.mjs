/**
 * Entertainment Earth.
 *
 * The most useful source in the project, for one reason: its tiles carry a
 * ribbon with the date the product was actually listed, and what kind of
 * listing it was ("New Pre-Orders", "Hot Off The Truck"). That is a real
 * announcement date from the retailer, which is what lets the radar say
 * something is new without guessing from when the scraper happened to notice.
 *
 * A tile with no ribbon is an ordinary catalogue entry. It gets no announcement
 * date and can never appear under Just Announced. That is deliberate.
 *
 * Each tile also carries manufacturer, licence, category, SKU and price as data
 * attributes, and the page publishes a schema.org ItemList for availability.
 * Listing pages only, one request each.
 */

import { extractJsonLd, decodeEntities } from '../lib/source.mjs';

export const meta = {
  id: 'entertainment-earth',
  label: 'Entertainment Earth',
  kind: 'retailer',
  manufacturer: null, // varies per product
  homepage: 'https://www.entertainmentearth.com/',
  retailer: 'Entertainment Earth',
};

const ORIGIN = 'https://www.entertainmentearth.com';

/**
 * Listing pages, chosen for breadth across manufacturers. Newly added comes
 * first because it is where announcement ribbons are densest.
 */
const PAGES = [
  '/newly-added',
  '/s/action-figures/p',
  '/s/statues/p',
  '/s/hasbro/action-figures/cp',
  '/s/neca/action-figures/cp',
  '/s/mcfarlane-toys/action-figures/cp',
  '/s/bandai-tamashii-nations/action-figures/cp',
  '/s/mattel/action-figures/cp',
  '/s/super7/action-figures/cp',
  '/s/mezco-toyz/action-figures/cp',
  '/s/jada-toys/action-figures/cp',
  '/s/funko/vinyl-figures/cp',
];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const CATEGORY_MAP = [
  [/vinyl/i, 'vinyl-figure'],
  [/statue|bust|diorama/i, 'statue'],
  [/action figure|figures/i, 'action-figure'],
  [/model kit|construction/i, 'model-kit'],
  [/plush/i, 'plush'],
];

export function categoryFor(collect, name = '') {
  const text = `${collect ?? ''} ${name}`;
  for (const [pattern, id] of CATEGORY_MAP) if (pattern.test(text)) return id;
  return 'other';
}

/**
 * Ribbon dates are printed as "Sep 08" with no year. A listing date is in the
 * past or, at the very edge, today. So the current year is right unless that
 * would put it in the future, in which case it belongs to last year.
 */
export function resolveListingDate(raw, today = new Date()) {
  const match = String(raw ?? '').trim().match(/^([A-Za-z]{3,})\s+(\d{1,2})$/);
  if (!match) return null;
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  const day = Number(match[2]);
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) return null;

  const at = (y) => new Date(Date.UTC(y, month - 1, day));
  let resolved = at(today.getUTCFullYear());
  // A couple of days of slack for timezone differences at the boundary.
  if ((resolved.getTime() - today.getTime()) / 86400000 > 2) {
    resolved = at(today.getUTCFullYear() - 1);
  }
  if (resolved.getUTCMonth() !== month - 1) return null;
  return resolved.toISOString().slice(0, 10);
}

/** What a ribbon means. Anything unrecognised is recorded but not trusted. */
export function classifyRibbon(text) {
  const value = String(text ?? '').toLowerCase().trim();
  if (!value) return null;
  if (value.includes('pre-order') || value.includes('preorder')) return 'new-preorder';
  if (value.includes('hot off the truck') || value.includes('new arrival')) return 'new-arrival';
  if (value.includes('back in stock') || value.includes('restock')) return 'restock';
  return 'other';
}

function availabilityFrom(raw) {
  const value = String(raw ?? '').toLowerCase();
  if (value.includes('preorder') || value.includes('presale')) return 'pre-order';
  if (value.includes('outofstock')) return 'out-of-stock';
  if (value.includes('soldout') || value.includes('discontinued')) return 'sold-out';
  if (value.includes('backorder')) return 'backorder';
  if (value.includes('instock')) return 'in-stock';
  return null;
}

/** Availability and canonical price, keyed by SKU, from the page's ItemList. */
export function offersBySku(html) {
  const bySku = new Map();
  for (const block of extractJsonLd(html)) {
    const list = block?.mainEntity?.['@type'] === 'ItemList' ? block.mainEntity : block;
    if (list?.['@type'] !== 'ItemList') continue;
    for (const entry of list.itemListElement ?? []) {
      const item = entry?.item ?? entry;
      if (item?.['@type'] !== 'Product') continue;
      const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      const sku = String(offer?.sku ?? '').trim().toUpperCase();
      if (!sku) continue;
      bySku.set(sku, {
        price: Number.isFinite(Number(offer?.price)) ? Number(offer.price) : null,
        currency: offer?.priceCurrency ?? null,
        availability: availabilityFrom(offer?.availability),
      });
    }
  }
  return bySku;
}

function attr(tile, name) {
  const match = tile.match(new RegExp(`${name}=['"]([^'"]*)['"]`));
  return match ? decodeEntities(match[1]).trim() : '';
}

export function parseListing(html, { today = new Date() } = {}) {
  const offers = offersBySku(html);
  const listings = [];
  const chunks = String(html).split('product-tile"').slice(1);

  for (const chunk of chunks) {
    const tile = chunk.slice(0, 9000);
    const sku = attr(tile, 'data-sku').toUpperCase();
    const name = attr(tile, 'data-name');
    if (!sku || !name) continue;

    const href = tile.match(/class=['"]product-url product-link['"] href=['"]([^'"]+)['"]/)?.[1];
    const ribbonText = tile.match(/class=['"][^'"]*ribbon-text['"]>([^<]*)</)?.[1];
    const ribbonDate = tile.match(/class=['"][^'"]*ribbon-date['"]>([^<]*)</)?.[1];
    const kind = classifyRibbon(ribbonText);
    const listedDate = kind ? resolveListingDate(ribbonDate, today) : null;

    const offer = offers.get(sku) ?? {};
    const priceAttr = Number(attr(tile, 'data-price'));
    const collect = attr(tile, 'data-collect');
    const theme = attr(tile, 'data-theme');

    listings.push({
      id: `ee-${sku.toLowerCase()}`,
      sourceId: meta.id,
      sourceKind: 'retailer',
      retailer: meta.retailer,
      manufacturer: attr(tile, 'data-company') || null,
      line: null, // EE does not publish the figure line; inferred later
      license: theme || null,
      category: categoryFor(collect, name),
      sku,
      name: decodeEntities(name),
      price: offer.price ?? (Number.isFinite(priceAttr) ? priceAttr : null),
      currency: offer.currency ?? (Number.isFinite(priceAttr) ? 'USD' : null),
      availability: offer.availability ?? null,
      // Only a ribbon gives a real listing date. No ribbon, no claim.
      listedDate,
      listingKind: kind,
      releaseDate: null,
      releaseWindow: null,
      preorderDate: kind === 'new-preorder' ? listedDate : null,
      arrivalDate: kind === 'new-arrival' || kind === 'restock' ? listedDate : null,
      limitedRunSize: null,
      exclusive: /entertainment earth exclusive/i.test(tile) ? 'Entertainment Earth' : null,
      url: href ? (href.startsWith('http') ? href : `${ORIGIN}${href}`) : null,
    });
  }
  return listings;
}

export async function collect({ fetchText, allowed, sleep, delay, today, log }) {
  const byId = new Map();
  const visited = [];
  let ribboned = 0;

  for (const path of PAGES) {
    if (!allowed(path)) {
      log(`skip ${path}, disallowed by robots.txt`);
      continue;
    }
    const { text: html, url } = await fetchText(`${ORIGIN}${path}`);
    const found = parseListing(html, { today });
    for (const listing of found) {
      // Earlier pages win, and newly-added is first, so a ribbon is kept.
      if (!byId.has(listing.id)) byId.set(listing.id, listing);
    }
    ribboned += found.filter((l) => l.listedDate).length;
    log(`${path} ${found.length} listings`);
    visited.push(url);
    await sleep(delay);
  }

  log(`${byId.size} unique, ${ribboned} with a listing date`);
  return { releases: [...byId.values()], visited };
}
