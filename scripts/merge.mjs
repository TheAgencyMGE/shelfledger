/**
 * Turning listings into releases.
 *
 * The same figure is listed by Entertainment Earth, BigBadToyStore and its
 * manufacturer. This collapses those into one release carrying several places
 * to buy it, and decides which source is trusted for which fact.
 *
 * The rule for facts: the manufacturer wins for what the product *is* (name,
 * line, item number, run size, release date), retailers win for what is
 * happening to it right now (price, stock, listing dates). A retailer knows
 * when it started taking preorders; a manufacturer knows what the thing is.
 *
 * The rule for dates is stricter, and it is the whole point of this file. See
 * announcementFor().
 */

import { groupListings, normaliseMaker, displayMaker } from '../src/assets/js/identity.mjs';
import { inferLine } from '../src/assets/js/lines.mjs';

/** Best first. Used to pick what to show when offers disagree. */
const AVAILABILITY_RANK = [
  'in-stock',
  'pre-order',
  'backorder',
  'waitlist',
  'announced',
  'out-of-stock',
  'sold-out',
];

export function bestAvailability(values) {
  const present = values.filter(Boolean);
  if (!present.length) return null;
  for (const rank of AVAILABILITY_RANK) if (present.includes(rank)) return rank;
  return present[0];
}

const earliest = (values) => values.filter(Boolean).sort()[0] ?? null;
const latest = (values) => values.filter(Boolean).sort().slice(-1)[0] ?? null;

/**
 * The announcement date, and what evidence produced it.
 *
 * This is the fix for the bug where a 2025 product became "just announced"
 * because the scraper first saw it in 2026. An announcement date only exists
 * when a source published one. When no source did, the release has no
 * announcement date and can never be shown as newly announced, no matter how
 * recently ShelfLedger noticed it.
 *
 * firstSeen is recorded separately, is never used as an announcement date, and
 * exists only so the change history can say when a row entered the dataset.
 */
export function announcementFor(listings) {
  const dated = listings.filter((l) => l.listedDate);
  if (!dated.length) return { announcedDate: null, announcedBy: null, announcementKind: null };

  // Earliest wins: if two retailers listed it, the first one is when it broke.
  const winner = dated.reduce((best, l) => (l.listedDate < best.listedDate ? l : best));
  return {
    announcedDate: winner.listedDate,
    announcedBy: winner.sourceId,
    announcementKind: winner.listingKind ?? null,
  };
}

function pickName(listings) {
  const maker = listings.find((l) => l.sourceKind === 'manufacturer' && l.name);
  if (maker) return maker.name;
  // Otherwise the longest title, which usually carries the line and variant.
  return listings.map((l) => l.name).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? '';
}

function pickFact(listings, field) {
  const maker = listings.find((l) => l.sourceKind === 'manufacturer' && l[field] != null);
  if (maker) return maker[field];
  const any = listings.find((l) => l[field] != null);
  return any ? any[field] : null;
}

function offerFor(listing) {
  return {
    sourceId: listing.sourceId,
    seller: listing.retailer ?? listing.manufacturer ?? listing.sourceId,
    kind: listing.sourceKind,
    url: listing.url ?? null,
    price: listing.price ?? null,
    currency: listing.currency ?? null,
    availability: listing.availability ?? null,
    listedDate: listing.listedDate ?? null,
    listingKind: listing.listingKind ?? null,
  };
}

/** A stable id: prefer the manufacturer's, else the lowest sorted listing id. */
function pickId(listings) {
  const maker = listings.filter((l) => l.sourceKind === 'manufacturer').map((l) => l.id).sort();
  if (maker.length) return maker[0];
  return listings.map((l) => l.id).sort()[0];
}

export function mergeGroup(listings) {
  const name = pickName(listings);
  const manufacturer = pickFact(listings, 'manufacturer');
  const offers = listings.map(offerFor).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'manufacturer' ? -1 : 1;
    return String(a.seller).localeCompare(String(b.seller));
  });

  const prices = offers.map((o) => o.price).filter((p) => typeof p === 'number');

  return {
    id: pickId(listings),
    name,
    manufacturer: displayMaker(manufacturer),
    makerKey: normaliseMaker(manufacturer),
    line: inferLine(name, pickFact(listings, 'line')),
    license: pickFact(listings, 'license'),
    category: pickFact(listings, 'category') ?? 'other',
    sku: pickFact(listings, 'sku'),

    releaseDate: pickFact(listings, 'releaseDate'),
    releaseWindow: pickFact(listings, 'releaseWindow'),
    preorderDate: earliest(listings.map((l) => l.preorderDate)),
    arrivalDate: latest(listings.map((l) => l.arrivalDate)),
    ...announcementFor(listings),

    availability: bestAvailability(listings.map((l) => l.availability)),
    price: prices.length ? Math.min(...prices) : null,
    currency: offers.find((o) => o.currency)?.currency ?? null,
    limitedRunSize: pickFact(listings, 'limitedRunSize'),
    exclusive: pickFact(listings, 'exclusive'),
    isReissue: listings.some((l) => l.isReissue),
    onNewReleasesPage: listings.some((l) => l.onNewReleasesPage),

    sourceIds: [...new Set(listings.map((l) => l.sourceId))].sort(),
    offers,
    url: offers.find((o) => o.url)?.url ?? null,
  };
}

/** Collapse every listing into deduplicated releases. */
export function mergeListings(listings) {
  return groupListings(listings).map(mergeGroup);
}

/**
 * Carry forward what only a previous run can know: when we first saw a row,
 * and whether stock has just come back.
 *
 * A restock is a real state change, out of stock in the last run and in stock
 * now, so it is derived here rather than guessed in the browser.
 */
export function applyHistory(releases, previousById, isoDay, { bootstrapSources = new Set() } = {}) {
  return releases.map((release) => {
    const before = previousById.get(release.id);
    const wasUnavailable =
      before && ['out-of-stock', 'sold-out', 'backorder', 'waitlist'].includes(before.availability);
    const isAvailable = release.availability === 'in-stock';

    // On a source's first run there is nothing to compare against, so no row
    // from it may claim to be a restock or a fresh discovery.
    const bootstrapping = release.sourceIds.some((id) => bootstrapSources.has(id));

    return {
      ...release,
      firstSeen: before?.firstSeen ?? isoDay,
      lastSeen: isoDay,
      // Explicitly separate from any announcement date. Never drives "new".
      firstSeenByShelfLedger: before?.firstSeenByShelfLedger ?? before?.firstSeen ?? isoDay,
      baseline: before ? Boolean(before.baseline) : bootstrapping,
      previousAvailability: before?.availability ?? null,
      availabilityChangedAt:
        before && before.availability !== release.availability
          ? isoDay
          : (before?.availabilityChangedAt ?? null),
      restockedAt: !bootstrapping && wasUnavailable && isAvailable ? isoDay : (before?.restockedAt ?? null),
    };
  });
}
