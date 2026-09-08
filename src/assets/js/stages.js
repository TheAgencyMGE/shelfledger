/**
 * Sorting releases into the buckets a collector actually thinks in.
 *
 * A release can sit in more than one bucket at once, which is the point: a
 * limited drop that opens for preorder next week belongs under both. Pure
 * functions, no DOM, so the rules are tested directly.
 */

/** How long something counts as newly discovered. */
export const JUST_ANNOUNCED_DAYS = 14;
/** How far ahead "releasing soon" reaches. */
export const SOON_DAYS = 90;
/** How far back "new release" reaches. */
export const RECENTLY_OUT_DAYS = 30;

export const STAGES = [
  { id: 'all', label: 'Everything' },
  { id: 'just-announced', label: 'Just announced' },
  { id: 'preorder', label: 'Preorders' },
  { id: 'soon', label: 'Releasing soon' },
  { id: 'available', label: 'Available now' },
  { id: 'new', label: 'New releases' },
  { id: 'exclusive', label: 'Exclusives' },
];

function dayDiff(iso, today) {
  if (!iso) return null;
  const then = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const now = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((then - now) / 86400000);
}

/**
 * Every bucket a release belongs to. Dates do the work where a source gives
 * no stock state, which is why Tamashii entries still land somewhere useful.
 */
export function stagesFor(release, today = new Date()) {
  const found = new Set(['all']);
  const seen = dayDiff(release.firstSeen, today);
  const out = dayDiff(release.releaseDate, today);
  const pre = dayDiff(release.preorderDate, today);
  const availability = release.availability ?? null;

  if (seen !== null && seen > -JUST_ANNOUNCED_DAYS && seen <= 0) found.add('just-announced');

  if (availability === 'pre-order') found.add('preorder');
  // A preorder that has opened but has not shipped is still a preorder, even
  // when the source never says so in words.
  if (pre !== null && pre <= 0 && out !== null && out > 0) found.add('preorder');

  if (out !== null && out > 0 && out <= SOON_DAYS) found.add('soon');

  if (availability === 'in-stock') found.add('available');

  if (release.isNewRelease) found.add('new');
  if (out !== null && out <= 0 && out >= -RECENTLY_OUT_DAYS) found.add('new');

  if (release.exclusive || release.isLimitedDrop || release.limitedRunSize) found.add('exclusive');

  return [...found];
}

/** Annotate a list once, so filtering and counting do not recompute. */
export function withStages(releases, today = new Date()) {
  return releases.map((release) => ({ ...release, stages: stagesFor(release, today) }));
}

export function countByStage(releases) {
  const counts = Object.fromEntries(STAGES.map((s) => [s.id, 0]));
  for (const release of releases) {
    for (const stage of release.stages ?? []) {
      if (stage in counts) counts[stage] += 1;
    }
  }
  return counts;
}

const AVAILABILITY_LABELS = {
  'pre-order': 'Preorder',
  'in-stock': 'In stock',
  'out-of-stock': 'Sold out',
  waitlist: 'Waitlist',
  announced: 'Announced',
};

export function availabilityLabel(value) {
  return AVAILABILITY_LABELS[value] ?? null;
}

/**
 * Filter a stage-annotated list. Every option is an AND, and free text has to
 * match every word somewhere in the row.
 */
export function filterReleases(releases, filter = {}) {
  const {
    stage = 'all',
    manufacturer = '',
    line = '',
    category = '',
    text = '',
    wishlistOnly = false,
  } = filter;
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return releases.filter((release) => {
    if (stage !== 'all' && !(release.stages ?? []).includes(stage)) return false;
    if (manufacturer && release.manufacturer !== manufacturer) return false;
    if (line && release.line !== line) return false;
    if (category && release.category !== category) return false;
    if (wishlistOnly && !release.match) return false;
    if (!words.length) return true;

    const hay = [
      release.name,
      release.line,
      release.manufacturer,
      release.license,
      release.sku,
      release.exclusive,
      release.retailer,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** Distinct values for the filter dropdowns, in the order people expect. */
export function facets(releases) {
  const pick = (field) =>
    [...new Set(releases.map((r) => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    manufacturers: pick('manufacturer'),
    lines: pick('line'),
    categories: pick('category'),
  };
}

export const CATEGORY_LABELS = {
  'vinyl-figure': 'Vinyl figures',
  'action-figure': 'Action figures',
  'anime-figure': 'Anime figures',
  statue: 'Statues',
};

/**
 * Radar order: what is coming, then what has no date, then what already
 * happened. Sorting purely by date puts last year's shipped stock at the top
 * of a page whose whole job is telling you what is next.
 */
export function sortReleases(releases, today = new Date()) {
  const cutoff = today.toISOString().slice(0, 10);
  const rank = (r) => {
    if (!r.releaseDate) return 1; // undated announcements sit in the middle
    return r.releaseDate >= cutoff ? 0 : 2;
  };

  return [...releases].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.releaseDate.localeCompare(b.releaseDate); // soonest first
    if (ra === 2) return b.releaseDate.localeCompare(a.releaseDate); // most recent first
    return a.name.localeCompare(b.name);
  });
}

/** Above this share of the feed, a discovery date is a bulk import, not news. */
const BULK_SHARE = 0.4;

/**
 * The ids worth marking as newly discovered.
 *
 * A "new" badge is only information when it is rare. On the first run, and on
 * the day a new source is added, everything shares one discovery date and
 * badging all of it says nothing. So the marker is withheld when the newest
 * cohort is most of the feed, and appears once daily discoveries are the small
 * handful they normally are.
 */
export function newlyDiscovered(releases) {
  const dated = releases.filter((r) => r.firstSeen);
  if (dated.length === 0) return new Set();

  const newest = dated.reduce((max, r) => (r.firstSeen > max ? r.firstSeen : max), '');
  const cohort = dated.filter((r) => r.firstSeen === newest);
  if (cohort.length === dated.length) return new Set(); // nothing to compare against
  if (cohort.length / dated.length > BULK_SHARE) return new Set();
  return new Set(cohort.map((r) => r.id));
}

/** Newest discoveries first, for the just-announced view. */
export function sortByFirstSeen(releases) {
  return [...releases].sort(
    (a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)) || a.name.localeCompare(b.name),
  );
}
