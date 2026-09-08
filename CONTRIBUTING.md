# Contributing

The most useful thing anyone can do is add a source.

## Adding a source

A source is one file in `scripts/sources/` that exports `meta` and `collect()`,
plus one line in `scripts/sources/index.mjs`.

```js
export const meta = {
  id: 'example',
  label: 'Example Toys',
  kind: 'retailer',            // or 'manufacturer'
  homepage: 'https://example.com/',
  retailer: 'Example Shop',
};

export async function collect({ fetchText, allowed, sleep, delay, today, log }) {
  // return { releases, visited }
}
```

### The rules

These are not negotiable, because they are what keeps this welcome on other
people's servers.

- **Listing pages only.** Never request individual product pages. If a source
  cannot be read from listings, it does not go in.
- **Respect `allowed()`.** It is the robots.txt check for that host. Skip any
  path it rejects, and do not reach for a query string that robots.txt disallows
  just because it returns more rows.
- **Prefer structured data** the site already publishes, such as schema.org
  blocks or data attributes, over parsing prose.
- **Space requests out** with the `sleep(delay)` you are handed.
- **Fail loudly.** Throw rather than returning a half-built list. The
  orchestrator catches it, carries your source's previous rows forward, and
  reports the failure on the sources page.

### The rule about dates

This one has its own heading because getting it wrong is the bug that caused
this rework.

**Only set `listedDate` when the source actually published a date.** Some
retailers stamp a listing with the day it went up. That is a real announcement
and the radar will treat it as one. Most sources publish nothing of the kind,
and for those `listedDate` must stay `null`.

Never substitute the current date, and never use the fact that your adapter is
seeing a product for the first time. ShelfLedger records that separately as
`firstSeenByShelfLedger`, and the code that decides what is new does not read it.
A source that guesses will put years-old products under "just announced".

Set `listingKind` alongside it: `new-preorder`, `new-arrival` or `restock`.

### The release shape

Return objects with these fields so the merge does not need to know which source
a row came from. Copy an existing adapter; `entertainment-earth.mjs` is the most
complete and `bigbadtoystore.mjs` is the smallest.

| Field | Notes |
| ----- | ----- |
| `id` | Unique and stable, prefixed with your source id |
| `sourceId`, `sourceKind`, `retailer` | Who says so |
| `manufacturer`, `name`, `sku` | What it is. SKUs are used to match across sellers |
| `line`, `license`, `category` | Leave null rather than guessing |
| `price`, `currency`, `availability` | What is happening now |
| `listedDate`, `listingKind` | Only if published. See above |
| `releaseDate`, `releaseWindow`, `preorderDate`, `arrivalDate` | Whatever the source states |
| `limitedRunSize`, `exclusive` | If stated |
| `url` | The listing you read it from |

### Tests

Add parsing tests to `test/sources.test.mjs` against a fixed markup sample pasted
from the real page. Tests must never hit the network. Include a case proving a
listing with no date signal produces `listedDate: null`.

### If it cannot be done

Add an entry to `UNSUPPORTED` in `scripts/sources/index.mjs` with the concrete
reason and what would have to change. Do not stub it out with invented releases.
An honest gap is worth more than fake coverage, and the sources page renders that
list straight from the data.

## Working on the app

```bash
git clone https://github.com/TheAgencyMGE/shelfledger.git
cd shelfledger
npm run build
npm run serve       # http://localhost:8787/shelfledger/
npm run check       # lint, tests, build, the same as CI
npm run scrape      # refresh data/releases.json from live sources
npm run screenshots # regenerate README images, needs Chrome
```

Nothing to install. The app ships no runtime dependencies and the tooling uses
only the Node standard library. Node 20 or newer.

### The other rule

No accounts, no analytics, no client-side storage, no third-party requests. A
change will be rejected if it adds any of them. `npm run lint` enforces most of
it mechanically against both the source and the built output, so an accidental
CDN font fails the build rather than shipping.

Personalisation happens through the URL. If a feature seems to need somewhere to
save state, it probably wants a query parameter and a link.

### Layout

```
src/layout.html            the page shell
src/pages/*.html           one file per page, metadata at the top
src/assets/js/stages.js    which bucket a release belongs in
src/assets/js/identity.mjs deciding when two listings are the same figure
src/assets/js/lines.mjs    figure lines, matched against real titles
src/assets/js/url-state.js filters to and from the query string
scripts/sources/           one adapter per source
scripts/merge.mjs          listings become releases, and the date rules
scripts/feeds.mjs          RSS, JSON feed, CSV and calendar output
scripts/scrape-releases.mjs the daily orchestrator
scripts/lint.mjs           syntax and privacy checks
```

The logic worth testing lives in DOM-free modules so it can run directly under
`node --test`. Keep it that way.
