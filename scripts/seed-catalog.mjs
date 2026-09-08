/**
 * Seeds data/catalog.json, the open, shared item catalogue.
 *
 * Two passes, because they give different quality of data:
 *
 *   1. The publisher's own product sitemap. It lists every product URL, and
 *      each URL carries the official item number. That is where the breadth
 *      comes from: thousands of items, with names derived from the URL slug.
 *      Those names are close but not authoritative, so they are marked
 *      `"verified": false`.
 *
 *   2. The fandom category pages. Each renders a schema.org ItemList with the
 *      exact product name, and the page's own path tells us the licence. Items
 *      confirmed this way get the real name, a licence, and `"verified": true`.
 *
 * This is a seeding tool, not a daily job. It makes roughly seventy requests
 * spaced well apart, and it is meant to be run by hand when the catalogue needs
 * topping up. The daily workflow only touches the release calendar.
 *
 * Everything here is public product data, names and item numbers. There is no
 * user data involved because there is no user data anywhere in this project.
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
} from './lib/source.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'catalog.json');
const ORIGIN = 'https://funko.com';
const PRODUCT_SITEMAP = `${ORIGIN}/csitemap_product.xml`;
const CATEGORY_SITEMAP = `${ORIGIN}/csitemap_category.xml`;

/** Words that keep their own casing when a slug is turned back into a name. */
const CASING = new Map(
  Object.entries({
    pop: 'Pop!',
    dc: 'DC',
    tmnt: 'TMNT',
    nba: 'NBA',
    nfl: 'NFL',
    mlb: 'MLB',
    nhl: 'NHL',
    ufc: 'UFC',
    wwe: 'WWE',
    sdcc: 'SDCC',
    nycc: 'NYCC',
    eccc: 'ECCC',
    gitd: 'GITD',
    us: 'US',
    ii: 'II',
    iii: 'III',
    iv: 'IV',
    vi: 'VI',
    vii: 'VII',
    viii: 'VIII',
    ix: 'IX',
    xi: 'XI',
    xii: 'XII',
    tv: 'TV',
    ai: 'AI',
    fx: 'FX',
    hp: 'HP',
    jjk: 'JJK',
    mha: 'MHA',
    dbz: 'DBZ',
  }),
);

const MINOR = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'with', 'to', 'for', 'vs']);

/**
 * Licence names come out of URL slugs, which lose apostrophes, hyphens and
 * accents. These are the ones that matter, they are user-facing filter values,
 * and "Five Nights At Freddys" in a dropdown looks like a bug.
 */
const LICENCE_FIXES = new Map(
  Object.entries({
    'Baldurs Gate': "Baldur's Gate",
    'Five Nights At Freddys': "Five Nights at Freddy's",
    'Five Nights at Freddys': "Five Nights at Freddy's",
    Pokemon: 'Pokémon',
    'Spider Man': 'Spider-Man',
    'X Men': 'X-Men',
    Mls: 'MLS',
    Wnba: 'WNBA',
    'Avatar the Last Airbender': 'Avatar: The Last Airbender',
    'Animated TV': 'Animation and TV',
    'Action Adventure': 'Action and adventure',
  }),
);

export function normaliseLicence(name) {
  if (!name) return null;
  return LICENCE_FIXES.get(name) ?? name;
}

/** "pop-batman-beyond" -> "Pop! Batman Beyond" */
export function nameFromSlug(slug) {
  const words = slug.split('-').filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (CASING.has(lower)) return CASING.get(lower);
      if (/^\d+$/.test(word)) return word;
      if (index > 0 && MINOR.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Rough bucket from the URL slug. Contributors can correct these. */
export function categoryFromSlug(slug) {
  if (/^(pop|bitty|pocket|mystery-pop)/.test(slug) || /\bpop\b/.test(slug)) return 'funko-pop';
  if (/(vinyl-soda|soda|rewind|dorbz|mystery-minis|vinyl-gold)/.test(slug)) return 'other';
  if (/(plush|loungefly|backpack|wallet|tee|shirt|hoodie|pin|game|puzzle)/.test(slug)) return 'other';
  return 'other';
}

/** "/fandoms/anime-manga/one-piece/" -> "One Piece" */
export function licenceFromCategoryPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || parts[0] !== 'fandoms' || parts.length < 3) return null;
  return normaliseLicence(nameFromSlug(last).replace(/^Pop! /, ''));
}

