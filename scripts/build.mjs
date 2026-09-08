/**
 * Builds the static site into dist/.
 *
 * Three jobs:
 *   1. Assemble each page in src/pages/ into the shared shell in src/layout.html.
 *   2. Copy static assets, and turn the contributor-friendly data/catalog.json
 *      into small column-oriented shards the browser actually downloads.
 *   3. Generate sitemap.xml and stamp a cache version into the service worker.
 *
 * GitHub Pages project sites live under /<repo>/, so every path in the output
 * runs through {{base}}. Set SITE_BASE=/ for a custom domain.
 */
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeFeeds } from './feeds.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'data');

const BASE = normaliseBase(process.env.SITE_BASE ?? '/shelfledger/');
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://theagencymge.github.io').replace(/\/$/, '');

function normaliseBase(b) {
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b;
}

/** Pull the leading <!--@ {json} @--> block off a page file. */
function parseFrontMatter(raw, file) {
  const m = raw.match(/^\s*<!--@([\s\S]*?)@-->\s*/);
  if (!m) throw new Error(`${file}: missing <!--@ ... @--> front matter block`);
  let meta;
  try {
    meta = JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`${file}: front matter is not valid JSON: ${err.message}`);
  }
  for (const key of ['route', 'title', 'description', 'nav']) {
    if (!meta[key]) throw new Error(`${file}: front matter is missing "${key}"`);
  }
  return { meta, body: raw.slice(m[0].length) };
}

function applyTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (!(key in vars)) throw new Error(`template placeholder {{${key}}} has no value`);
    return vars[key];
  });
}

/** Where a route's index.html goes, and its public URL. */
function routeToOutput(route) {
  const clean = route.replace(/^\/|\/$/g, '');
  return {
    file: clean ? path.join(DIST, clean, 'index.html') : path.join(DIST, 'index.html'),
    url: `${ORIGIN}${BASE}${clean ? clean + '/' : ''}`,
  };
}

const NAV_ITEMS = [
  { id: 'radar', route: '', label: 'Radar', primary: true },
  { id: 'sources', route: 'sources/', label: 'Sources' },
  { id: 'about', route: 'about/', label: 'About' },
];

function navMarkup(current) {
  return NAV_ITEMS.map((item) => {
    const active = item.id === current;
    const attrs = [
      `href="${BASE}${item.route}"`,
      active ? 'aria-current="page"' : '',
      item.primary ? 'class="nav-primary"' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `        <li><a ${attrs}>${item.label}</a></li>`;
  }).join('\n');
}

function structuredData(meta, url) {
  if (meta.route === '/') {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'ShelfLedger',
      url,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any device with a modern web browser',
      browserRequirements: 'Requires JavaScript and IndexedDB.',
      description: meta.description,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://opensource.org/licenses/MIT',
      featureList: [
        'Daily feed of new announcements, preorders, restocks and releases',
        'Covers manufacturers and retailers in one merged view',
        'Filter by manufacturer, line, franchise, seller, date and price',
        'Every filtered view has its own shareable URL',
        'RSS, JSON feed, CSV and calendar export',
        'No account, no analytics, no tracking',
      ],
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    url,
    description: meta.description,
    isPartOf: { '@type': 'WebSite', name: 'ShelfLedger', url: `${ORIGIN}${BASE}` },
  };
}

async function buildPages() {
  const layout = await readFile(path.join(SRC, 'layout.html'), 'utf8');
  const files = (await readdir(path.join(SRC, 'pages'))).filter((f) => f.endsWith('.html')).sort();
  const built = [];

  for (const file of files) {
    const raw = await readFile(path.join(SRC, 'pages', file), 'utf8');
    const { meta, body } = parseFrontMatter(raw, file);
    const { file: outFile, url } = routeToOutput(meta.route);

    const scripts = (meta.scripts ?? [])
      .map((s) => `    <script type="module" src="${BASE}assets/js/${s}"></script>`)
      .join('\n');

    const html = applyTemplate(layout, {
      base: BASE,
      title: meta.title,
      description: meta.description,
      canonical: url,
      ogImage: `${ORIGIN}${BASE}assets/icons/og-image.png`,
      nav: navMarkup(meta.nav),
      scripts,
      body,
      jsonld: JSON.stringify(structuredData(meta, url)),
      year: String(new Date().getUTCFullYear()),
    });

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, html);
    built.push({ ...meta, url });
  }
  return built;
}

