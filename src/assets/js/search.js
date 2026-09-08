/**
 * Text matching shared by catalogue search and the release radar.
 *
 * Collector names are messy, "Pop! Batman (Glow in the Dark)", "Batman GITD",
 * "batman glow" all mean one figure. Everything here works on a normalised
 * token bag rather than raw strings. Pure functions, no DOM.
 */

/** Words that carry no signal in this hobby and only inflate similarity. */
const STOP_WORDS = new Set([
  'pop',
  'pops',
  'vinyl',
  'figure',
  'figures',
  'the',
  'a',
  'an',
  'and',
  'of',
  'with',
  'exclusive',
  'edition',
  'collectible',
]);

/** Lowercase, strip punctuation and diacritics, split into words. */
export function tokenise(text) {
  if (!text) return [];
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0);
}

/** Tokens worth comparing: stop words dropped, single letters kept only if numeric. */
export function significantTokens(text) {
  return tokenise(text).filter((t) => !STOP_WORDS.has(t) && (t.length > 1 || /\d/.test(t)));
}

/**
 * Sørensen–Dice coefficient over token sets: 0 (nothing shared) to 1 (identical).
 * Chosen over edit distance because word order varies wildly between sources.
 */
export function tokenSimilarity(a, b) {
  const setA = new Set(significantTokens(a));
  const setB = new Set(significantTokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * Score a catalogue row against a typed query. Returns 0 when the query is not
 * fully represented, so results never drift off-topic as you keep typing.
 */
export function scoreEntry(query, entry) {
  const q = tokenise(query);
  if (q.length === 0) return 0;

  const name = (entry.name || '').toLowerCase();
  const haystack = tokenise(
    [entry.name, entry.license, entry.series, entry.number].filter(Boolean).join(' '),
  );
  if (haystack.length === 0) return 0;

  let score = 0;
  for (const term of q) {
    const exact = haystack.includes(term);
    const prefix = !exact && haystack.some((h) => h.startsWith(term));
    if (!exact && !prefix) return 0; // every typed word has to land somewhere
    score += exact ? 10 : 6;
  }

  // Prefer the tightest match: whole-phrase hits, then short names.
  if (name.includes(query.trim().toLowerCase())) score += 12;
  if (name.startsWith(query.trim().toLowerCase())) score += 8;
  if (entry.number && q.includes(String(entry.number).toLowerCase())) score += 15;
  score -= Math.min(haystack.length, 12) * 0.4;
  return score;
}

/** Rank catalogue rows for a query. `limit` keeps the dropdown usable. */
export function searchEntries(query, entries, limit = 25) {
  if (!query || query.trim().length < 2) return [];
  const scored = [];
  for (const entry of entries) {
    const score = scoreEntry(query, entry);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, limit).map((s) => s.entry);
}

/** Free-text filter across a collection, used by the collection and wishlist views. */
export function filterItems(items, { text = '', status = '', license = '', series = '', category = '' } = {}) {
  const q = text.trim().toLowerCase();
  return items.filter((item) => {
    if (status && item.status !== status) return false;
    if (license && item.license !== license) return false;
    if (series && item.series !== series) return false;
    if (category && item.category !== category) return false;
    if (!q) return true;
    const hay = [item.name, item.license, item.series, item.number, item.exclusive, item.notes]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return q.split(/\s+/).every((term) => hay.includes(term));
  });
}
