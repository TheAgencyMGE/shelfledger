/**
 * Rebuilds data/releases.json from public manufacturer listing pages.
 *
 * Each source is an adapter in scripts/sources. This file only orchestrates:
 * it checks robots.txt per host, runs each adapter in turn, and keeps going
 * when one of them breaks. A source that fails is recorded in the output with
 * its error so the site can say so, and the previous run's releases for that
 * source are carried forward rather than vanishing off the radar.
 *
 * The run only refuses to write when every source failed, because that means
 * the problem is here rather than out there.
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

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'releases.json');
const CATALOG_FILE = path.join(ROOT, 'data', 'catalog.json');
const SCHEMA_VERSION = 2;

/** Fields every release ends up with, so the app never sees a ragged row. */
function normalise(release, isoDay) {
  return {
    id: release.id,
    sourceId: release.sourceId,
    manufacturer: release.manufacturer ?? null,
    line: release.line ?? null,
    category: release.category ?? 'action-figure',
    sku: release.sku ?? null,
    name: release.name,
    license: release.license ?? null,
    releaseDate: release.releaseDate ?? null,
    releaseWindow: release.releaseWindow ?? null,
    preorderDate: release.preorderDate ?? null,
    price: typeof release.price === 'number' ? release.price : null,
    currency: release.currency ?? null,
    availability: release.availability ?? null,
    limitedRunSize: release.limitedRunSize ?? null,
    exclusive: release.exclusive ?? null,
    isNewRelease: Boolean(release.isNewRelease),
    isLimitedDrop: Boolean(release.isLimitedDrop),
    isReissue: Boolean(release.isReissue),
    retailer: release.retailer ?? null,
    url: release.url ?? null,
    firstSeen: isoDay,
    lastSeen: isoDay,
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
      (payload?.releases ?? [])
        .map(({ firstSeen, lastSeen, ...rest }) => rest)
        .sort((x, y) => String(x.id).localeCompare(String(y.id))),
    );
  return strip(a) === strip(b);
}

/** One robots checker per host, fetched once. */
function robotsCache() {
  const cache = new Map();
  return (homepage) => {
    const origin = new URL(homepage).origin;
    if (!cache.has(origin)) cache.set(origin, robotsChecker(origin));
    return cache.get(origin);
  };
}

async function main() {
  const today = new Date();
  const isoDay = today.toISOString().slice(0, 10);
  console.log(`ShelfLedger release scrape ${isoDay}`);
  console.log(`user-agent: ${USER_AGENT}\n`);

  const previous = await readExisting();
  const previousById = new Map((previous?.releases ?? []).map((r) => [r.id, r]));
  const getRobots = robotsCache();

  const collected = [];
  const sourceReports = [];

  for (const source of SOURCES) {
    const { meta } = source;
    const log = (message) => console.log(`  ${meta.id.padEnd(9)} ${message}`);
    try {
      const allowed = await getRobots(meta.homepage);
      const { releases, visited } = await source.collect({
        fetchText,
        allowed,
        sleep,
        delay: POLITE_DELAY_MS,
        today,
        log,
      });

      if (releases.length === 0) throw new Error('no products parsed');
      collected.push(...releases);
      sourceReports.push({
        id: meta.id,
        label: meta.label,
        manufacturer: meta.manufacturer,
        homepage: meta.homepage,
        url: visited[0] ?? meta.homepage,
        ok: true,
        count: releases.length,
      });
      log(`ok, ${releases.length} releases`);
    } catch (err) {
      // Keep what this source gave last time rather than dropping it off the
      // radar because of one bad run.
      const carried = [...previousById.values()].filter((r) => r.sourceId === meta.id);
      collected.push(...carried);
      sourceReports.push({
        id: meta.id,
        label: meta.label,
        manufacturer: meta.manufacturer,
        homepage: meta.homepage,
        url: meta.homepage,
        ok: false,
        count: carried.length,
        error: err.message,
        carriedForward: carried.length > 0,
      });
      console.log(`  ${meta.id.padEnd(9)} FAILED: ${err.message}`);
      if (carried.length) console.log(`  ${meta.id.padEnd(9)} kept ${carried.length} from last run`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  if (sourceReports.every((s) => !s.ok)) {
    console.error('\nEvery source failed. Leaving the existing file alone.');
    process.exit(1);
  }

  const licences = await licencesByNumber();
  const byId = new Map();
  for (const raw of collected) {
    const release = normalise(raw, isoDay);
    if (!release.id || !release.name) continue;
    const before = previousById.get(release.id);
    if (!release.license && release.sku) release.license = licences.get(release.sku) ?? null;
    release.firstSeen = before?.firstSeen ?? isoDay;
    byId.set(release.id, release);
  }

  const releases = [...byId.values()].sort((a, b) => {
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
    sources: sourceReports,
    unsupported: unsupportedForOutput(),
    releaseCount: releases.length,
    releases,
  };

  const ok = sourceReports.filter((s) => s.ok).length;
  const dated = releases.filter((r) => r.releaseDate).length;
  const fresh = releases.filter((r) => r.firstSeen === isoDay).length;
  console.log(`\n  ${releases.length} releases from ${ok}/${sourceReports.length} sources`);
  console.log(`  ${dated} dated, ${fresh} first seen today`);

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

// Only run when invoked directly, so tests can import the helpers.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('scrape failed:', err);
    process.exit(1);
  });
}
