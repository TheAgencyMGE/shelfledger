/**
 * Rebuilds data/releases.json from every source adapter.
 *
 * The order of work: collect listings per source, merge listings that are the
 * same product, then apply what only the previous run can know (first seen,
 * stock changes, restocks).
 *
 * Three rules this file exists to enforce:
 *
 * 1. A source failing does not fail the run. Its rows are carried forward from
 *    the previous file and the failure is published, so the site can say a
 *    source is stale instead of silently losing it.
 * 2. A source's first ever run is a baseline, not hundreds of announcements.
 *    Bootstrapping sources are recorded, and nothing from them is treated as
 *    newly discovered or restocked on that run.
 * 3. Noticing something is not the same as it being new. firstSeenByShelfLedger
 *    is recorded and is never used as an announcement date. See merge.mjs.
 *
 * MAINTENANCE: this is scraping, so it is only as stable as someone else's
 * markup. A source reporting zero products usually means a renamed path or a
 * switch to client side rendering. Fix the adapter; do not add per-product
 * requests to compensate, and do not raise the schedule above once a day.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchText, robotsChecker, sleep, POLITE_DELAY_MS, USER_AGENT } from './lib/source.mjs';
import { SOURCES, unsupportedForOutput } from './sources/index.mjs';
import { mergeListings, applyHistory } from './merge.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'releases.json');
const SCHEMA_VERSION = 3;

/** A release older than this cannot be described as new, whatever a page says. */
const STALE_RELEASE_DAYS = 120;

async function readExisting() {
  if (!existsSync(OUT_FILE)) return null;
  try {
    return JSON.parse(await readFile(OUT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Compare everything except run timestamps, so an unchanged run is a no-op. */
function sameData(a, b) {
  const strip = (payload) =>
    JSON.stringify(
      (payload?.releases ?? [])
        .map(({ firstSeen, lastSeen, firstSeenByShelfLedger, ...rest }) => rest)
        .sort((x, y) => String(x.id).localeCompare(String(y.id))),
    );
  return strip(a) === strip(b);
}

function robotsCache() {
  const cache = new Map();
  return (homepage) => {
    const origin = new URL(homepage).origin;
    if (!cache.has(origin)) cache.set(origin, robotsChecker(origin));
    return cache.get(origin);
  };
}

/**
 * Last defence against an old product being presented as new. If a release
 * already came out months ago, drop any announcement date attached to it: a
 * retailer relisting a 2025 figure is not a 2026 announcement.
 */
export function dropStaleAnnouncements(releases, today) {
  const cutoff = new Date(today.getTime() - STALE_RELEASE_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  let dropped = 0;

  const cleaned = releases.map((release) => {
    if (!release.announcedDate) return release;
    const out = release.releaseDate;
    if (out && out < cutoff && release.announcedDate > out) {
      dropped += 1;
      return {
        ...release,
        announcedDate: null,
        announcedBy: null,
        announcementKind: null,
        staleAnnouncementDropped: true,
      };
    }
    return release;
  });
  return { releases: cleaned, dropped };
}

async function main() {
  const today = new Date();
  const isoDay = today.toISOString().slice(0, 10);
  console.log(`ShelfLedger release scrape ${isoDay}`);
  console.log(`user-agent: ${USER_AGENT}\n`);

  const previous = await readExisting();
  const previousById = new Map((previous?.releases ?? []).map((r) => [r.id, r]));
  const seenSourceIds = new Set(
    (previous?.releases ?? []).flatMap((r) => r.sourceIds ?? [r.sourceId]).filter(Boolean),
  );
  const getRobots = robotsCache();

  const listings = [];
  const reports = [];
  const bootstrapping = new Set();

  for (const source of SOURCES) {
    const { meta } = source;
    const log = (message) => console.log(`  ${meta.id.padEnd(20)} ${message}`);
    const isFirstRun = !seenSourceIds.has(meta.id);
    if (isFirstRun) bootstrapping.add(meta.id);

    try {
      const allowed = await getRobots(meta.homepage);
      const { releases: found, visited } = await source.collect({
        fetchText,
        allowed,
        sleep,
        delay: POLITE_DELAY_MS,
        today,
        log,
      });

      if (found.length === 0) throw new Error('no products parsed');
      listings.push(...found);
      reports.push({
        id: meta.id,
        label: meta.label,
        kind: meta.kind ?? 'manufacturer',
        homepage: meta.homepage,
        url: visited[0] ?? meta.homepage,
        ok: true,
        listings: found.length,
        withListingDate: found.filter((l) => l.listedDate).length,
        lastSuccess: today.toISOString(),
        bootstrap: isFirstRun,
      });
      log(`ok, ${found.length} listings${isFirstRun ? ' (first run, treated as baseline)' : ''}`);
    } catch (err) {
      reports.push({
        id: meta.id,
        label: meta.label,
        kind: meta.kind ?? 'manufacturer',
        homepage: meta.homepage,
        url: meta.homepage,
        ok: false,
        listings: 0,
        withListingDate: 0,
        error: err.message,
        lastSuccess: previous?.sources?.find((s) => s.id === meta.id)?.lastSuccess ?? null,
        bootstrap: isFirstRun,
      });
      console.log(`  ${meta.id.padEnd(20)} FAILED: ${err.message}`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  if (reports.every((s) => !s.ok)) {
    console.error('\nEvery source failed. Leaving the existing file alone.');
    process.exit(1);
  }

  // A failed source keeps the releases it produced last time.
  const failed = reports.filter((s) => !s.ok).map((s) => s.id);
  const carried = failed.length
    ? (previous?.releases ?? []).filter((r) => (r.sourceIds ?? []).some((id) => failed.includes(id)))
    : [];
  if (carried.length) console.log(`\n  carried ${carried.length} releases from failed sources`);

  console.log(`\n  merging ${listings.length} listings`);
  const merged = mergeListings(listings);
  console.log(`  ${merged.length} releases after deduplication`);

  const withCarried = [...merged];
  const mergedIds = new Set(merged.map((r) => r.id));
  for (const release of carried) if (!mergedIds.has(release.id)) withCarried.push(release);

  const { releases: cleaned, dropped } = dropStaleAnnouncements(withCarried, today);
  if (dropped) console.log(`  dropped ${dropped} announcement dates on already-released items`);

  const finalReleases = applyHistory(cleaned, previousById, isoDay, {
    bootstrapSources: bootstrapping,
  }).sort((a, b) => {
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
    sources: reports,
    unsupported: unsupportedForOutput(),
    releaseCount: finalReleases.length,
    releases: finalReleases,
  };

  const announced = finalReleases.filter((r) => r.announcedDate).length;
  const multi = finalReleases.filter((r) => r.offers.length > 1).length;
  console.log(`\n  ${finalReleases.length} releases from ${reports.filter((s) => s.ok).length}/${reports.length} sources`);
  console.log(`  ${announced} with a real announcement date, ${multi} listed by more than one seller`);

  if (previous && sameData(previous, payload)) {
    console.log('  no change since the last run, not rewriting the file');
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

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('scrape failed:', err);
    process.exit(1);
  });
}
