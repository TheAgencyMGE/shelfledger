/**
 * Builds an iCalendar file from matched releases.
 *
 * This is how reminders happen without any push infrastructure: you download a
 * .ics of the things you actually want and your own calendar app takes it from
 * there. Nothing subscribes, nothing phones home.
 *
 * Format per RFC 5545. Pure string work, no DOM.
 */

const PRODID = '-//ShelfLedger//Release Radar//EN';

/** Escape a text value: backslash, semicolon, comma, newline. */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold to 75 octets per line with a leading space on continuations.
 * Counts UTF-8 bytes, not characters, so accented names stay valid.
 */
export function foldLine(line) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let bytes = enc.encode(line);
  if (bytes.length <= 75) return line;

  const parts = [];
  let limit = 75;
  while (bytes.length > limit) {
    let cut = limit;
    // Do not split inside a multi-byte character.
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut -= 1;
    parts.push(dec.decode(bytes.slice(0, cut)));
    bytes = bytes.slice(cut);
    limit = 74; // continuation lines lose one octet to the leading space
  }
  parts.push(dec.decode(bytes));
  return parts.join('\r\n ');
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** YYYY-MM-DD -> YYYYMMDD */
function dateValue(iso) {
  return iso.replace(/-/g, '');
}

/** The day after, for an all-day event's exclusive DTEND. */
function nextDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function describe(release) {
  const bits = [];
  const maker = [release.manufacturer, release.line].filter(Boolean).join(' ');
  if (maker) bits.push(maker);
  if (release.sku) bits.push(`Item number ${release.sku}`);
  if (release.releaseWindow) bits.push(`Ships ${release.releaseWindow}`);
  if (release.preorderDate) bits.push(`Preorders open ${release.preorderDate}`);
  if (release.limitedRunSize) bits.push(`Limited to ${release.limitedRunSize} pieces`);
  if (typeof release.price === 'number') {
    bits.push(`${release.price.toFixed(2)} ${release.currency || 'USD'} at listing time`);
  }
  if (release.retailer) bits.push(`Listed by ${release.retailer}`);
  if (release.match?.itemName) bits.push(`On your wishlist as "${release.match.itemName}"`);
  bits.push('Added by ShelfLedger. Prices and dates come from public listings and can change.');
  return bits.join('\n');
}

/**
 * Build the calendar. Only dated releases become events, an undated "coming
 * soon" listing has nothing to remind you about.
 */
export function buildCalendar(releases, { now = new Date(), name = 'ShelfLedger radar' } = {}) {
  const dated = releases.filter((r) => r.releaseDate);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const release of dated) {
    const uid = `${release.id || release.sku || escapeText(release.name)}@shelfledger`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${dateValue(release.releaseDate)}`,
      `DTEND;VALUE=DATE:${nextDay(release.releaseDate)}`,
      `SUMMARY:${escapeText(release.name)}`,
      `DESCRIPTION:${escapeText(describe(release))}`,
      'TRANSP:TRANSPARENT',
    );
    if (release.url) lines.push(`URL:${escapeText(release.url)}`);
    lines.push('BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(release.name)} drops tomorrow`, 'END:VALARM');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Count of events the calendar will actually contain. */
export function eventCount(releases) {
  return releases.filter((r) => r.releaseDate).length;
}
