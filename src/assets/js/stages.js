/**
 * Which bucket a release belongs in, and how filters narrow the radar.
 *
 * The important rule lives in stagesFor(): a release is only "just announced"
 * when a source published a date saying so. ShelfLedger noticing something for
 * the first time is not evidence that it is new, and firstSeenByShelfLedger is
 * deliberately never read here.
 *
 * Pure functions, no DOM, so every rule is testable on its own.
 */

/** How long a published announcement stays newsworthy. */
export const JUST_ANNOUNCED_DAYS = 21;
export const NEW_PREORDER_DAYS = 30;
export const NEW_ARRIVAL_DAYS = 30;
export const RESTOCK_DAYS = 30;
/** How far ahead "releasing soon" reaches. */
export const SOON_DAYS = 90;

export const STAGES = [
  { id: 'all', label: 'Everything' },
  { id: 'just-announced', label: 'Just announced' },
  { id: 'new-preorders', label: 'New preorders' },
  { id: 'soon', label: 'Releasing soon' },
  { id: 'available', label: 'Available now' },
  { id: 'new-arrivals', label: 'New arrivals' },
  { id: 'restocks', label: 'Restocks' },
  { id: 'exclusive', label: 'Exclusives' },
];

export const CATEGORY_LABELS = {
  'action-figure': 'Action figures',
  'anime-figure': 'Anime figures',
  'vinyl-figure': 'Vinyl figures',
  statue: 'Statues',
  'model-kit': 'Model kits',
  plush: 'Plush',
  other: 'Other',
};

const AVAILABILITY_LABELS = {
  'pre-order': 'Preorder',
  'in-stock': 'In stock',
  'out-of-stock': 'Sold out',
  'sold-out': 'Sold out',
  waitlist: 'Waitlist',
  backorder: 'Backorder',
  announced: 'Announced',
};

export function availabilityLabel(value) {
  return AVAILABILITY_LABELS[value] ?? null;
}

function daysFrom(iso, today) {
  if (!iso) return null;
  const then = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const now = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((then - now) / 86400000);
}

/** True when a published date is within `window` days behind today. */
function recent(iso, today, window) {
  const diff = daysFrom(iso, today);
  return diff !== null && diff <= 0 && diff > -window;
}

/**
 * Every bucket a release belongs to.
 *
 * Each rule needs evidence a source actually published. Nothing here reads
 * firstSeenByShelfLedger, so a product listed years ago cannot become news by
 * being scraped today.
 */
export function stagesFor(release, today = new Date()) {
  const found = new Set(['all']);
  const out = daysFrom(release.releaseDate, today);

  // A published announcement date, from a source that dates its listings.
  if (release.announcedDate && recent(release.announcedDate, today, JUST_ANNOUNCED_DAYS)) {
    found.add('just-announced');
  }

  const preorderOpened =
    release.announcementKind === 'new-preorder' ? release.announcedDate : release.preorderDate;
  if (preorderOpened && recent(preorderOpened, today, NEW_PREORDER_DAYS)) {
    found.add('new-preorders');
  }

  if (out !== null && out > 0 && out <= SOON_DAYS) found.add('soon');

  if (release.availability === 'in-stock') found.add('available');

  if (release.arrivalDate && recent(release.arrivalDate, today, NEW_ARRIVAL_DAYS)) {
    found.add('new-arrivals');
  }

  if (release.restockedAt && recent(release.restockedAt, today, RESTOCK_DAYS)) {
    found.add('restocks');
  }

  if (release.exclusive || release.limitedRunSize || release.isLimitedDrop) {
    found.add('exclusive');
  }

  return [...found];
}

export function withStages(releases, today = new Date()) {
  return releases.map((release) => ({ ...release, stages: stagesFor(release, today) }));
}

export function countByStage(releases) {
  const counts = Object.fromEntries(STAGES.map((s) => [s.id, 0]));
  for (const release of releases) {
    for (const stage of release.stages ?? []) if (stage in counts) counts[stage] += 1;
  }
  return counts;
}

