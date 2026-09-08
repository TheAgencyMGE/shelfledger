/**
 * Funko.
 *
 * Each of these category pages renders a schema.org ItemList in the HTML with
 * the product name, item number, price and stock state already structured, so
 * one request per section gets everything. No per-product requests.
 *
 * The limited edition drop page also prints a drop date and a run size on each
 * tile. Those two fields are what collectors plan around, so they are read out
 * of the markup rather than the JSON-LD.
 */

import { extractJsonLd, productsFromItemList, decodeEntities } from '../lib/source.mjs';

export const meta = {
  id: 'funko',
  label: 'Funko',
  manufacturer: 'Funko',
  homepage: 'https://funko.com/',
  retailer: 'Funko Shop',
  category: 'vinyl-figure',
};

const ORIGIN = 'https://funko.com';

const PAGES = [
  { path: '/new-featured/new-releases/', channel: 'new-release' },
  { path: '/new-featured/coming-soon/', channel: 'coming-soon' },
  { path: '/new-featured/pre-order/', channel: 'pre-order' },
  { path: '/new-featured/exclusives/', channel: 'exclusive' },
  { path: '/limited-edition-drops/', channel: 'limited-drop' },
];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function availabilityOf(offer, channel) {
  const raw = String(offer?.availability ?? '').toLowerCase();
  if (channel === 'pre-order') return 'pre-order';
  if (raw.includes('preorder') || raw.includes('presale')) return 'pre-order';
  if (raw.includes('outofstock') || raw.includes('soldout')) return 'out-of-stock';
  if (raw.includes('instock')) return 'in-stock';
  if (channel === 'coming-soon') return 'announced';
  return null;
}

/**
 * The drop tiles print "Sep 08" with no year, and the page shows a rolling
 * window of recent and upcoming drops. So the current year is nearly always
 * right. Only two cases are not: a date far enough ahead that it must be last
 * year's, and a date almost a full year behind, which happens in late December
 * when January dates appear.
 */
export function resolveDropDate(month, day, today = new Date()) {
  const m = MONTHS[String(month).slice(0, 3).toLowerCase()];
  const d = Number(day);
  if (!m || !Number.isInteger(d) || d < 1 || d > 31) return null;

  const year = today.getUTCFullYear();
  const at = (y) => new Date(Date.UTC(y, m - 1, d));
  const dayDiff = (date) => (date.getTime() - today.getTime()) / 86400000;

  let resolved = at(year);
  if (dayDiff(resolved) > 120) resolved = at(year - 1);
  else if (dayDiff(resolved) < -300) resolved = at(year + 1);

  if (resolved.getUTCMonth() !== m - 1) return null; // 31 April and friends
  return resolved.toISOString().slice(0, 10);
}

/**
 * Drop date and run size off the limited edition tiles, keyed by item number.
 * Each tile prints its badge before its product link, so the markup is split on
 * the badge wrapper and read forwards.
 */
export function parseDropBadges(html, today = new Date()) {
  const badges = new Map();
  const chunks = html.split('loyalty-exclusive-stamp-badge').slice(1);

  for (const chunk of chunks) {
    const window = chunk.slice(0, 4000);
    const sku = window.match(/href="[^"]*\/(\d+)\.html"/)?.[1];
    if (!sku) continue;

    const month = window.match(/class="ss-month[^"]*">\s*([A-Za-z]{3,})\s*</)?.[1];
    const day = window.match(/class="ss-day[^"]*">\s*(\d{1,2})\s*</)?.[1];
    const qty = window.match(/class="ss-available-qty[^"]*">\s*([\d,]+)\s*</)?.[1];
    const label = window.match(/class="ss-available-label[^"]*">\s*([A-Za-z]+)\s*</)?.[1];

    const entry = {};
    if (month && day) entry.releaseDate = resolveDropDate(month, day, today);
    // Only a run size when the tile actually says "pieces".
    if (qty && /piece/i.test(label ?? '')) entry.limitedRunSize = Number(qty.replace(/,/g, ''));
    if (Object.keys(entry).length) badges.set(sku, entry);
  }
  return badges;
}

/** Pop!, Bitty Pop!, Vinyl Soda and so on, read off the product name. */
export function lineFromName(name) {
  const n = String(name);
  if (/^Bitty Pop!/i.test(n)) return 'Bitty Pop!';
  if (/^Pocket Pop!/i.test(n)) return 'Pocket Pop!';
  if (/^Vinyl Soda/i.test(n)) return 'Vinyl Soda';
  if (/^Pop!/i.test(n)) return 'Pop!';
  return null;
}

export function toRelease(product, { channel, badges, today }) {
  const sku = String(product.sku ?? product.mpn ?? '').trim();
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const badge = sku ? badges.get(sku) : null;
  const name = decodeEntities(product.name ?? '').trim();
  const price = Number(offer?.price);

  return {
    id: sku ? `funko-${sku}` : null,
    sourceId: meta.id,
    manufacturer: meta.manufacturer,
    line: lineFromName(name),
    category: meta.category,
    sku: sku || null,
    name,
    license: null, // filled from the catalogue by the orchestrator when known
    releaseDate: badge?.releaseDate ?? null,
    preorderDate: null,
    price: Number.isFinite(price) ? price : null,
    currency: offer?.priceCurrency ?? null,
    availability: availabilityOf(offer, channel),
    limitedRunSize: badge?.limitedRunSize ?? null,
    exclusive: channel === 'exclusive' ? 'Funko Shop exclusive' : null,
    isNewRelease: channel === 'new-release',
    isLimitedDrop: channel === 'limited-drop',
    retailer: meta.retailer,
    url: typeof product['@id'] === 'string' ? product['@id'] : (offer?.url ?? null),
  };
}

/** Later pages should not overwrite a date or a run size with nothing. */
function merge(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    releaseDate: incoming.releaseDate ?? existing.releaseDate,
    limitedRunSize: incoming.limitedRunSize ?? existing.limitedRunSize,
    price: incoming.price ?? existing.price,
    exclusive: incoming.exclusive ?? existing.exclusive,
    isNewRelease: existing.isNewRelease || incoming.isNewRelease,
    isLimitedDrop: existing.isLimitedDrop || incoming.isLimitedDrop,
  };
}

export async function collect({ fetchText, allowed, sleep, delay, today, log }) {
  const byId = new Map();
  const visited = [];

  for (const page of PAGES) {
    if (!allowed(page.path)) {
      log(`skip ${page.path}, disallowed by robots.txt`);
      continue;
    }
    const { text, url } = await fetchText(`${ORIGIN}${page.path}`);
    const products = productsFromItemList(extractJsonLd(text));
    const badges = page.channel === 'limited-drop' ? parseDropBadges(text, today) : new Map();

    let added = 0;
    for (const product of products) {
      const release = toRelease(product, { channel: page.channel, badges, today });
      if (!release.id || !release.name) continue;
      byId.set(release.id, byId.has(release.id) ? merge(byId.get(release.id), release) : release);
      added += 1;
    }
    log(`${page.path} ${added} products${badges.size ? `, ${badges.size} dated` : ''}`);
    visited.push(url);
    await sleep(delay);
  }

  return { releases: [...byId.values()], visited };
}
