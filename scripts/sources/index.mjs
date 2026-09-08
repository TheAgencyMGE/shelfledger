/**
 * The source registry.
 *
 * Adding a manufacturer means writing an adapter next to this file and listing
 * it in SOURCES. An adapter exports `meta` and a `collect()` that returns
 * `{ releases, visited }`, and it only ever reads listing pages. Per-product
 * requests are not allowed: if a source cannot be read from listings, it does
 * not go in.
 *
 * UNSUPPORTED is the other half of the contract, and it is deliberately in the
 * code rather than only in the README. These are manufacturers people ask for
 * that cannot currently be read, each with the concrete reason. Fixing one
 * means deleting its entry and adding an adapter. Nothing here is stubbed out
 * with invented data.
 */

import * as funko from './funko.mjs';
import * as mezco from './mezco.mjs';
import * as tamashii from './tamashii.mjs';

export const SOURCES = [funko, mezco, tamashii];

export const UNSUPPORTED = [
  {
    id: 'hasbro-pulse',
    label: 'Hasbro Pulse',
    lines: ['Marvel Legends', 'Star Wars The Black Series', 'G.I. Joe Classified', 'Transformers'],
    reason:
      'The storefront is a client rendered single page app, so product listings do not exist in the HTML that is served. The data behind it is a private commerce API, not a public feed.',
    revisitIf: 'Hasbro publishes a feed, or server renders its category pages.',
  },
  {
    id: 'neca',
    label: 'NECA',
    lines: ['NECA action figures'],
    reason:
      'necaonline.com/robots.txt disallows /products/ and /productlist/ for every crawler, which is where the listings live.',
    revisitIf: 'NECA relaxes those rules, or publishes a feed outside those paths.',
  },
  {
    id: 'mcfarlane',
    label: 'McFarlane Toys',
    lines: ['DC Multiverse', 'McFarlane action figures'],
    reason:
      'The site is a marketing showcase with no server rendered product data, no prices, and no working sitemap. There is nothing to read.',
    revisitIf: 'McFarlane adds a store or a product feed.',
  },
  {
    id: 'sideshow',
    label: 'Sideshow and Hot Toys',
    lines: ['Hot Toys', 'Sideshow Collectibles'],
    reason:
      'Every request is redirected into a virtual waiting room queue before any page is served. Working around that would mean evading a system built to control traffic.',
    revisitIf: 'The queue is removed, or a feed is published outside it.',
  },
  {
    id: 'mafex',
    label: 'MAFEX and Medicom',
    lines: ['MAFEX'],
    reason:
      'The Medicom store publishes no product sitemap and its product endpoint returns nothing, so there is no listing to read.',
    revisitIf: 'Medicom publishes products through its store feed.',
  },
];

/** Shape used in releases.json so the app can show what is not covered. */
export function unsupportedForOutput() {
  return UNSUPPORTED.map(({ id, label, lines, reason }) => ({ id, label, lines, reason }));
}
