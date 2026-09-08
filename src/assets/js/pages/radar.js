/**
 * Release radar.
 *
 * data/releases.json is public, the same bytes for every visitor, with nothing
 * in the request that says who asked. Which of those releases you are chasing
 * is worked out here in the page against the wishlist in this browser.
 */

import { $, el, clear, toast, downloadFile, describeError, formatDate, plural, BASE } from '../ui.js';
import { matchReleases, sortReleases, upcomingOnly } from '../match.js';
import { buildCalendar, eventCount } from '../ics.js';
import * as store from '../store.js';

const state = {
  releases: [],
  matched: [],
  meta: null,
  onlyMatches: false,
  includePast: false,
};

function releaseRow(release) {
  const matched = Boolean(release.match);

  const dateNode = release.releaseDate
    ? el('div', { class: 'release-date' }, [
        formatDate(release.releaseDate, { day: 'numeric', month: 'short' }),
        el('div', { text: formatDate(release.releaseDate, { year: 'numeric' }) }),
      ])
    : el('div', { class: 'release-date' });

  const sub = [release.license, release.channel?.replace(/-/g, ' ')].filter(Boolean).join(' · ');

  const side = el('div', { class: 'release-side' }, [
    release.limitedRunSize
      ? el('span', { class: 'limited', text: `${release.limitedRunSize.toLocaleString()} pcs` })
      : null,
    typeof release.price === 'number' ? `${release.price.toFixed(2)}` : null,
  ]);

  return el('li', { class: 'release', dataset: { match: String(matched) } }, [
    dateNode,
    el('div', {}, [
      el('h3', { class: 'release-name' }, [
        release.url
          ? el('a', { href: release.url, rel: 'noopener nofollow', target: '_blank', text: release.name })
          : release.name,
      ]),
      sub ? el('p', { class: 'release-sub', text: sub }) : null,
    ]),
    side,
  ]);
}

function renderMeta() {
  const node = $('[data-radar-meta]');
  if (!node || !state.meta) return;
  clear(node);
  const matches = state.matched.filter((r) => r.match).length;
  node.append(
    el('ul', { class: 'tally' }, [
      el('li', {}, [el('b', { text: String(state.matched.length) }), 'tracked']),
      el('li', { class: 't-want' }, [el('b', { text: String(matches) }), 'on your wishlist']),
      el('li', {}, [el('b', { text: formatDate(state.meta.generatedAt) || '' }), 'updated']),
    ]),
  );
}

function visibleReleases() {
  let list = state.matched;
  if (!state.includePast) list = upcomingOnly(list);
  if (state.onlyMatches) list = list.filter((r) => r.match);
  return sortReleases(list);
}

function renderList() {
  const mount = $('[data-radar-list]');
  clear(mount);
  const list = visibleReleases();

  if (!list.length) {
    mount.append(
      el('div', { class: 'empty' }, [
        el('h2', { text: state.onlyMatches ? 'No matches yet' : 'Nothing to show' }),
        el('p', {
          text: state.onlyMatches
            ? 'Nothing tracked lines up with your wishlist. The calendar refreshes daily.'
            : 'No upcoming entries right now. Try including past dates.',
        }),
        el('div', { class: 'empty-actions' }, [
          el('a', { class: 'btn btn-primary', href: `${BASE}wishlist/`, text: 'Edit wishlist' }),
        ]),
      ]),
    );
    return;
  }

  const ul = el('ul', { class: 'radar-list' });
  for (const release of list) ul.append(releaseRow(release));
  mount.append(ul);
}

function render() {
  renderMeta();
  renderList();
  const matches = state.matched.filter((r) => r.match);
  const btn = $('[data-ics]');
  if (btn) {
    const count = eventCount(matches);
    btn.disabled = count === 0;
    btn.textContent = count ? `Download ${count} .ics` : 'Download .ics';
  }
}

async function recompute() {
  const wants = await store.itemsByStatus('want').catch(() => []);
  state.matched = matchReleases(state.releases, wants);
  render();
}

async function load() {
  const mount = $('[data-radar-list]');
  try {
    const res = await fetch(`${BASE}data/releases.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`The release file returned ${res.status}.`);
    const payload = await res.json();
    state.releases = Array.isArray(payload.releases) ? payload.releases : [];
    state.meta = { generatedAt: payload.generatedAt };
    await recompute();
  } catch (err) {
    clear(mount).append(
      el('div', { class: 'empty' }, [
        el('h2', { text: 'Could not load the calendar' }),
        el('p', { text: describeError(err) }),
      ]),
    );
  }
}

function downloadIcs() {
  const matches = state.matched.filter((r) => r.match);
  if (!eventCount(matches)) {
    toast('Nothing dated on your wishlist yet.');
    return;
  }
  downloadFile('shelfledger-radar.ics', buildCalendar(matches), 'text/calendar');
  toast(`Saved ${plural(eventCount(matches), 'date')}. Open the file to add them to your calendar.`);
}

$('[data-ics]')?.addEventListener('click', downloadIcs);
$('[data-only-matches]')?.addEventListener('change', (event) => {
  state.onlyMatches = event.target.checked;
  render();
});
$('[data-include-past]')?.addEventListener('change', (event) => {
  state.includePast = event.target.checked;
  render();
});

store.onChange(recompute);
load();
