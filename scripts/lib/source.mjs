/**
 * Shared fetching helpers for the data scripts.
 *
 * Rules these enforce, so no individual script has to remember them:
 *   - identify the project honestly in the User-Agent, with a URL someone can
 *     visit to find out what this is and how to make it stop;
 *   - check robots.txt before requesting anything, and obey it;
 *   - leave a gap between requests;
 *   - never send anything but a plain GET.
 */

import { setTimeout as sleep } from 'node:timers/promises';

export const PROJECT_URL = 'https://github.com/TheAgencyMGE/shelfledger';
export const USER_AGENT = `ShelfLedgerBot/1.0 (+${PROJECT_URL}; open-source collection tracker; contact via GitHub issues)`;

/** Gap between requests to the same host. */
export const POLITE_DELAY_MS = 1500;

export async function fetchText(url, { timeout = 30000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(2000 * attempt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      // Only the User-Agent is set, deliberately.
      //
      // funko.com sits behind Cloudflare, and its bot rules reject a request
      // that carries an explicit `Accept: text/html,...` header while letting
      // the same request through with no Accept at all. Verified from a CI
      // runner: UA-only returned 200 on all five sources, and adding the Accept
      // header returned 403 every time, on the same IP in the same run.
      //
      // So: do not add Accept, Accept-Language, or Accept-Encoding here. The
      // User-Agent stays honest and identifying, the point is to be a
      // well-behaved bot that says who it is, not to look like a browser.
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return { text: await res.text(), url: res.url };
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Minimal robots.txt reader: collects Disallow rules that apply to us, which
 * on the sites we read means the `*` group. Returns a predicate.
 */
export async function robotsChecker(origin) {
  let rules = [];
  try {
    const { text } = await fetchText(`${origin}/robots.txt`, { retries: 1 });
    let applies = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const [rawKey, ...rest] = line.split(':');
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (key === 'user-agent') {
        applies = value === '*' || value.toLowerCase().includes('shelfledger');
      } else if (applies && key === 'disallow' && value) {
        rules.push(value);
      }
    }
  } catch {
    // No robots.txt, or it could not be read. Treat that as "no rules stated"
    // and rely on the once-a-day limit and the small number of URLs.
    rules = [];
  }

  /** robots.txt patterns support * and a trailing $. */
  const matchers = rules.map((pattern) => {
    const anchoredEnd = pattern.endsWith('$');
    const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
    const source = body
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${source}${anchoredEnd ? '$' : ''}`);
  });

  return function allowed(pathAndQuery) {
    return !matchers.some((re) => re.test(pathAndQuery));
  };
}

/** Every <script type="application/ld+json"> block on a page, parsed. */
export function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // A malformed block is the site's problem, not a reason to fail the run.
    }
  }
  return out;
}

/** Pull the Product entries out of an ItemList block. */
export function productsFromItemList(blocks) {
  const list = blocks.find((b) => b['@type'] === 'ItemList');
  if (!list || !Array.isArray(list.itemListElement)) return [];
  return list.itemListElement
    .map((entry) => entry?.item)
    .filter((item) => item && item['@type'] === 'Product');
}

export function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export { sleep };
