/**
 * Regenerates the README screenshots.
 *
 * A local authoring tool, like scripts/gen_icons.py. It needs Chrome installed;
 * CI never runs it, and the images it writes are committed.
 *
 *     npm run screenshots
 *
 * The demo collection is seeded into a throwaway copy of the build rather than
 * into the app, so no demo or seeding code ever ships. The screenshots are of
 * the real UI, with the real catalogue and the real release calendar, the only
 * thing invented is somebody's collection.
 */

import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const STAGE = path.join(ROOT, '.cache', 'screenshots');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 8899;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** A believable shelf: a few owned, a few wanted, one sold on. */
const DEMO_ITEMS = [
  { name: 'Pop! Pikachu (Flocked)', number: '59873', license: 'Pokémon', series: 'Pop! Games', status: 'have', quantity: 3, condition: 'boxed' },
  { name: 'Pop! Sonic with Emerald', number: '94203', license: 'Sonic the Hedgehog', status: 'have', condition: 'boxed', exclusive: 'GameStop' },
  { name: 'Pop! Roboute Guilliman', number: '94189', license: 'Warhammer', status: 'have', condition: 'boxed', chase: true },
  { name: 'Pop! Chun-Li (2026)', number: '94168', license: 'Street Fighter', status: 'have', quantity: 2, condition: 'boxed', exclusive: 'Target' },
  { name: 'Pop! Worf', number: '93633', license: 'Star Trek', status: 'have', condition: 'boxed' },
  { name: 'Pop! Naruto Uzumaki', number: '71098', license: 'Naruto', status: 'have', condition: 'loose' },
  { name: 'Pop! Batman Beyond', number: '93125', license: 'DC Comics', series: 'Pop! Heroes', status: 'have', condition: 'boxed' },
  { name: 'Pop! Grid Xenomorph (Glow)', number: '93416', license: 'Horror', status: 'want' },
  { name: 'Pop! Atom Eve (Pink Energy)', number: '93409', license: 'Invincible', status: 'want' },
  { name: 'Pop! Michelangelo (Eating Pizza)', number: '93415', license: 'TMNT', status: 'want' },
  { name: 'Pop! Rhysand', number: '95966', license: 'ACOTAR', status: 'want' },
  { name: 'Pop! Bluey', number: '62368', license: 'Bluey', status: 'had' },
];

/**
 * `waitFor` is a selector that only exists once the page has finished its real
 * work. Seeding goes through IndexedDB, which is asynchronous, so capturing on
 * the load event catches a half-rendered page.
 */
const SHOTS = [
  { name: 'collection.png', route: '', width: 1280, height: 900, waitFor: '.shelf li:nth-child(8)' },
  { name: 'radar.png', route: 'radar/', width: 1280, height: 900, waitFor: '.release[data-match="true"]' },
  {
    name: 'wishlist-mobile.png',
    route: 'wishlist/',
    width: 420,
    height: 840,
    mobile: true,
    waitFor: '.shelf li:nth-child(3)',
  },
];

function findChrome() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) {
    console.error('Could not find Chrome. Install it, or add its path to CHROME_CANDIDATES.');
    process.exit(1);
  }
  return chrome;
}

async function stageBuild() {
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  // Build at the root so the throwaway server can be dumb about paths.
  await run(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
    env: { ...process.env, SITE_BASE: '/' },
    cwd: ROOT,
  });
  await cp(path.join(ROOT, 'dist'), STAGE, { recursive: true });

  await writeFile(
    path.join(STAGE, 'seed-demo.js'),
    `import * as store from '/assets/js/store.js';
const items = ${JSON.stringify(DEMO_ITEMS, null, 2)};
await store.replaceCollection([]);
for (const item of items) await store.saveItem(item);
document.documentElement.dataset.seeded = 'true';
`,
  );

  for (const { route } of SHOTS) {
    const file = path.join(STAGE, route, 'index.html');
    const html = await readFile(file, 'utf8');
    await writeFile(
      file,
      html.replace('</body>', '    <script type="module" src="/seed-demo.js"></script>\n  </body>'),
    );
  }
}

function serve() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
  };
  const server = createServer(async (req, res) => {
    let file = path.join(STAGE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(STAGE)) return res.writeHead(403).end();
    if (!path.extname(file)) file = path.join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const DEBUG_PORT = 9333;

/** Minimal DevTools Protocol client. Node 22 has a global WebSocket, so this
 *  needs no packages. */
class CDP {
  #ws;
  #id = 0;
  #pending = new Map();

  static async attach(url) {
    const client = new CDP();
    client.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      client.#ws.addEventListener('open', resolve, { once: true });
      client.#ws.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
    });
    client.#ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      const waiter = client.#pending.get(msg.id);
      if (!waiter) return;
      client.#pending.delete(msg.id);
      msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
    });
    return client;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#ws.close();
  }
}

async function browserTargets() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  return res.json();
}

async function launchChrome(chrome) {
  const profile = path.join(STAGE, '.profile');
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  for (let i = 0; i < 60; i += 1) {
    try {
      const targets = await browserTargets();
      if (targets.some((t) => t.type === 'page')) return child;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error('Chrome never opened a debugging port.');
}

async function capture(page, { name, route, width, height, mobile = false, waitFor }) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile,
  });
  await page.send('Page.navigate', { url: `http://localhost:${PORT}/${route}` });

  // Poll for the thing that proves the page actually finished.
  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const { result } = await page.send('Runtime.evaluate', {
      expression: `!!document.querySelector(${JSON.stringify(waitFor)})`,
      returnByValue: true,
    });
    if (result.value) {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error(`${name}: "${waitFor}" never appeared`);

  // Let the toast about a new service worker version clear, so it does not sit
  // over the content in a published screenshot.
  await page.send('Runtime.evaluate', {
    expression: `document.querySelectorAll('.toast').forEach(t => t.remove())`,
  });
  await new Promise((r) => setTimeout(r, 400));

  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log(`  ${name.padEnd(22)} ${width}x${height}`);
}

async function main() {
  const chrome = findChrome();
  console.log(`chrome: ${chrome}`);
  await mkdir(OUT, { recursive: true });
  await stageBuild();

  const server = await serve();
  const child = await launchChrome(chrome);
  let page;
  try {
    const target = (await browserTargets()).find((t) => t.type === 'page');
    page = await CDP.attach(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    for (const shot of SHOTS) await capture(page, shot);
  } finally {
    page?.close();
    child.kill();
    server.close();
  }

  await new Promise((r) => setTimeout(r, 500));
  await rm(STAGE, { recursive: true, force: true }).catch(() => {});
  console.log(`screenshots -> ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error('screenshots failed:', err.message);
  process.exit(1);
});
