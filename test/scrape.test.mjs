/**
 * Parsing tests for the release scraper. These run against fixed strings, not
 * the network, CI must never depend on someone else's site being up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDropDate, parseDropBadges } from '../scripts/scrape-releases.mjs';
import { nameFromSlug, categoryFromSlug, licenceFromCategoryPath } from '../scripts/seed-catalog.mjs';

const SEP_2026 = new Date('2026-09-08T00:00:00Z');

test('a drop date near today keeps the current year', () => {
  assert.equal(resolveDropDate('Sep', '08', SEP_2026), '2026-09-08');
  assert.equal(resolveDropDate('Oct', '15', SEP_2026), '2026-10-15');
});

test('a drop months behind stays in the past, rather than jumping a year ahead', () => {
  // The page lists drops that already happened. "Apr 10" seen in September is
  // this April, not next April.
  assert.equal(resolveDropDate('Apr', '10', SEP_2026), '2026-04-10');
  assert.equal(resolveDropDate('Jan', '05', SEP_2026), '2026-01-05');
});

test('a date too far ahead belongs to last year', () => {
  // Seen in September, "Feb 01" is five months out, too far for a drop
  // calendar, so it is the February that has been and gone.
  assert.equal(resolveDropDate('Feb', '01', SEP_2026), '2026-02-01');
});

test('January dates seen in late December roll into the new year', () => {
  const lateDecember = new Date('2026-12-28T00:00:00Z');
  assert.equal(resolveDropDate('Jan', '05', lateDecember), '2027-01-05');
});

test('nonsense dates are rejected rather than guessed at', () => {
  assert.equal(resolveDropDate('Xxx', '10', SEP_2026), null);
  assert.equal(resolveDropDate('Apr', '31', SEP_2026), null, 'April has 30 days');
  assert.equal(resolveDropDate('Sep', '0', SEP_2026), null);
  assert.equal(resolveDropDate('Sep', '99', SEP_2026), null);
});

/** A trimmed copy of the real limited-edition tile markup. */
const TILE = `
<div class="loyalty-exclusive-stamp-badge">
  <div class="availability-badge text-center d-none">
    <div class="loyalty-exclusive-start-date d-none">
      <div class="ss-month text-uppercase">Sep</div>
      <div class="ss-day font-weight-bold">08</div>
    </div>
    <div class="ss-available-qty font-weight-bold">1,200</div>
    <div class="ss-available-label text-uppercase">
      Pieces
    </div>
  </div>
</div>
<div class="image-container">
  <a href="https://funko.com/pop-grid-xenomorph-glow/93416.html" class="image-link">img</a>
</div>
`;

test('drop badges bind the date and run size to the right item number', () => {
  const badges = parseDropBadges(TILE, SEP_2026);
  assert.equal(badges.size, 1);
  assert.deepEqual(badges.get('93416'), { releaseDate: '2026-09-08', limitedRunSize: 1200 });
});

test('a badge counting something other than pieces is not a run size', () => {
  const notPieces = TILE.replace('Pieces', 'Days');
  const badges = parseDropBadges(notPieces, SEP_2026);
  assert.equal(badges.get('93416').limitedRunSize, undefined);
  assert.equal(badges.get('93416').releaseDate, '2026-09-08');
});

test('markup with no badges yields nothing rather than throwing', () => {
  assert.equal(parseDropBadges('<html><body>nothing here</body></html>').size, 0);
  assert.equal(parseDropBadges('').size, 0);
});

/* --------------------------------------------------------- catalogue seed */

test('slugs turn back into readable names', () => {
  assert.equal(nameFromSlug('pop-batman-beyond'), 'Pop! Batman Beyond');
  assert.equal(nameFromSlug('pop-chun-li-2026'), 'Pop! Chun Li 2026');
  assert.equal(nameFromSlug('dc-super-heroes'), 'DC Super Heroes');
  assert.equal(nameFromSlug('five-nights-at-freddys'), 'Five Nights at Freddys');
});

test('categories are guessed from the slug', () => {
  assert.equal(categoryFromSlug('pop-batman-beyond'), 'funko-pop');
  assert.equal(categoryFromSlug('bitty-pop-marvel'), 'funko-pop');
  assert.equal(categoryFromSlug('loungefly-mini-backpack'), 'other');
});

test('licences come from the fandom path, tidied up', () => {
  assert.equal(licenceFromCategoryPath('/fandoms/anime-manga/one-piece/'), 'One Piece');
  assert.equal(licenceFromCategoryPath('/fandoms/video-games/pokemon/'), 'Pokémon');
  assert.equal(licenceFromCategoryPath('/fandoms/comics-superheroes/x-men/'), 'X-Men');
  assert.equal(licenceFromCategoryPath('/fandoms/'), null, 'the top level is not a licence');
  assert.equal(licenceFromCategoryPath('/new-featured/new-releases/'), null);
});
