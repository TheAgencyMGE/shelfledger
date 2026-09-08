/**
 * Taking the current view somewhere else.
 *
 * Whatever is on screen can leave as CSV, JSON or a calendar file. All three
 * are built in the page from data it already has, so exporting is not a request
 * to anything and works offline.
 */

/** RFC 4180: quote when the value contains a comma, quote or newline. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

const COLUMNS = [
  ['id', (r) => r.id],
  ['name', (r) => r.name],
  ['manufacturer', (r) => r.manufacturer],
  ['line', (r) => r.line],
  ['license', (r) => r.license],
  ['category', (r) => r.category],
  ['sku', (r) => r.sku],
  ['announced', (r) => r.announcedDate],
  ['preorder_opens', (r) => r.preorderDate],
  ['release_date', (r) => r.releaseDate],
  ['release_window', (r) => r.releaseWindow],
  ['availability', (r) => r.availability],
  ['price', (r) => (typeof r.price === 'number' ? r.price.toFixed(2) : '')],
  ['currency', (r) => r.currency],
  ['limited_run', (r) => r.limitedRunSize],
  ['exclusive', (r) => r.exclusive],
  ['sellers', (r) => (r.offers ?? []).map((o) => o.seller).join(' | ')],
  ['url', (r) => r.url],
];

export function toCsv(releases) {
  const head = COLUMNS.map(([name]) => name).join(',');
  const rows = releases.map((release) =>
    COLUMNS.map(([, read]) => csvCell(read(release))).join(','),
  );
  return [head, ...rows].join('\r\n') + '\r\n';
}

/** The same records the JSON feed publishes, trimmed of internal bookkeeping. */
export function toJson(releases, { generatedAt = new Date().toISOString(), filter = null } = {}) {
  return JSON.stringify(
    {
      source: 'ShelfLedger',
      generatedAt,
      filter,
      count: releases.length,
      releases: releases.map(({ stages, makerKey, baseline, previousAvailability, ...rest }) => rest),
    },
    null,
    2,
  );
}

export function exportFilename(kind, filter = {}) {
  const parts = ['shelfledger'];
  if (filter.stage && filter.stage !== 'all') parts.push(filter.stage);
  if (filter.manufacturer) parts.push(filter.manufacturer.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (filter.line) parts.push(filter.line.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  parts.push(new Date().toISOString().slice(0, 10));
  return `${parts.join('-').replace(/-+/g, '-')}.${kind}`;
}
