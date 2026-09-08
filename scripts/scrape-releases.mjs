/**
 * Rebuilds data/releases.json from Funko's own public catalogue pages.
 *
 * Why these pages: each one renders a schema.org ItemList in the HTML with the
 * product name, item number, price, and stock state already structured. That
 * means one request per section instead of one per product, which is both far
 * less load on their server and far less to go wrong.
 *
 * The limited edition drop page additionally prints a drop date and a run size
 * on each tile. Those two fields are the ones collectors actually plan around,
 * so they are parsed out of the markup rather than the JSON-LD.
 *
 * MAINTENANCE NOTE: this is scraping, so it is only as stable as someone else's
 * markup. Revisit if the run starts reporting zero products for a source, the
 * likely causes are a renamed category path, a switch to client-side rendering,
 * or the ItemList block moving. Do not raise the schedule above once a day, and
 * do not add per-product requests to make up for a broken source; fix the
 * source instead.
 *
 * Output is committed to the repo, so every change to the calendar is a
 * reviewable diff.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fetchText,
  robotsChecker,
  extractJsonLd,
  productsFromItemList,
  decodeEntities,
  sleep,
  POLITE_DELAY_MS,
  USER_AGENT,
} from './lib/source.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'releases.json');
const CATALOG_FILE = path.join(ROOT, 'data', 'catalog.json');
const ORIGIN = 'https://funko.com';
const SCHEMA_VERSION = 1;

const SOURCES = [
  { channel: 'new-release', path: '/new-featured/new-releases/', label: 'Funko new releases' },
  { channel: 'coming-soon', path: '/new-featured/coming-soon/', label: 'Funko coming soon' },
  { channel: 'pre-order', path: '/new-featured/pre-order/', label: 'Funko pre-orders' },
  { channel: 'exclusive', path: '/new-featured/exclusives/', label: 'Funko exclusives' },
  { channel: 'limited-drop', path: '/limited-edition-drops/', label: 'Funko limited edition drops' },
];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function availabilityOf(offer) {
  const raw = String(offer?.availability ?? '').toLowerCase();
  if (raw.includes('preorder') || raw.includes('presale')) return 'pre-order';
  if (raw.includes('outofstock') || raw.includes('soldout')) return 'out-of-stock';
  if (raw.includes('instock')) return 'in-stock';
  if (raw.includes('backorder')) return 'backorder';
  return null;
}

/**
 * The drop tiles print "Sep 08" with no year, and the page shows a rolling
 * window: recent drops that have already happened, plus the next few weeks.
 *
 * So the current year is nearly always right. Only two cases are not:
 *   - a date far enough ahead that it must be last year's drop still listed;
 *   - a date almost a full year behind, which happens in late December when
 *     January dates appear.
 *
 * Getting this backwards puts a past drop a year into the future, where it
 * sits at the bottom of the radar looking like news.
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

  // Guard against 31 April and friends rolling into the next month.
  if (resolved.getUTCMonth() !== m - 1) return null;
  return resolved.toISOString().slice(0, 10);
}

/**
 * Pull drop date and run size off the limited-edition tiles and key them by
 * item number. Each tile prints the badge before its product link, so the
 * markup is split on the badge wrapper and read forwards.
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
    // Only treat the count as a run size when the tile actually says "pieces".
    if (qty && /piece/i.test(label ?? '')) entry.limitedRunSize = Number(qty.replace(/,/g, ''));
    if (Object.keys(entry).length) badges.set(sku, entry);
  }
  return badges;
}

function normaliseRelease(product, { channel, badges }) {
  const sku = String(product.sku ?? product.mpn ?? '').trim();
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const badge = sku ? badges.get(sku) : null;

  const price = Number(offer?.price);
  return {
    id: sku ? `funko-${sku}` : null,
    sku: sku || null,
    name: decodeEntities(product.name ?? '').trim(),
    license: null, // filled in from the catalogue below when we know it
    category: 'funko-pop',
    channel,
    releaseDate: badge?.releaseDate ?? null,
    limitedRunSize: badge?.limitedRunSize ?? null,
    price: Number.isFinite(price) ? price : null,
    currency: offer?.priceCurrency ?? null,
    availability: availabilityOf(offer),
    retailer: 'Funko Shop',
    url: typeof product['@id'] === 'string' ? product['@id'] : (offer?.url ?? null),
  };
}

/** Later sources win on channel, but never overwrite a date with nothing. */
function mergeRelease(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    releaseDate: incoming.releaseDate ?? existing.releaseDate,
    limitedRunSize: incoming.limitedRunSize ?? existing.limitedRunSize,
    price: incoming.price ?? existing.price,
    // A limited drop is the more specific fact about an item; keep it.
    channel: existing.channel === 'limited-drop' ? 'limited-drop' : incoming.channel,
  };
}

