/**
 * Source health.
 *
 * Built entirely from the feed the scraper writes, so it cannot claim a source
 * is working when it is not, and it cannot list coverage the adapters do not
 * actually produce.
 */

import { $, el, clear, describeError, formatDate, plural, BASE } from '../ui.js';

function relativeDays(iso) {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'never';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function sourceRow(source, counts) {
  const status = source.ok ? 'ok' : 'down';
  return el('li', { class: `cov cov-${status}` }, [
    el('div', {}, [
      el('div', { class: 'cov-head' }, [
        el('strong', { text: source.label }),
        el('span', { class: 'tag', text: source.kind === 'retailer' ? 'Retailer' : 'Manufacturer' }),
        source.bootstrap ? el('span', { class: 'tag', text: 'First run' }) : null,
      ]),
      el('p', { class: 'hint' }, [
        source.ok
          ? `${plural(source.listings, 'listing')} read, ${source.withListingDate} with a published listing date. `
          : `Failed: ${source.error ?? 'unknown error'}. `,
        `${counts[source.id] ?? 0} releases on the radar. `,
        `Last success ${relativeDays(source.lastSuccess)}.`,
      ]),
    ]),
    el('a', {
      class: 'muted',
      href: source.homepage,
      rel: 'noopener nofollow',
      target: '_blank',
      text: new URL(source.homepage).hostname.replace(/^www\./, ''),
    }),
  ]);
}

function gapRow(entry) {
  return el('li', { class: 'cov cov-gap' }, [
    el('div', {}, [
      el('div', { class: 'cov-head' }, [
        el('strong', { text: entry.label }),
        entry.lines?.length ? el('span', { class: 'muted', text: entry.lines.join(', ') }) : null,
      ]),
      el('p', { class: 'hint', text: entry.reason }),
      entry.coveredVia ? el('p', { class: 'hint cov-via', text: entry.coveredVia }) : null,
    ]),
  ]);
}

/** The most recent additions, so the change history is visible without git. */
function changeRows(releases) {
  const recent = [...releases]
    .filter((r) => r.firstSeen)
    .sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)))
    .slice(0, 25);

  return el(
    'ul',
    { class: 'changes' },
    recent.map((release) =>
      el('li', {}, [
        el('span', { class: 'release-date', text: formatDate(release.firstSeen, { day: 'numeric', month: 'short' }) }),
        el('span', {}, [
          release.url
            ? el('a', { href: release.url, rel: 'noopener nofollow', target: '_blank', text: release.name })
            : release.name,
          release.manufacturer ? el('span', { class: 'muted', text: ` ${release.manufacturer}` }) : null,
        ]),
      ]),
    ),
  );
}

async function render() {
  const mount = $('[data-source-health]');
  if (!mount) return;
  try {
    const res = await fetch(`${BASE}data/releases.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`The release file returned ${res.status}.`);
    const payload = await res.json();
    const releases = payload.releases ?? [];

    const counts = {};
    for (const release of releases) {
      for (const id of release.sourceIds ?? []) counts[id] = (counts[id] ?? 0) + 1;
    }

    clear(mount);
    mount.append(
      el('ul', { class: 'tally' }, [
        el('li', {}, [el('b', { text: String(releases.length) }), 'releases']),
        el('li', {}, [
          el('b', { text: String((payload.sources ?? []).filter((s) => s.ok).length) }),
          'sources live',
        ]),
        el('li', {}, [el('b', { text: formatDate(payload.generatedAt) || '' }), 'last checked']),
      ]),
      el('h2', { text: 'Being read' }),
      el('ul', { class: 'cov-list' }, (payload.sources ?? []).map((s) => sourceRow(s, counts))),
    );

    if (payload.unsupported?.length) {
      mount.append(
        el('h2', { text: 'Not covered' }),
        el('p', {
          class: 'hint',
          text: 'These come up often. Nothing from them is faked in the feed, and each is here for a specific reason.',
        }),
        el('ul', { class: 'cov-list' }, payload.unsupported.map(gapRow)),
      );
    }

    mount.append(
      el('h2', { text: 'Recently added to the radar' }),
      el('p', {
        class: 'hint',
        text: 'When a row entered the dataset. This is separate from when a product was announced, and is never used to call something new.',
      }),
      changeRows(releases),
    );
  } catch (err) {
    clear(mount).append(el('p', { class: 'muted', text: describeError(err) }));
  }
}

render();
