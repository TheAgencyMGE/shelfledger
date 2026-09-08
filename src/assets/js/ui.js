/**
 * Small DOM helpers. No framework, no virtual DOM, the lists here are short
 * enough that rebuilding a fragment is faster than any diffing we could write.
 */

/** Site base path, set on <html data-base> at build time. */
export const BASE = document.documentElement.dataset.base || '/';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Create an element. Text content is assigned, never parsed as HTML. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') throw new Error('el(): refusing to set raw HTML');
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Brief status message. Announced politely; never blocks anything. */
export function toast(message, kind = 'info', ms = 4200) {
  const rail = $('[data-toasts]');
  if (!rail) return;
  const node = el('p', { class: 'toast', dataset: { kind }, role: 'status', text: message });
  rail.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .25s ease';
    setTimeout(() => node.remove(), 300);
  }, ms);
}

/** Turn an unknown thrown value into something worth showing a person. */
export function describeError(err) {
  if (!err) return 'Something went wrong.';
  if (err.name === 'QuotaExceededError') {
    return 'Your browser is out of storage for this site. Export a backup, then free some space.';
  }
  return err.message || String(err);
}

/** Hand the browser a file. Everything stays local, this is a blob, not an upload. */
export function downloadFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a File the user picked. The file never leaves the page. */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

/** Debounce, for search-as-you-type. */
export function debounce(fn, ms = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function formatDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
