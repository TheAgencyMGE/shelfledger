/**
 * Barcode scanning, entirely on this device.
 *
 * The camera stream is read frame by frame in the page and thrown away. No
 * frame, image, or decoded number is uploaded anywhere, there is nowhere to
 * upload it to. Two decoders, in order of preference:
 *
 *   1. BarcodeDetector, built into the browser (Chrome, Edge, Android).
 *      Native, fast, nothing to download.
 *   2. A copy of ZXing served from this origin, loaded only if step 1 is
 *      missing (Safari, Firefox). It is ~400kb, so it is fetched on demand
 *      rather than shipped to everyone up front.
 */

import { el, $, BASE, toast, describeError } from './ui.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

let zxingPromise = null;
let dialog = null;
let stop = null;

export function scanSupport() {
  const secure = window.isSecureContext || location.hostname === 'localhost';
  const camera = Boolean(navigator.mediaDevices?.getUserMedia);
  return {
    possible: secure && camera,
    native: 'BarcodeDetector' in window,
    secure,
    camera,
  };
}

/** Load the vendored ZXing build once, from our own origin. */
function loadZxing() {
  if (zxingPromise) return zxingPromise;
  zxingPromise = new Promise((resolve, reject) => {
    const script = el('script', { src: `${BASE}assets/vendor/zxing.min.js` });
    script.addEventListener('load', () => {
      if (window.ZXing) resolve(window.ZXing);
      else reject(new Error('The barcode decoder loaded but did not start.'));
    });
    script.addEventListener('error', () =>
      reject(new Error('Could not load the barcode decoder. Check your connection and try again.')),
    );
    document.head.append(script);
  }).catch((err) => {
    zxingPromise = null;
    throw err;
  });
  return zxingPromise;
}

function buildDialog() {
  const video = el('video', { playsinline: true, muted: true, 'data-video': '' });
  dialog = el('dialog', { 'data-scan-dialog': '' }, [
    el('div', { class: 'dialog-head' }, [
      el('h2', { text: 'Scan a barcode' }),
      el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Close', 'data-close': '' }),
    ]),
    el('div', { class: 'dialog-body' }, [
      el('div', { class: 'scanner' }, [video, el('div', { class: 'reticle' })]),
      el('p', { class: 'hint', 'data-scan-status': '', text: 'Point the camera at the barcode on the box.' }),
    ]),
    el('div', { class: 'dialog-foot' }, [
      el('button', { type: 'button', class: 'btn', text: 'Cancel', 'data-close': '' }),
    ]),
  ]);
  document.body.append(dialog);
  return dialog;
}

function status(text) {
  const node = $('[data-scan-status]', dialog);
  if (node) node.textContent = text;
}

/** Native path: poll BarcodeDetector against the live video element. */
async function detectNative(video, onResult) {
  const detector = new window.BarcodeDetector({ formats: await supportedFormats() });
  let running = true;
  const tick = async () => {
    if (!running) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length && codes[0].rawValue) {
        onResult(codes[0].rawValue);
        return;
      }
    } catch {
      /* a dropped frame is not worth reporting */
    }
    if (running) setTimeout(tick, 180);
  };
  tick();
  return () => {
    running = false;
  };
}

async function supportedFormats() {
  try {
    const available = await window.BarcodeDetector.getSupportedFormats();
    const wanted = FORMATS.filter((f) => available.includes(f));
    return wanted.length ? wanted : available;
  } catch {
    return FORMATS;
  }
}

/** Fallback path: ZXing decodes continuously from the same stream. */
async function detectZxing(video, stream, onResult) {
  status('Loading the decoder…');
  const ZXing = await loadZxing();
  status('Point the camera at the barcode on the box.');
  const reader = new ZXing.BrowserMultiFormatReader();
  reader.decodeFromStream(stream, video, (result) => {
    if (result) onResult(result.getText());
  });
  return () => reader.reset();
}

/**
 * Show the scanner and resolve with the decoded number, or null if the person
 * closed it. Always releases the camera on the way out.
 */
export async function openScanner() {
  const support = scanSupport();
  if (!support.secure) throw new Error('Scanning needs a secure connection (https).');
  if (!support.camera) throw new Error('This browser will not give the page a camera.');

  if (!dialog) buildDialog();
  const video = $('[data-video]', dialog);
  status('Asking for the camera…');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Camera access was declined. Allow it in your browser settings to scan.');
    }
    if (err.name === 'NotFoundError') throw new Error('No camera found on this device.');
    throw new Error(describeError(err));
  }

  video.srcObject = stream;
  await video.play().catch(() => {});
  status('Point the camera at the barcode on the box.');

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      stop?.();
      stop = null;
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
      dialog.removeEventListener('close', onClose);
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dialog.open) dialog.close();
      resolve(value);
    };

    const onClose = () => finish(null);
    dialog.addEventListener('close', onClose);
    for (const btn of dialog.querySelectorAll('[data-close]')) {
      btn.onclick = () => dialog.close();
    }

    const onResult = (raw) => {
      const code = String(raw).replace(/\s+/g, '');
      if (navigator.vibrate) navigator.vibrate(40);
      finish(code);
    };

    dialog.showModal();

    const startDetector = support.native
      ? detectNative(video, onResult)
      : detectZxing(video, stream, onResult);

    startDetector
      .then((stopFn) => {
        if (settled) stopFn();
        else stop = stopFn;
      })
      .catch((err) => {
        toast(describeError(err), 'error');
        finish(null);
      });
  });
}
