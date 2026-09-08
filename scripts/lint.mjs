/**
 * Checks that CI runs before anything is allowed to deploy.
 *
 * The syntax pass is ordinary. The privacy pass is the point: the promise this
 * project makes is architectural, so it should be checked by a machine on every
 * push rather than trusted to code review. If someone adds a font from a CDN or
 * an analytics snippet, this fails and the deploy stops.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');

const problems = [];
const notes = [];

function fail(file, message) {
  problems.push(`${path.relative(ROOT, file).replaceAll('\\', '/')}: ${message}`);
}

async function walk(dir, filter) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, filter)));
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------ syntax */

async function checkSyntax() {
  const files = [
    ...(await walk(path.join(ROOT, 'src'), (n) => n.endsWith('.js'))),
    ...(await walk(path.join(ROOT, 'scripts'), (n) => n.endsWith('.mjs'))),
    ...(await walk(path.join(ROOT, 'test'), (n) => n.endsWith('.mjs'))),
  ].filter((f) => !f.includes(`${path.sep}vendor${path.sep}`));

  for (const file of files) {
    try {
      await run(process.execPath, ['--check', file]);
    } catch (err) {
      fail(file, `syntax error\n${err.stderr?.split('\n').slice(0, 4).join('\n')}`);
    }
  }
  notes.push(`${files.length} JavaScript files parsed`);
}

/* ------------------------------------------------------------ privacy */

/**
 * Hosts allowed to appear as plain links a person can click. Loading a
 * subresource from any of them would still be a failure, that is checked
 * separately below.
 *
 * The site's own origin is in here because canonical and og:url tags are
 * absolute by definition; pointing at ourselves is not a third-party request.
 */
const SITE_HOST = safeHost(process.env.SITE_ORIGIN ?? 'https://theagencymge.github.io');

const LINKABLE_HOSTS = [
  SITE_HOST,
  'github.com',
  'funko.com',
  'schema.org',
  'opensource.org',
  'www.w3.org',
].filter(Boolean);

const TRACKER_HINTS = [
  'google-analytics',
  'googletagmanager',
  'gtag(',
  'analytics.js',
  'plausible.io',
  'fathom',
  'segment.com',
  'mixpanel',
  'hotjar',
  'facebook.net',
  'doubleclick',
  'sentry.io',
  'clarity.ms',
  'umami',
  'posthog',
];

/** Subresource loads: a script, stylesheet, image, font, or frame off-origin. */
const SUBRESOURCE_PATTERNS = [
  { re: /<script[^>]+src=["']https?:\/\//gi, what: 'a script loaded from another origin' },
  { re: /<link[^>]+href=["']https?:\/\/[^"']*["'][^>]*rel=["']?stylesheet/gi, what: 'an external stylesheet' },
  { re: /<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']https?:\/\//gi, what: 'an external stylesheet' },
  { re: /<img[^>]+src=["']https?:\/\//gi, what: 'an image loaded from another origin' },
  { re: /<iframe/gi, what: 'an iframe' },
  { re: /@import\s+(url\()?["']?https?:\/\//gi, what: 'an external CSS import' },
  { re: /url\(\s*["']?https?:\/\//gi, what: 'a CSS asset from another origin' },
  { re: /@font-face/gi, what: 'a webfont (this project uses system fonts only)' },
];

async function checkPrivacy(dir, label) {
  const files = await walk(dir, (n) => /\.(html|js|css|webmanifest)$/.test(n));
  let scanned = 0;

  for (const file of files) {
    if (file.includes(`${path.sep}vendor${path.sep}`)) continue; // reviewed separately
    const text = await readFile(file, 'utf8');
    scanned += 1;

    for (const { re, what } of SUBRESOURCE_PATTERNS) {
      const hit = text.match(re);
      if (hit) fail(file, `${what}: ${JSON.stringify(hit[0].slice(0, 80))}`);
    }

    for (const hint of TRACKER_HINTS) {
      if (text.includes(hint)) fail(file, `looks like tracking or telemetry: ${hint}`);
    }

    // Any absolute URL in a script is suspicious; in HTML it is probably a link.
    if (file.endsWith('.js')) {
      for (const match of text.matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)) {
        const host = safeHost(match[1]);
        if (host && !LINKABLE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
          fail(file, `absolute URL in script: ${match[1]}`);
        }
      }
      if (/fetch\(\s*["'`]https?:/.test(text)) fail(file, 'fetch() to an absolute URL');
    }

    if (file.endsWith('.html')) {
      for (const match of text.matchAll(/href=["'](https?:\/\/[^"']+)["']/g)) {
        const host = safeHost(match[1]);
        if (host && !LINKABLE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
          fail(file, `link to an unexpected host: ${host}`);
        }
      }
    }
  }
  notes.push(`${scanned} files scanned for outbound requests in ${label}`);
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ data files */

async function checkData() {
  for (const name of ['catalog.json', 'releases.json']) {
    const file = path.join(ROOT, 'data', name);
    if (!existsSync(file)) {
      notes.push(`data/${name} not present (skipped)`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      fail(file, `invalid JSON: ${err.message}`);
      continue;
    }
    const list = parsed.items ?? parsed.releases;
    if (!Array.isArray(list)) {
      fail(file, 'expected an "items" or "releases" array');
      continue;
    }
    const ids = new Set();
    for (const [index, entry] of list.entries()) {
      if (!entry?.name) fail(file, `entry ${index} has no name`);
      if (entry?.id) {
        if (ids.has(entry.id)) fail(file, `duplicate id ${entry.id}`);
        ids.add(entry.id);
      }
    }
    notes.push(`data/${name}: ${list.length} entries, ${ids.size} unique ids`);
  }
}

/* ------------------------------------------------------------ run */

const target = process.argv[2];
await checkSyntax();
await checkPrivacy(path.join(ROOT, 'src'), 'src');
if (target === '--dist' || existsSync(path.join(ROOT, 'dist'))) {
  await checkPrivacy(path.join(ROOT, 'dist'), 'dist');
}
await checkData();

for (const note of notes) console.log(`  ok    ${note}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  FAIL  ${problem}`);
  process.exit(1);
}
console.log('\nlint ok');