function locsFrom(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function collectFromSitemap(allowed) {
  const { text } = await fetchText(PRODUCT_SITEMAP, { timeout: 90000 });
  const items = new Map();

  for (const loc of locsFrom(text)) {
    const match = loc.match(/^https:\/\/funko\.com\/([a-z0-9-]+)\/(\d+)\.html$/);
    if (!match) continue;
    const [, slug, number] = match;
    if (!allowed(`/${slug}/${number}.html`)) continue;
    items.set(number, {
      id: `funko-${number}`,
      name: nameFromSlug(slug),
      number,
      category: categoryFromSlug(slug),
      license: null,
      series: null,
      variant: null,
      barcodes: [],
      verified: false,
      url: loc,
    });
  }
  return items;
}

async function collectFandomPages(allowed, items) {
  const { text } = await fetchText(CATEGORY_SITEMAP);
  const fandomPaths = locsFrom(text)
    .map((loc) => new URL(loc).pathname)
    .filter((p) => p.startsWith('/fandoms/') && p.split('/').filter(Boolean).length >= 3)
    .filter(allowed);

  console.log(`  ${fandomPaths.length} fandom pages to read`);
  let confirmed = 0;

  for (const [index, pathname] of fandomPaths.entries()) {
    const licence = licenceFromCategoryPath(pathname);
    try {
      const { text: html } = await fetchText(`${ORIGIN}${pathname}`);
      const products = productsFromItemList(extractJsonLd(html));
      let hits = 0;

      for (const product of products) {
        const number = String(product.sku ?? product.mpn ?? '').trim();
        if (!number) continue;
        const name = decodeEntities(product.name ?? '').trim();
        if (!name) continue;

        const existing = items.get(number);
        items.set(number, {
          ...(existing ?? {
            id: `funko-${number}`,
            number,
            category: 'funko-pop',
            series: null,
            variant: null,
            barcodes: [],
            url: typeof product['@id'] === 'string' ? product['@id'] : null,
          }),
          name,
          license: licence ?? existing?.license ?? null,
          verified: true,
        });
        hits += 1;
        confirmed += 1;
      }
      console.log(`  [${index + 1}/${fandomPaths.length}] ${pathname}: ${hits} confirmed as ${licence}`);
    } catch (err) {
      console.log(`  [${index + 1}/${fandomPaths.length}] ${pathname}: failed: ${err.message}`);
    }
    await sleep(POLITE_DELAY_MS);
  }
  return confirmed;
}

/**
 * Written one item per line on purpose: adding a missing figure is then a
 * one-line diff that a non-programmer can read and a maintainer can review.
 */
function serialiseCatalog(payload) {
  const { items, ...head } = payload;
  const headJson = JSON.stringify(head, null, 2).replace(/\n}$/, ',');
  const rows = items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  return `${headJson}\n  "items": [\n${rows}\n  ]\n}\n`;
}

async function main() {
  console.log('ShelfLedger catalogue seed');
  const allowed = await robotsChecker(ORIGIN);

  console.log('\npass 1: product sitemap');
  const items = await collectFromSitemap(allowed);
  console.log(`  ${items.size} products discovered`);

  // Keep anything contributors have already corrected by hand.
  if (existsSync(OUT_FILE)) {
    const previous = JSON.parse(await readFile(OUT_FILE, 'utf8'));
    let kept = 0;
    for (const item of previous.items ?? []) {
      if (item.verified && item.number) {
        items.set(String(item.number), { ...items.get(String(item.number)), ...item });
        kept += 1;
      } else if (!items.has(String(item.number))) {
        items.set(String(item.number), item);
        kept += 1;
      }
    }
    console.log(`  ${kept} existing entries preserved`);
  }

  await sleep(POLITE_DELAY_MS);
  console.log('\npass 2: fandom pages (names and licences)');
  const confirmed = await collectFandomPages(allowed, items);

  const list = [...items.values()].sort((a, b) => Number(a.number) - Number(b.number));
  const verified = list.filter((i) => i.verified).length;
  const licensed = list.filter((i) => i.license).length;

  const payload = {
    schemaVersion: 1,
    version: new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    note: 'Open catalogue of collectible items. Item numbers and names come from public product listings. Entries with "verified": false had their name derived from a product URL and may be slightly off, corrections by pull request are welcome.',
    itemCount: list.length,
    verifiedCount: verified,
  };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, serialiseCatalog({ ...payload, items: list }));

  console.log(`\n  ${list.length} items written`);
  console.log(`  ${verified} verified names (${confirmed} confirmations this run)`);
  console.log(`  ${licensed} with a licence`);
  console.log(`  -> ${path.relative(ROOT, OUT_FILE)}`);
}

// Only run when invoked directly, so the test file can import the parsers
// without kicking off a scrape.
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('seed failed:', err);
    process.exit(1);
  });
}
