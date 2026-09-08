/**
 * Product identity: deciding when two listings are the same figure.
 *
 * The same figure shows up at Entertainment Earth, BigBadToyStore and the
 * manufacturer, under three slightly different titles. This module turns those
 * into comparable keys so the radar shows one release with several places to
 * buy it, instead of three near-identical rows.
 *
 * Plain ES module with no imports, so the browser and the scraper both use the
 * exact same rules. If these two ever diverge, the merge is wrong.
 */

/** Retailer SKU prefixes map to the manufacturer's own item number. */
const SKU_PREFIX = /^([a-z]{2,4})(\d{3,})([a-z]?)$/i;

/** Words that carry no identity: packaging, format and marketing noise. */
const NOISE = new Set([
  'action', 'figure', 'figures', 'vinyl', 'collectible', 'collectable',
  'exclusive', 'edition', 'version', 'ver', 'the', 'a', 'an', 'and', 'of',
  'with', 'in', 'for', 'inch', 'inches', 'scale', 'set', 'pack', 'series',
  'previews', 'entertainment', 'earth', 'toy', 'toys', 'new', 'official',
  'licensed', 'collection', 'statue', 'figurine', 'model', 'kit',
]);

/** Trailing size and packaging phrases that differ between retailers. */
const TRAILING_NOISE = [
  /\b\d+(\.\d+)?\s*[-]?\s*inch(es)?\b/gi,
  /\b1[:/]\d+\s*scale\b/gi,
  /\bcase of \d+\b/gi,
  /\bpack of \d+\b/gi,
  /\b\d+\s*[-]?\s*pack\b/gi,
  /\bnot final product\b/gi,
  /\bentertainment earth exclusive\b/gi,
  /\bpreviews exclusive\b/gi,
];

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normaliseText(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Manufacturers name themselves differently everywhere. "Bandai Tamashii
 * Nations", "Tamashii Nations" and "Bandai Spirits" are one company as far as
 * matching is concerned.
 */
const MAKER_ALIASES = new Map(
  Object.entries({
    'bandai tamashii nations': 'bandai',
    'tamashii nations': 'bandai',
    'bandai spirits': 'bandai',
    'bandai namco': 'bandai',
    'bluefin tamashii nations': 'bandai',
    'mcfarlane toys': 'mcfarlane',
    'mezco toyz': 'mezco',
    'mezco toys': 'mezco',
    'hasbro toys': 'hasbro',
    'super 7': 'super7',
    'jada toys': 'jada',
    'neca reel toys': 'neca',
    'diamond select toys': 'diamond select',
    'good smile company': 'good smile',
    'sideshow collectibles': 'sideshow',
    'hot toys': 'hot toys',
    'medicom toy': 'medicom',
    'threezero': 'threezero',
    'three zero': 'threezero',
  }),
);

export function normaliseMaker(value) {
  const base = normaliseText(value);
  if (!base) return '';
  return MAKER_ALIASES.get(base) ?? base;
}

/**
 * Retailer SKUs usually embed the manufacturer's item number: Entertainment
 * Earth lists a Funko Pop as FU99383 where Funko calls it 99383. Pulling the
 * digits out gives a key both sides can agree on.
 */
export function skuDigits(sku) {
  if (!sku) return '';
  const raw = String(sku).trim();
  const match = raw.match(SKU_PREFIX);
  const digits = match ? match[2] : raw.replace(/\D/g, '');
  // Very short numbers collide constantly, so they are not identity.
  return digits.length >= 4 ? digits.replace(/^0+/, '') : '';
}

/** The identity-bearing words of a title, in sorted order. */
export function titleTokens(name) {
  let text = String(name ?? '');
  for (const pattern of TRAILING_NOISE) text = text.replace(pattern, ' ');
  const tokens = normaliseText(text)
    .split(' ')
    .filter((word) => word && !NOISE.has(word) && word.length > 1);
  return [...new Set(tokens)].sort();
}

/**
 * The keys a listing can be matched on. Two listings are the same product when
 * they share any key. Returned most-trustworthy first.
 */
export function identityKeys(listing) {
  const keys = [];
  const maker = normaliseMaker(listing.manufacturer);
  const digits = skuDigits(listing.sku);

  // An item number scoped to its manufacturer is the strongest signal.
  if (maker && digits) keys.push(`sku:${maker}:${digits}`);

  // Titles need enough distinct words to be identity. Two words matches
  // things like "-STORE LIMITED EDITION-" across completely different figures.
  const tokens = titleTokens(listing.name);
  if (maker && tokens.length >= 3) keys.push(`title:${maker}:${tokens.join('-')}`);
  return keys;
}

/** Canonical display name for a manufacturer, so filters group properly. */
const MAKER_DISPLAY = new Map(
  Object.entries({
    bandai: 'Bandai Tamashii Nations',
    mcfarlane: 'McFarlane Toys',
    mezco: 'Mezco Toyz',
    neca: 'NECA',
    hasbro: 'Hasbro',
    mattel: 'Mattel',
    funko: 'Funko',
    super7: 'Super7',
    jada: 'Jada Toys',
    medicom: 'Medicom',
    'good smile': 'Good Smile Company',
    'diamond select': 'Diamond Select Toys',
    'hot toys': 'Hot Toys',
    threezero: 'threezero',
    sideshow: 'Sideshow',
  }),
);

export function displayMaker(value) {
  const key = normaliseMaker(value);
  if (!key) return null;
  const known = MAKER_DISPLAY.get(key);
  if (known) return known;
  // Keep the source's own capitalisation when we have no opinion.
  return String(value).trim();
}

/**
 * Group listings that share any identity key, using union-find so a chain of
 * partial matches still collapses into one product.
 */
export function groupListings(listings) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Collect first, then decide. A key that matches two products from the same
  // source is describing a shared phrase, not an identity: one source has
  // already deduplicated itself, so two of its rows are two different figures.
  const byKey = new Map();
  for (const listing of listings) {
    if (!parent.has(listing.id)) parent.set(listing.id, listing.id);
    for (const key of identityKeys(listing)) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(listing);
    }
  }

  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const perSource = new Set();
    const ambiguous = group.some((l) => {
      if (perSource.has(l.sourceId)) return true;
      perSource.add(l.sourceId);
      return false;
    });
    if (ambiguous) continue;
    for (let i = 1; i < group.length; i += 1) union(group[0].id, group[i].id);
  }

  const groups = new Map();
  for (const listing of listings) {
    const root = find(listing.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(listing);
  }
  return [...groups.values()];
}
