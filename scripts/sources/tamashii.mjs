/**
 * Tamashii Nations, which covers S.H.Figuarts, Figuarts mini, Robot Damashii,
 * Metal Build and the rest of Bandai Spirits' collector lines.
 *
 * Their front page lists current items as structured tiles, and the dates are
 * in `datetime` attributes rather than prose, so both the preorder opening and
 * the release date come back machine readable. One request covers it.
 *
 * Product names come back in Japanese because that is what the source
 * publishes. They are stored as written rather than machine translated, since a
 * wrong translation of a figure name is worse than an untranslated one. The
 * line name (S.H.Figuarts and so on) is Latin script, so filtering and search
 * by line still work.
 */

import { decodeEntities } from '../lib/source.mjs';

export const meta = {
  id: 'tamashii',
  label: 'Tamashii Nations',
  manufacturer: 'Bandai Spirits',
  homepage: 'https://tamashiiweb.com/',
  retailer: 'Tamashii Nations',
  category: 'anime-figure',
};

const ORIGIN = 'https://tamashiiweb.com';
const PAGES = ['/'];

function text(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Lines that are statues or dioramas rather than articulated figures. */
const STATUE_LINES = /(ichibansho|figuartszero|figuarts zero|imagination works|gallery)/i;

function categoryForLine(line) {
  if (!line) return meta.category;
  if (STATUE_LINES.test(line)) return 'statue';
  return meta.category;
}

/**
 * Tiles print two dated lines: preorder opening then release. Both are marked
 * up as <time datetime="YYYY-MM-DD">, so take them in order.
 */
export function parseDates(metaBlock) {
  const dates = [...String(metaBlock).matchAll(/datetime="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
  if (dates.length === 0) return { preorderDate: null, releaseDate: null };
  if (dates.length === 1) return { preorderDate: null, releaseDate: dates[0] };
  return { preorderDate: dates[0], releaseDate: dates[1] };
}

export function parseListing(html) {
  const releases = [];
  const chunks = String(html).split('class="productList__item').slice(1);

  for (const chunk of chunks) {
    const tile = chunk.slice(0, 4000);
    const href = tile.match(/href="(\/item\/(\d+)\/?)"/);
    if (!href) continue;
    const [, path, id] = href;

    const name = text(tile.match(/class="productList__name">([\s\S]*?)<\/p>/)?.[1] ?? '');
    if (!name) continue;
    const line = text(tile.match(/class="productList__brand">([\s\S]*?)<\/p>/)?.[1] ?? '') || null;
    const channel = text(tile.match(/class="productList__category[^"]*">([\s\S]*?)<\/p>/)?.[1] ?? '');
    const metaBlock = tile.match(/class="productList__date">([\s\S]*?)<\/p>/)?.[1] ?? '';
    const { preorderDate, releaseDate } = parseDates(metaBlock);

    releases.push({
      id: `tamashii-${id}`,
      sourceId: meta.id,
      manufacturer: meta.manufacturer,
      line,
      category: categoryForLine(line),
      sku: null,
      name,
      license: null,
      releaseDate,
      preorderDate,
      price: null,
      currency: null,
      availability: null,
      limitedRunSize: null,
      // Tamashii marks its own web shop exclusives in the channel label.
      exclusive: /魂ウェブ商店|プレミアムバンダイ/.test(channel) ? channel : null,
      isNewRelease: false,
      isLimitedDrop: false,
      isReissue: /_icon-resale/.test(tile),
      retailer: meta.retailer,
      url: `${ORIGIN}${path}`,
    });
  }
  return releases;
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
