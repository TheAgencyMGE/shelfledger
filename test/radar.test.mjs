import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchOne, matchReleases, sortReleases, upcomingOnly } from '../src/assets/js/match.js';
import { buildCalendar, eventCount, escapeText, foldLine } from '../src/assets/js/ics.js';
import { normaliseItem } from '../src/assets/js/model.js';

const want = (fields) => normaliseItem({ status: 'want', ...fields });

test('an item number beats any name similarity', () => {
  const hit = matchOne(want({ name: 'Completely different words', number: '93416' }), {
    sku: '93416',
    name: 'Pop! Grid Xenomorph (Glow)',
  });
  assert.equal(hit.reason, 'number');
  assert.equal(hit.score, 1);
});

test('names match across punctuation and Pop! prefixes', () => {
  const hit = matchOne(want({ name: 'Chun Li 2026' }), { name: 'Pop! Chun-Li (2026)', sku: '1' });
  assert.ok(hit);
  assert.equal(hit.reason, 'name');
});

test('a short wishlist entry catches a longer release title', () => {
  const hit = matchOne(want({ name: 'Rhysand' }), {
    name: 'Pop! Rhysand (Winged) with Pop! Protector',
    sku: '2',
  });
  assert.ok(hit);
  assert.equal(hit.reason, 'contains');
});

test('unrelated figures do not match', () => {
  assert.equal(matchOne(want({ name: 'Pop! Batman' }), { name: 'Pop! Superman', sku: '3' }), null);
  assert.equal(matchOne(want({ name: 'Pop! Worf' }), { name: 'Pop! Geordi LaForge', sku: '4' }), null);
});

test('matchReleases annotates only the releases that match', () => {
  const releases = [
    { id: 'a', sku: '93416', name: 'Pop! Grid Xenomorph (Glow)' },
    { id: 'b', sku: '99999', name: 'Pop! Something Else Entirely' },
  ];
  const result = matchReleases(releases, [want({ name: 'Grid Xenomorph Glow' })]);
  assert.ok(result[0].match, 'the xenomorph matched');
  assert.equal(result[1].match, null);
  assert.equal(result.length, 2, 'unmatched releases are still returned');
});

test('matchReleases keeps the strongest match when several wants overlap', () => {
  const releases = [{ id: 'a', sku: '93416', name: 'Pop! Grid Xenomorph (Glow)' }];
  const [result] = matchReleases(releases, [
    want({ id: 'loose', name: 'Xenomorph' }),
    want({ id: 'exact', name: 'anything', number: '93416' }),
  ]);
  assert.equal(result.match.itemId, 'exact');
});

test('sortReleases puts dated entries first, soonest first', () => {
  const sorted = sortReleases([
    { name: 'Zed', releaseDate: null },
    { name: 'Later', releaseDate: '2026-12-01' },
    { name: 'Sooner', releaseDate: '2026-09-08' },
    { name: 'Alpha', releaseDate: null },
  ]);
  assert.deepEqual(sorted.map((r) => r.name), ['Sooner', 'Later', 'Alpha', 'Zed']);
});

test('upcomingOnly keeps undated entries and drops past dates', () => {
  const today = new Date('2026-09-07T12:00:00Z');
  const list = upcomingOnly(
    [
      { name: 'past', releaseDate: '2026-08-01' },
      { name: 'today', releaseDate: '2026-09-07' },
      { name: 'future', releaseDate: '2026-10-01' },
      { name: 'undated', releaseDate: null },
    ],
    today,
  );
  assert.deepEqual(list.map((r) => r.name), ['today', 'future', 'undated']);
});

/* ------------------------------------------------------------------ ics */

const dropRelease = {
  id: 'funko-93416',
  sku: '93416',
  name: 'Pop! Grid Xenomorph (Glow) with Pop! Protector',
  releaseDate: '2026-09-08',
  limitedRunSize: 1200,
  price: 39.99,
  currency: 'USD',
  channel: 'limited-drop',
  url: 'https://funko.com/example/93416.html',
  match: { itemName: 'Xenomorph', reason: 'name', score: 0.9 },
};

test('the calendar is a valid single-event VCALENDAR', () => {
  const ics = buildCalendar([dropRelease], { now: new Date('2026-09-07T00:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  assert.equal((ics.match(/END:VEVENT/g) ?? []).length, 1);
  assert.match(ics, /DTSTART;VALUE=DATE:20260908/);
  assert.match(ics, /DTEND;VALUE=DATE:20260909/, 'all-day end date is exclusive');
  assert.match(ics, /UID:funko-93416@shelfledger/);
  assert.match(ics, /BEGIN:VALARM/);
});

/** Reverse RFC 5545 folding, so assertions can look at the logical values. */
const unfold = (ics) => ics.replace(/\r\n /g, '');

test('the calendar records the facts a collector plans around', () => {
  const ics = unfold(buildCalendar([dropRelease]));
  assert.match(ics, /Limited to 1200 pieces/);
  assert.match(ics, /Item number 93416/);
  assert.match(ics, /39\.99 USD/);
  assert.match(ics, /On your wishlist as/);
});

test('undated releases produce no events', () => {
  const ics = buildCalendar([{ id: 'x', name: 'No date', releaseDate: null }]);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 0);
  assert.equal(eventCount([{ releaseDate: null }, { releaseDate: '2026-01-01' }]), 1);
});

test('text values are escaped per RFC 5545', () => {
  assert.equal(escapeText('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  assert.equal(escapeText('line\nbreak'), 'line\\nbreak');
});

test('long lines fold to 75 octets with a leading space', () => {
  const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);
  const lines = folded.split('\r\n');
  assert.ok(lines.length > 1);
  assert.ok(new TextEncoder().encode(lines[0]).length <= 75);
  for (const line of lines.slice(1)) assert.match(line, /^ /);
});

test('folding never splits a multi-byte character', () => {
  const folded = foldLine(`SUMMARY:${'é'.repeat(80)}`);
  for (const line of folded.split('\r\n')) {
    assert.doesNotMatch(line, /�/, 'no replacement characters appeared');
  }
});

test('a name with commas survives into the calendar intact', () => {
  const ics = unfold(
    buildCalendar([
      { id: 'c', name: 'Pop! Thing, With a Comma; and semicolon', releaseDate: '2026-10-10' },
    ]),
  );
  assert.match(ics, /SUMMARY:Pop! Thing\\, With a Comma\\; and semicolon/);
});