async function buildSitemap(pages) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = pages
    .map((p) => `  <url>\n    <loc>${p.url}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`)
    .join('\n');
  await writeFile(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
  await writeFile(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}${BASE}sitemap.xml\n`,
  );
}

async function collectFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(full)));
    else out.push(full);
  }
  return out;
}

/**
 * The service worker precaches by URL, so it needs the real base path and a
 * version string that changes whenever any shipped file changes.
 */
async function finaliseServiceWorker(pages) {
  const swPath = path.join(DIST, 'sw.js');
  let sw = await readFile(swPath, 'utf8');
  const files = await collectFiles(DIST);
  const hash = createHash('sha256');
  for (const f of files.sort()) {
    if (f.endsWith('sw.js')) continue;
    hash.update(path.relative(DIST, f).replaceAll('\\', '/'));
    hash.update(await readFile(f));
  }
  const version = hash.digest('hex').slice(0, 12);

  // Precache the whole shell so a cold offline load works. The catalogue
  // shards are deliberately left out, they are megabytes, and the runtime
  // cache picks them up the first time someone actually searches.
  const shellAssets = files
    .map((f) => path.relative(DIST, f).replaceAll('\\', '/'))
    .filter(
      (rel) =>
        rel.startsWith('assets/') &&
        !rel.endsWith('.map') &&
        /\.(css|js|svg|png|ico|webmanifest)$/.test(rel),
    )
    .map((rel) => `${BASE}${rel}`);

  const precache = [
    BASE,
    ...pages.filter((p) => p.route !== '/').map((p) => `${BASE}${p.route.replace(/^\//, '')}`),
    ...shellAssets,
    `${BASE}manifest.webmanifest`,
    `${BASE}data/releases.json`,
  ];

  sw = sw
    .replace('__SL_VERSION__', version)
    .replace('__SL_BASE__', BASE)
    .replace('"__SL_PRECACHE__"', JSON.stringify(precache, null, 2));
  await writeFile(swPath, sw);
  return version;
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  await cp(path.join(SRC, 'assets'), path.join(DIST, 'assets'), { recursive: true });
  for (const f of ['manifest.webmanifest', 'sw.js']) {
    let text = await readFile(path.join(SRC, f), 'utf8');
    if (f === 'manifest.webmanifest') text = text.replaceAll('{{base}}', BASE);
    await writeFile(path.join(DIST, f), text);
  }

  const pages = await buildPages();
  console.log(`  pages     ${pages.length}`);

  await mkdir(path.join(DIST, 'data'), { recursive: true });
  if (existsSync(path.join(DATA, 'releases.json'))) {
    await cp(path.join(DATA, 'releases.json'), path.join(DIST, 'data', 'releases.json'));
  }
  const releasesFile = path.join(DIST, 'data', 'releases.json');
  if (existsSync(releasesFile)) {
    const payload = JSON.parse(await readFile(releasesFile, 'utf8'));
    const { written, manifest } = await writeFeeds(DIST, payload.releases ?? [], {
      siteUrl: `${ORIGIN}${BASE}`,
      generatedAt: payload.generatedAt ?? new Date().toISOString(),
    });
    console.log(`  feeds     ${written.length} files, ${manifest.length} facet feeds`);
  } else {
    console.warn('  ! data/releases.json not found, skipping feeds');
  }

  await buildSitemap(pages);
  const version = await finaliseServiceWorker(pages);
  console.log(`  base      ${BASE}`);
  console.log(`  sw        ${version}`);
  console.log('build ok');
}

main().catch((err) => {
  console.error('build failed:', err.message);
  process.exit(1);
});
