# Contributing

Two kinds of help are useful here, and one of them needs no programming at all.

## Adding something to the catalogue

The catalogue is `data/catalog.json`. It is stored one item per line specifically
so that adding a figure is a one-line change anyone can read.

If you would rather not touch a file at all, [open an
issue](https://github.com/TheAgencyMGE/shelfledger/issues/new?template=missing-item.yml)
with what you know and someone will add it. That is a completely fine way to
contribute and it is the fastest route if you are not comfortable with git.

To send it yourself, on github.com:

1. Open `data/catalog.json` and press the pencil icon to edit.
2. Find roughly where your item belongs, entries are sorted by item number.
3. Add one line, matching the format of its neighbours, remembering the comma at
   the end of the previous line.
4. Describe what you added and press "Propose changes".

One line looks like this:

```json
{"id":"funko-93125","name":"Pop! Batman Beyond","number":"93125","category":"funko-pop","license":"DC Comics","series":"Pop! Heroes","variant":null,"barcodes":["889698931250"],"verified":true,"url":"https://funko.com/pop-batman-beyond/93125.html"}
```

| Field       | What goes in it                                                                     |
| ----------- | ----------------------------------------------------------------------------------- |
| `id`        | `funko-<number>` for Funko items, or anything unique for other manufacturers          |
| `name`      | The name as printed on the box                                                        |
| `number`    | The item number on the box, as a string                                               |
| `category`  | `funko-pop`, `action-figure`, `anime-figure`, `statue`, or `other`                     |
| `license`   | The fandom or property, e.g. `DC Comics`. `null` if you are not sure                   |
| `series`    | The line, e.g. `Pop! Heroes`. `null` if you are not sure                                |
| `variant`   | Chase, glow, flocked, exclusive details. `null` if it is the plain release             |
| `barcodes`  | Array of barcode numbers as strings. This is what makes scanning find it               |
| `verified`  | `true` if you have the box in front of you. See below                                  |
| `url`       | A public listing that backs up the details, or `null`                                  |

### About `verified`

Most of the catalogue was seeded from public product listings, and around 19,000
of those entries had their name derived from a product URL rather than read off
a box. Those are marked `"verified": false`. The name is usually right and
occasionally slightly off, a missing hyphen, a dropped apostrophe, a
parenthetical that got flattened.

If you own the item and the name in the file does not match the box, fix the
name and set `"verified": true`. That is one of the most useful contributions
you can make, and it is genuinely a one-line diff.

**Barcodes are the biggest gap.** The seed data has almost none, because they are
not published anywhere machine-readable. Every barcode added makes scanning work
for one more figure.

## Working on the app

```bash
git clone https://github.com/TheAgencyMGE/shelfledger.git
cd shelfledger
npm run build     # writes dist/
npm run serve     # http://localhost:8787/shelfledger/
npm run check     # lint + tests + build, the same as CI
```

There are no dependencies to install. The app ships no runtime packages, and the
build, tests, and scrapers use nothing outside the Node standard library. You
need Node 20 or newer.

### The one rule

**No user data leaves the browser, ever.** There is no backend, no account, and
no telemetry, and there is not going to be. Concretely, a change will be
rejected if it:

- sends anything a person typed to any server;
- adds analytics, error reporting, or usage measurement of any kind, including
  the self-hosted and privacy-branded ones;
- loads a script, stylesheet, font, or image from a third-party domain;
- introduces a login, an account, or server-side storage.

`npm run lint` enforces most of this mechanically and CI runs it against both
the source and the built output, so an accidental CDN font fails the build
rather than shipping.

If a feature seems to need a server, it probably has a version that works with
export and import instead. That is how sync works, and it is how calendar
reminders work.

### Layout

```
src/layout.html          the page shell every page is built into
src/pages/*.html         one file per page, with its metadata at the top
src/assets/js/           app code, plain ES modules, no framework
src/assets/js/pages/     the entry point for each page
src/sw.js                offline caching
scripts/build.mjs        assembles dist/
scripts/lint.mjs         syntax and privacy checks
scripts/scrape-releases.mjs   the daily release calendar job
scripts/seed-catalog.mjs      one-off catalogue seeding
data/                    catalog.json and releases.json
test/                    node:test, no framework
```

The logic worth testing lives in DOM-free modules (`model.js`, `search.js`,
`match.js`, `ics.js`, `backup-format.js`) so it can be tested directly under
`node --test`. Keep it that way where you can.

### Touching the backup format

`backup-format.js` handles the only copy of somebody's collection that exists
outside their browser. Changes there need a test proving a file written by the
old version still imports, and that export and import round-trip unchanged.

## Scraping etiquette

The release job reads someone else's public pages. If you change it, keep all of
this true: an honest `User-Agent` with a link to the project, `robots.txt`
respected, at most one run a day, and no per-product requests. The category
pages publish structured data precisely so that one request gets everything 
use it.