async function licencesByNumber() {
  if (!existsSync(CATALOG_FILE)) return new Map();
  try {
    const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
    const map = new Map();
    for (const item of catalog.items) {
      if (item.number && item.license) map.set(String(item.number), item.license);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function readExisting() {
  if (!existsSync(OUT_FILE)) return null;
  try {
    return JSON.parse(await readFile(OUT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Compare everything except the timestamps, so an unchanged run is a no-op. */
function sameData(a, b) {
  const strip = (payload) =>
    JSON.stringify(
      (payload?.releases ?? []).map(({ firstSeen, lastSeen, ...rest }) => rest),
    );
  return strip(a) === strip(b);
}

async function main() {
  const today = new Date();
  const isoDay = today.toISOString().slice(0, 10);
  console.log(`ShelfLedger release scrape ${isoDay}`);
  console.log(`user-agent: ${USER_AGENT}`);

  const allowed = await robotsChecker(ORIGIN);
  const byId = new Map();
  const usedSources = [];
  let failures = 0;

  for (const source of SOURCES) {
    if (!allowed(source.path)) {
      console.log(`  skip   ${source.path}: disallowed by robots.txt`);
      continue;
    }
    try {
      const { text, url } = await fetchText(`${ORIGIN}${source.path}`);
      const products = productsFromItemList(extractJsonLd(text));
      const badges = source.channel === 'limited-drop' ? parseDropBadges(text, today) : new Map();

      let added = 0;
      for (const product of products) {
        const release = normaliseRelease(product, { channel: source.channel, badges });
        if (!release.id || !release.name) continue;
        byId.set(release.id, byId.has(release.id) ? mergeRelease(byId.get(release.id), release) : release);
        added += 1;
      }
      console.log(
        `  ok     ${source.path.padEnd(34)} ${String(added).padStart(3)} products` +
          (badges.size ? `, ${badges.size} dated` : ''),
      );
      if (added > 0) usedSources.push({ label: source.label, url });
      else failures += 1;
    } catch (err) {
      failures += 1;
      console.log(`  FAIL   ${source.path}: ${err.message}`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  if (byId.size === 0) {
    // Never overwrite good data with an empty file because the site changed.
    console.error('No products parsed from any source. Leaving the existing file alone.');
    process.exit(1);
  }
  if (failures === SOURCES.length) process.exit(1);

  const licences = await licencesByNumber();
  const previous = await readExisting();
  const firstSeenById = new Map((previous?.releases ?? []).map((r) => [r.id, r.firstSeen]));

  const releases = [...byId.values()]
    .map((release) => ({
      ...release,
      license: release.license ?? licences.get(release.sku) ?? null,
      firstSeen: firstSeenById.get(release.id) ?? isoDay,
      lastSeen: isoDay,
    }))
    .sort((a, b) => {
      if (a.releaseDate && b.releaseDate && a.releaseDate !== b.releaseDate) {
        return a.releaseDate.localeCompare(b.releaseDate);
      }
      if (a.releaseDate && !b.releaseDate) return -1;
      if (!a.releaseDate && b.releaseDate) return 1;
      return a.name.localeCompare(b.name);
    });

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: today.toISOString(),
    source: 'Public catalogue pages on funko.com, read once a day.',
    sources: usedSources,
    releaseCount: releases.length,
    releases,
  };

  const dated = releases.filter((r) => r.releaseDate).length;
  const limited = releases.filter((r) => r.limitedRunSize).length;
  console.log(`\n  ${releases.length} releases, ${dated} with dates, ${limited} with run sizes`);

  if (previous && sameData(previous, payload)) {
    console.log('  no change since the last run, not rewriting the file');
    // Signals the workflow that there is nothing to commit.
    if (process.env.GITHUB_OUTPUT) {
      await writeFile(process.env.GITHUB_OUTPUT, 'changed=false\n', { flag: 'a' });
    }
    return;
  }

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`  wrote ${path.relative(ROOT, OUT_FILE)}`);
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, 'changed=true\n', { flag: 'a' });
  }
}

// Allow the parsing helpers to be unit tested without running a scrape.
// Only run when invoked directly, so the test file can import the parsers
// without kicking off a scrape.
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('scrape failed:', err);
    process.exit(1);
  });
}
