/**
 * BigBadToyStore.
 *
 * Their robots.txt allows /Search but disallows /Search?* , so this reads the
 * one unparameterised listing and nothing else. That is a deliberate ceiling:
 * the filtered and sorted views are exactly the URLs they asked crawlers not to
 * take, and adding query strings to get more rows would be ignoring that.
 *
 * The result is a small but genuine feed, useful mainly because BBTS carries
 * manufacturers the others do not. It publishes no listing dates, so nothing
 * from here can be called newly announced on its own. It contributes buying
 * options, prices and preorder status to products found elsewhere.
 */

import { decodeEntities } from '../lib/source.mjs';

export const meta = {
  id: 'bigbadtoystore',
  label: 'BigBadToyStore',
  kind: 'retailer',
  manufacturer: null,
  homepage: 'https://www.bigbadtoystore.com/',
  retailer: 'BigBadToyStore',
};

const ORIGIN = 'https://www.bigbadtoystore.com';
const PAGES = ['/Search'];

function text(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function availabilityFrom(tile) {
  if (/tag-preorder/i.test(tile)) return 'pre-order';
  if (/tag-sold-?out|sold out/i.test(tile)) return 'sold-out';
  if (/tag-instock|in stock/i.test(tile)) return 'in-stock';
  return null;
}

/** BBTS product URLs end in the product id, with an optional variation. */
export function idFromUrl(url) {
  const match = String(url ?? '').match(/-(\d+)(?:\?|$)/);
  return match ? match[1] : null;
}

export function categoryFor(name) {
  const value = String(name ?? '');
  if (/statue|bust|diorama/i.test(value)) return 'statue';
  if (/model kit|plastic model/i.test(value)) return 'model-kit';
  if (/plush/i.test(value)) return 'plush';
  return 'action-figure';
}

export function parseListing(html) {
  const listings = [];
  const chunks = String(html).split('class="product-card"').slice(1);

  for (const chunk of chunks) {
    const tile = chunk.slice(0, 4000);
    const link = tile.match(/class="product-card-title"><a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!link) continue;
    const [, href, rawName] = link;
    const name = text(rawName);
    const id = idFromUrl(href);
    if (!name || !id) continue;

    const company = text(tile.match(/class="product-company">([\s\S]*?)<\/div>/)?.[1] ?? '')
      .replace(/^by:\s*/i, '')
      .trim();
    const priceRaw = tile.match(/class="product-card-price">\s*\$?([\d,]+\.\d{2})/)?.[1];

    listings.push({
      id: `bbts-${id}`,
      sourceId: meta.id,
      sourceKind: 'retailer',
      retailer: meta.retailer,
      manufacturer: company || null,
      line: null,
      license: null,
      category: categoryFor(name),
      sku: null, // BBTS does not publish the manufacturer item number here
      name,
      price: priceRaw ? Number(priceRaw.replace(/,/g, '')) : null,
      currency: priceRaw ? 'USD' : null,
      availability: availabilityFrom(tile),
      // No listing date is published, so no announcement date is claimed.
      listedDate: null,
      listingKind: null,
      releaseDate: null,
      releaseWindow: null,
      preorderDate: null,
      arrivalDate: null,
      limitedRunSize: null,
      exclusive: null,
      url: href.startsWith('http') ? href : `${ORIGIN}${href}`,
    });
  }
  return listings;
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
    for (const listing of found) if (!byId.has(listing.id)) byId.set(listing.id, listing);
    log(`${path} ${found.length} listings`);
    visited.push(url);
    await sleep(delay);
  }

  return { releases: [...byId.values()], visited };
}
