/**
 * Regenerates the README screenshots, and checks for horizontal overflow while
 * it has a browser open.
 *
 * A local authoring tool. It needs Chrome installed, CI never runs it, and the
 * images it writes are committed. There is no demo data to seed: the radar
 * renders the real feed, so these are screenshots of the real thing.
 *
 *     npm run screenshots
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
const DEBUG_PORT = 9333;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** `waitFor` is a selector that only exists once the page has really finished. */
const SHOTS = [
  { name: 'radar.png', route: '', width: 1280, height: 940, waitFor: '.release:nth-child(6)' },
  {
    name: 'radar-filtered.png',
    route: '?stage=new-preorders',
    width: 1280,
    height: 940,
    waitFor: '.release:nth-child(4)',
  },
  { name: 'sources.png', route: 'sources/', width: 1280, height: 940, waitFor: '.cov-list' },
  {
    name: 'radar-mobile.png',
    route: '',
    width: 400,
    height: 860,
    mobile: true,
    waitFor: '.release:nth-child(3)',
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
  await run(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
    env: { ...process.env, SITE_BASE: '/' },
    cwd: ROOT,
  });
  await cp(path.join(ROOT, 'dist'), STAGE, { recursive: true });
}

function serve() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
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

/** Minimal DevTools Protocol client. Node has a global WebSocket, so no packages. */
class CDP {
  #ws;
  #id = 0;
  #pending = new Map();

  static async attach(url) {
    const client = new CDP();
    client.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      client.#ws.addEventListener('open', resolve, { once: true });
      client.#ws.addEventListener('error', () => reject(new Error('CDP socket failed')), {
        once: true,
      });
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
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${path.join(STAGE, '.profile')}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await browserTargets()).some((t) => t.type === 'page')) return child;
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

  // Clear the service worker toast so it does not sit over a published shot.
  await page.send('Runtime.evaluate', {
    expression: `document.querySelectorAll('.toast').forEach(t => t.remove())`,
  });
  await new Promise((r) => setTimeout(r, 400));

  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log(`  ${name.padEnd(22)} ${width}x${height}`);
}

/** Horizontal overflow is the layout bug that actually matters on a phone. */
async function checkOverflow(page, width) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 860,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await new Promise((r) => setTimeout(r, 3000));
  const { result } = await page.send('Runtime.evaluate', {
    expression: `(() => {
      const de = document.documentElement;
      const bad = [...document.querySelectorAll('*')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > de.clientWidth + 1; })
        .map((el) => el.tagName + '.' + String(el.className).slice(0, 30));
      return JSON.stringify({ clientW: de.clientWidth, scrollW: de.scrollWidth, offenders: bad.slice(0, 5) });
    })()`,
    returnByValue: true,
  });
  return JSON.parse(result.value);
}

async function main() {
  const chrome = findChrome();
  console.log(`chrome: ${chrome}`);
  await mkdir(OUT, { recursive: true });
  await stageBuild();

  const server = await serve();
  const child = await launchChrome(chrome);
  let page;
  let failures = 0;
  try {
    const target = (await browserTargets()).find((t) => t.type === 'page');
    page = await CDP.attach(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    for (const shot of SHOTS) await capture(page, shot);

    for (const width of [360, 400, 768]) {
      const result = await checkOverflow(page, width);
      const ok = result.scrollW <= result.clientW;
      if (!ok) failures += 1;
      console.log(
        `  overflow ${String(width).padEnd(5)} ${
          ok ? 'none' : `${result.scrollW}px in ${result.clientW}px: ${result.offenders.join(', ')}`
        }`,
      );
    }
  } finally {
    page?.close();
    child.kill();
    server.close();
  }

  await new Promise((r) => setTimeout(r, 500));
  await rm(STAGE, { recursive: true, force: true }).catch(() => {});
  console.log(`screenshots -> ${path.relative(ROOT, OUT)}`);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error('screenshots failed:', err.message);
  process.exit(1);
});
