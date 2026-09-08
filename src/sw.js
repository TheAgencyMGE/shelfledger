/**
 * Offline support.
 *
 * The build stamps in a version hash, the base path, and the precache list, so
 * a deploy that changes any shipped file gets a fresh cache automatically.
 *
 * This worker only ever touches requests to its own origin. It has no push
 * subscription, no background sync, and no way to send anything anywhere.
 */

const VERSION = '__SL_VERSION__';
const BASE = '__SL_BASE__';
const PRECACHE = "__SL_PRECACHE__";

const SHELL_CACHE = `shelfledger-shell-${VERSION}`;
const DATA_CACHE = `shelfledger-data-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const [shell, data] = await Promise.all([caches.open(SHELL_CACHE), caches.open(DATA_CACHE)]);

      // Each URL has to land in the cache the fetch handler will look in, or it
      // is precached and still unreachable offline.
      await Promise.all(
        PRECACHE.map((url) => {
          const cache = url.startsWith(`${BASE}data/`) ? data : shell;
          return cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            // One unreachable URL should not fail the whole install.
            console.warn('[sw] could not precache', url, err);
          });
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, DATA_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith('shelfledger-') && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** Serve the cached copy, and quietly refresh it for next time. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await network) ?? Response.error();
}

/** Fresh if possible, cached if not. Used for pages so deploys land quickly. */
async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request)) ?? (fallbackUrl && (await cache.match(fallbackUrl)));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><p>ShelfLedger is offline and this page was never cached. Reconnect once and it will work offline afterwards.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // nothing else should exist

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, BASE));
    return;
  }

  if (url.pathname.startsWith(`${BASE}data/`)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (url.pathname.startsWith(`${BASE}assets/`)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});