/** The default filter shape. Anything absent means "do not narrow on this". */
export const EMPTY_FILTER = {
  stage: 'all',
  manufacturer: '',
  line: '',
  license: '',
  retailer: '',
  category: '',
  availability: '',
  from: '',
  to: '',
  minPrice: '',
  maxPrice: '',
  text: '',
};

export function filterReleases(releases, filter = {}) {
  const f = { ...EMPTY_FILTER, ...filter };
  const words = String(f.text).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const min = f.minPrice === '' ? null : Number(f.minPrice);
  const max = f.maxPrice === '' ? null : Number(f.maxPrice);

  return releases.filter((release) => {
    if (f.stage !== 'all' && !(release.stages ?? []).includes(f.stage)) return false;
    if (f.manufacturer && release.manufacturer !== f.manufacturer) return false;
    if (f.line && release.line !== f.line) return false;
    if (f.license && release.license !== f.license) return false;
    if (f.category && release.category !== f.category) return false;
    if (f.availability && release.availability !== f.availability) return false;
    if (f.retailer && !(release.offers ?? []).some((o) => o.seller === f.retailer)) return false;

    // Date range applies to the release date, which is what people plan around.
    if (f.from && (!release.releaseDate || release.releaseDate < f.from)) return false;
    if (f.to && (!release.releaseDate || release.releaseDate > f.to)) return false;

    if (min !== null && Number.isFinite(min)) {
      if (typeof release.price !== 'number' || release.price < min) return false;
    }
    if (max !== null && Number.isFinite(max)) {
      if (typeof release.price !== 'number' || release.price > max) return false;
    }

    if (!words.length) return true;
    const hay = [
      release.name,
      release.line,
      release.manufacturer,
      release.license,
      release.sku,
      release.exclusive,
      ...(release.offers ?? []).map((o) => o.seller),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** Distinct values for the filter controls, in the order people expect. */
export function facets(releases) {
  const pick = (field) =>
    [...new Set(releases.map((r) => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sellers = new Set();
  for (const release of releases) {
    for (const offer of release.offers ?? []) if (offer.seller) sellers.add(offer.seller);
  }
  return {
    manufacturers: pick('manufacturer'),
    lines: pick('line'),
    licenses: pick('license'),
    categories: pick('category'),
    availabilities: pick('availability'),
    retailers: [...sellers].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Radar order: what is coming first, then undated, then what already shipped.
 * Sorting purely by date buries the next drop under last year's stock.
 */
export function sortReleases(releases, today = new Date()) {
  const cutoff = today.toISOString().slice(0, 10);
  const rank = (r) => {
    if (!r.releaseDate) return 1;
    return r.releaseDate >= cutoff ? 0 : 2;
  };

  return [...releases].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.releaseDate.localeCompare(b.releaseDate);
    if (ra === 2) return b.releaseDate.localeCompare(a.releaseDate);
    return a.name.localeCompare(b.name);
  });
}

/** Newest announcement first, for the announcement-led views. */
export function sortByAnnouncement(releases) {
  return [...releases].sort(
    (a, b) =>
      String(b.announcedDate ?? '').localeCompare(String(a.announcedDate ?? '')) ||
      a.name.localeCompare(b.name),
  );
}

/** Which ordering a stage wants. */
export function sortForStage(releases, stage, today = new Date()) {
  if (stage === 'just-announced' || stage === 'new-preorders') return sortByAnnouncement(releases);
  if (stage === 'restocks') {
    return [...releases].sort(
      (a, b) => String(b.restockedAt ?? '').localeCompare(String(a.restockedAt ?? '')),
    );
  }
  if (stage === 'new-arrivals') {
    return [...releases].sort(
      (a, b) => String(b.arrivalDate ?? '').localeCompare(String(a.arrivalDate ?? '')),
    );
  }
  return sortReleases(releases, today);
}
