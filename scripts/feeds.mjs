/**
 * Static feeds, written at build time.
 *
 * GitHub Pages serves files, so a feed for every possible filter combination is
 * not on the table. What is: a full feed, plus one per manufacturer and per
 * line, which is what people actually subscribe to. Each generated feed URL is
 * the same query string the radar page uses, so a filtered view and its feed
 * always agree.
 *
 * Feeds are ordered by announcement date, because a feed reader wants to know
 * what is new, not what ships soonest.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildCalendar } from '../src/assets/js/ics.js';
import { toCsv } from '../src/assets/js/exports.js';

const MAX_ITEMS = 100;
/** A line or maker needs this many releases before it gets its own feed. */
const MIN_FOR_FACET_FEED = 8;

export function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The date a feed entry is stamped with. An announcement date is a real
 * publication event; without one, fall back to when the row entered the
 * dataset, which is the only other honest timestamp available.
 */
function entryDate(release) {
  return release.announcedDate ?? release.firstSeen ?? null;
}

function toRfc822(iso) {
  if (!iso) return null;
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
}

function describe(release) {
  const bits = [];
  const maker = [release.manufacturer, release.line].filter(Boolean).join(' ');
  if (maker) bits.push(maker);
  if (release.license) bits.push(release.license);
  if (release.releaseDate) bits.push(`Releases ${release.releaseDate}`);
  else if (release.releaseWindow) bits.push(`Ships ${release.releaseWindow}`);
  if (release.announcedDate) bits.push(`Listed ${release.announcedDate}`);
  if (release.limitedRunSize) bits.push(`Limited to ${release.limitedRunSize} pieces`);
  if (typeof release.price === 'number') bits.push(`From $${release.price.toFixed(2)}`);
  const sellers = (release.offers ?? []).map((o) => o.seller).filter(Boolean);
  if (sellers.length) bits.push(`At ${sellers.join(', ')}`);
  return bits.join('. ');
}

function orderForFeed(releases) {
  return [...releases]
    .sort((a, b) => String(entryDate(b) ?? '').localeCompare(String(entryDate(a) ?? '')))
    .slice(0, MAX_ITEMS);
}

export function buildRss(releases, { title, description, feedUrl, siteUrl, generatedAt }) {
  const items = orderForFeed(releases).map((release) => {
    const link = release.url ?? siteUrl;
    const pubDate = toRfc822(entryDate(release));
    return [
      '    <item>',
      `      <title>${escapeXml(release.name)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="false">shelfledger:${escapeXml(release.id)}</guid>`,
      pubDate ? `      <pubDate>${pubDate}</pubDate>` : '',
      `      <description>${escapeXml(describe(release))}</description>`,
      release.manufacturer ? `      <category>${escapeXml(release.manufacturer)}</category>` : '',
      release.line ? `      <category>${escapeXml(release.line)}</category>` : '',
      '    </item>',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(description)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>
`;
}

export function buildJsonFeed(releases, { title, feedUrl, siteUrl, generatedAt }) {
  return `${JSON.stringify(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title,
      home_page_url: siteUrl,
      feed_url: feedUrl,
      description: 'New announcements, preorders, restocks and releases.',
      items: orderForFeed(releases).map((release) => ({
        id: `shelfledger:${release.id}`,
        url: release.url ?? siteUrl,
        title: release.name,
        content_text: describe(release),
        date_published: entryDate(release) ? `${entryDate(release)}T12:00:00Z` : undefined,
        tags: [release.manufacturer, release.line, release.license].filter(Boolean),
        _shelfledger: {
          manufacturer: release.manufacturer,
          line: release.line,
          license: release.license,
          category: release.category,
          sku: release.sku,
          announcedDate: release.announcedDate,
          preorderDate: release.preorderDate,
          releaseDate: release.releaseDate,
          releaseWindow: release.releaseWindow,
          availability: release.availability,
          price: release.price,
          currency: release.currency,
          limitedRunSize: release.limitedRunSize,
          offers: release.offers,
        },
      })),
      _generatedAt: generatedAt,
    },
    null,
    2,
  )}\n`;
}

/** Manufacturers and lines worth their own feed, with the query that filters them. */
export function facetFeeds(releases) {
  const feeds = [];
  const collect = (field, key) => {
    const groups = new Map();
    for (const release of releases) {
      const value = release[field];
      if (!value) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(release);
    }
    for (const [value, items] of groups) {
      if (items.length < MIN_FOR_FACET_FEED) continue;
      feeds.push({
        file: `${key}-${slug(value)}.xml`,
        label: value,
        field,
        query: `?${key === 'maker' ? 'maker' : 'line'}=${encodeURIComponent(value)}`,
        releases: items,
      });
    }
  };
  collect('manufacturer', 'maker');
  collect('line', 'line');
  return feeds.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Write every static feed. Returns a manifest so the site can list what exists
 * without guessing at filenames.
 */
export async function writeFeeds(dist, releases, { siteUrl, generatedAt }) {
  const written = [];
  const full = {
    title: 'ShelfLedger radar',
    description:
      'New announcements, preorders, restocks and releases for action figures and collectibles.',
    siteUrl,
    generatedAt,
  };

  await writeFile(
    path.join(dist, 'feed.xml'),
    buildRss(releases, { ...full, feedUrl: `${siteUrl}feed.xml` }),
  );
  await writeFile(
    path.join(dist, 'feed.json'),
    buildJsonFeed(releases, { ...full, feedUrl: `${siteUrl}feed.json` }),
  );
  await writeFile(path.join(dist, 'radar.csv'), toCsv(releases));

  const dated = releases.filter((r) => r.releaseDate);
  await writeFile(
    path.join(dist, 'radar.ics'),
    buildCalendar(dated, { name: 'ShelfLedger radar' }),
  );
  written.push('feed.xml', 'feed.json', 'radar.csv', 'radar.ics');

  const feedDir = path.join(dist, 'feeds');
  await mkdir(feedDir, { recursive: true });
  const manifest = [];

  for (const feed of facetFeeds(releases)) {
    await writeFile(
      path.join(feedDir, feed.file),
      buildRss(feed.releases, {
        title: `ShelfLedger: ${feed.label}`,
        description: `New announcements, preorders and releases for ${feed.label}.`,
        siteUrl,
        generatedAt,
        feedUrl: `${siteUrl}feeds/${feed.file}`,
      }),
    );
    manifest.push({
      label: feed.label,
      field: feed.field,
      count: feed.releases.length,
      feed: `feeds/${feed.file}`,
      view: feed.query,
    });
    written.push(`feeds/${feed.file}`);
  }

  await writeFile(
    path.join(feedDir, 'index.json'),
    `${JSON.stringify({ generatedAt, feeds: manifest }, null, 2)}\n`,
  );
  return { written, manifest };
}
