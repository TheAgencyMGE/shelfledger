/**
 * Cross-references the public release feed against a wishlist.
 *
 * This runs in the browser, on data the browser already has. The release file
 * is public and identical for everyone; which entries light up is worked out
 * locally and never sent anywhere.
 */

import { tokenSimilarity, significantTokens } from './search.js';

/** Below this Dice score two names are not the same figure. */
export const DEFAULT_THRESHOLD = 0.6;

function sameNumber(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/\D/g, '') === String(b).replace(/\D/g, '');
}

/**
 * Compare one wanted item to one release.
 * Returns { score, reason } or null when they are unrelated.
 */
export function matchOne(item, release, threshold = DEFAULT_THRESHOLD) {
  // An item number is an exact identifier, trust it over any name similarity.
  if (sameNumber(item.number, release.sku)) return { score: 1, reason: 'number' };
  if (item.catalogId && release.id && item.catalogId === release.id) {
    return { score: 1, reason: 'number' };
  }

  const score = tokenSimilarity(item.name, release.name);
  if (score >= threshold) return { score, reason: 'name' };

  // A short, specific wishlist entry ("Rhysand") should still catch a longer
  // release title that fully contains it.
  const itemTokens = significantTokens(item.name);
  const releaseTokens = new Set(significantTokens(release.name));
  if (itemTokens.length >= 1 && itemTokens.every((t) => releaseTokens.has(t))) {
    return { score: Math.max(score, 0.75), reason: 'contains' };
  }
  return null;
}

/**
 * Annotate every release with its best wishlist match, if any.
 * `wants` should already be filtered to status === 'want'.
 */
export function matchReleases(releases, wants, threshold = DEFAULT_THRESHOLD) {
  return releases.map((release) => {
    let best = null;
    for (const item of wants) {
      const hit = matchOne(item, release, threshold);
      if (hit && (!best || hit.score > best.score)) {
        best = { ...hit, itemId: item.id, itemName: item.name };
      }
    }
    return best ? { ...release, match: best } : { ...release, match: null };
  });
}
