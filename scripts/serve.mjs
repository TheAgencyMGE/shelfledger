/**
 * A static file server for local development.
 *
 * It reads the base path out of the built index.html and mounts dist/ there, so
 * what you test locally is byte-for-byte what GitHub Pages will serve, the
 * base path is the one thing most likely to differ otherwise.
 *
 * Serves on localhost, which browsers treat as a secure context, so the service
 * worker and the camera both work.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8787);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
};

async function detectBase() {
  try {
    const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
    return html.match(/data-base="([^"]+)"/)?.[1] ?? '/';
  } catch {
    console.error('dist/ is missing or empty. Run `npm run build` first.');
    process.exit(1);
  }
}

const BASE = await detectBase();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  if (BASE !== '/' && !pathname.startsWith(BASE)) {
    if (pathname === BASE.slice(0, -1) || pathname === '/') {
      res.writeHead(302, { Location: BASE });
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Not found. This build is mounted at ${BASE}\n`);
    return;
  }

  const relative = pathname.slice(BASE.length) || '';
  let file = path.join(DIST, relative);

  // Block anything trying to climb out of dist/.
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': BASE,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>404</title><p>Not found.</p>');
  }
});

server.listen(PORT, () => {
  console.log(`ShelfLedger dev server → http://localhost:${PORT}${BASE}`);
});
