/**
 * The source registry.
 *
 * Two kinds of source. Manufacturers are authoritative about what a product is.
 * Retailers are authoritative about what is happening to it: price, stock, and
 * crucially the date it was listed, which is the only honest basis for calling
 * something newly announced.
 *
 * Adding one means writing an adapter next to this file and listing it here. An
 * adapter reads listing pages only. If a source cannot be read from listings
 * without query strings its robots.txt disallows, it does not go in.
 *
 * UNSUPPORTED is the other half of the contract and is deliberately code rather
 * than prose in a README. Nothing here is stubbed out with invented data.
 */

import * as funko from './funko.mjs';
import * as mezco from './mezco.mjs';
import * as tamashii from './tamashii.mjs';
import * as entertainmentEarth from './entertainment-earth.mjs';
import * as bigbadtoystore from './bigbadtoystore.mjs';

/** Retailers run first so their listing dates win ties during the merge. */
export const SOURCES = [entertainmentEarth, bigbadtoystore, funko, mezco, tamashii];

export const UNSUPPORTED = [
  {
    id: 'hasbro-pulse',
    label: 'Hasbro Pulse (direct)',
    lines: ['Marvel Legends', 'Star Wars The Black Series', 'G.I. Joe Classified', 'Transformers'],
    reason:
      'The storefront is a client rendered single page app, so listings do not exist in the HTML that is served, and what sits behind it is a private commerce API rather than a public feed.',
    coveredVia: 'Entertainment Earth carries these lines, so they do appear on the radar.',
    revisitIf: 'Hasbro server renders its category pages or publishes a feed.',
  },
  {
    id: 'neca-direct',
    label: 'NECA (direct)',
    lines: ['NECA action figures'],
    reason:
      'necaonline.com/robots.txt disallows /products/ and /productlist/ for every crawler, which is where the listings live.',
    coveredVia: 'Entertainment Earth lists NECA, so those products still reach the radar.',
    revisitIf: 'NECA relaxes those rules or publishes a feed outside those paths.',
  },
  {
    id: 'mcfarlane-direct',
    label: 'McFarlane Toys (direct)',
    lines: ['DC Multiverse', 'Warhammer 40,000'],
    reason:
      'The site is a marketing showcase with no server rendered product data, no prices, and a sitemap that returns 404.',
    coveredVia: 'Entertainment Earth lists McFarlane, so those products still reach the radar.',
    revisitIf: 'McFarlane adds a store or a product feed.',
  },
  {
    id: 'sideshow',
    label: 'Sideshow and Hot Toys',
    lines: ['Hot Toys Movie Masterpiece', 'Sideshow Collectibles'],
    reason:
      'Every request is redirected into a virtual waiting room queue before a page is served. Working around that would mean evading a system built to control traffic.',
    coveredVia: null,
    revisitIf: 'The queue is removed or a feed is published outside it.',
  },
  {
    id: 'medicom',
    label: 'Medicom (direct)',
    lines: ['MAFEX'],
    reason:
      'The Medicom store publishes no product sitemap and its product endpoint returns nothing, so there is no listing to read.',
    coveredVia: 'MAFEX appears when a covered retailer lists it.',
    revisitIf: 'Medicom publishes products through its store feed.',
  },
  {
    id: 'bbts-filtered',
    label: 'BigBadToyStore (filtered views)',
    lines: ['Featured preorders', 'New arrivals'],
    reason:
      'bigbadtoystore.com/robots.txt allows /Search but disallows /Search?* , and every sorted or filtered listing is a query string on that path. The single unparameterised listing is read instead, which is why BBTS contributes a small number of rows.',
    coveredVia: 'The unfiltered BigBadToyStore listing is read.',
    revisitIf: 'BBTS exposes a crawlable listing without query parameters.',
  },
];

/** The shape published in releases.json so the site can show the gaps. */
export function unsupportedForOutput() {
  return UNSUPPORTED.map(({ id, label, lines, reason, coveredVia }) => ({
    id,
    label,
    lines,
    reason,
    coveredVia: coveredVia ?? null,
  }));
}
