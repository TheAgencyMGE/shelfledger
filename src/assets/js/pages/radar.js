/**
 * The radar. This is the front page and the reason the project exists.
 *
 * data/releases.json is public and identical for every visitor, with nothing in
 * the request that says who asked. Which rows are flagged as yours is worked
 * out here in the page, against the wishlist stored on this device.
 */

import { $, el, clear, toast, downloadFile, describeError, formatDate, plural, debounce, BASE } from '../ui.js';
import { matchReleases } from '../match.js';
import {
  STAGES,
  CATEGORY_LABELS,
  withStages,
  countByStage,
  filterReleases,
  facets,
  sortReleases,
  sortByFirstSeen,
  newlyDiscovered,
  availabilityLabel,
} from '../stages.js';
import { buildCalendar, eventCount } from '../ics.js';
import * as store from '../store.js';

const state = {
  raw: [],
  annotated: [],
  meta: null,
  filter: { stage: 'all', manufacturer: '', line: '', category: '', text: '', wishlistOnly: false },
};

/* ------------------------------------------------------------------ rows */

function money(release) {
  const amount = release.price.toFixed(2);
  if (!release.currency || release.currency === 'USD') return `$${amount}`;
  return `${amount} ${release.currency}`;
}

function dateCell(release) {
  if (release.releaseDate) {
    return el('div', { class: 'release-date' }, [
      formatDate(release.releaseDate, { day: 'numeric', month: 'short' }),
      el('div', { text: formatDate(release.releaseDate, { year: 'numeric' }) }),
    ]);
  }
  if (release.preorderDate) {
    return el('div', { class: 'release-date' }, [
      el('span', { class: 'muted', text: 'preorder' }),
      el('div', { text: formatDate(release.preorderDate, { day: 'numeric', month: 'short' }) }),
    ]);
  }
  return el('div', { class: 'release-date' });
}

function releaseRow(release, isFresh) {
  const meta = [
    release.manufacturer,
    release.line && release.line !== release.manufacturer ? release.line : null,
    release.license,
    release.releaseWindow,
  ]
    .filter(Boolean)
    .join(' · ');

  const side = el('div', { class: 'release-side' }, [
    release.limitedRunSize
      ? el('span', { class: 'limited', text: `${release.limitedRunSize.toLocaleString()} pcs` })
      : null,
    typeof release.price === 'number' ? el('span', { text: money(release) }) : null,
    availabilityLabel(release.availability)
      ? el('span', { class: 'avail', dataset: { v: release.availability }, text: availabilityLabel(release.availability) })
      : null,
  ]);

  return el('li', { class: 'release', dataset: { match: String(Boolean(release.match)) } }, [
    dateCell(release),
    el('div', { class: 'release-main' }, [
      el('h3', { class: 'release-name' }, [
        release.url
          ? el('a', { href: release.url, rel: 'noopener nofollow', target: '_blank', text: release.name })
          : release.name,
        isFresh ? el('span', { class: 'flag flag-new', text: 'New' }) : null,
        release.match ? el('span', { class: 'flag flag-want', text: 'Wishlist' }) : null,
      ]),
      meta ? el('p', { class: 'release-sub', text: meta }) : null,
    ]),
    side,
  ]);
}

/* --------------------------------------------------------------- chrome */

function renderMeta() {
  const node = $('[data-radar-meta]');
  if (!node || !state.meta) return;
  clear(node);

  const matches = state.annotated.filter((r) => r.match).length;
  const working = state.meta.sources.filter((s) => s.ok);
  const broken = state.meta.sources.filter((s) => !s.ok);

  node.append(
    el('ul', { class: 'tally' }, [
      el('li', {}, [el('b', { text: String(state.annotated.length) }), 'tracked']),
      el('li', {}, [
        el('b', { text: String(working.length) }),
        working.length === 1 ? 'source' : 'sources',
      ]),
      el('li', { class: 't-want' }, [el('b', { text: String(matches) }), 'on your wishlist']),
      el('li', {}, [el('b', { text: formatDate(state.meta.generatedAt) || '' }), 'updated']),
    ]),
  );

  if (broken.length) {
    node.append(
      el('p', {
        class: 'hint',
        text: `${broken.map((s) => s.label).join(' and ')} could not be read on the last run. Those entries are from an earlier one.`,
      }),
    );
  }
}

function renderStages() {
  const nav = $('[data-stages]');
  if (!nav) return;
  clear(nav);
  const counts = countByStage(state.annotated);

  for (const stage of STAGES) {
    if (stage.id !== 'all' && counts[stage.id] === 0) continue;
    nav.append(
      el(
        'button',
        {
          type: 'button',
          class: 'stage',
          'aria-pressed': String(state.filter.stage === stage.id),
          onClick: () => {
            state.filter.stage = stage.id;
            renderStages();
            renderList();
          },
        },
        [stage.label, el('span', { class: 'stage-count', text: String(counts[stage.id] ?? 0) })],
      ),
    );
  }
}

function renderFilters() {
  const mount = $('[data-radar-filters]');
  if (!mount) return;
  clear(mount);
  const { manufacturers, lines, categories } = facets(state.annotated);

  const search = el('input', {
    type: 'search',
    placeholder: 'Search releases',
    'aria-label': 'Search releases',
    autocomplete: 'off',
    value: state.filter.text,
  });
  search.addEventListener(
    'input',
    debounce(() => {
      state.filter.text = search.value;
      renderList();
    }, 140),
  );

  const select = (label, values, key, labels) => {
    const node = el('select', { 'aria-label': label }, [
      el('option', { value: '', text: label }),
      ...values.map((v) => el('option', { value: v, text: labels?.[v] ?? v })),
    ]);
    node.value = state.filter[key];
    node.addEventListener('change', () => {
      state.filter[key] = node.value;
      renderList();
    });
    return node;
  };

  const wishlistToggle = el('label', { class: 'check' }, [
    el('input', {
      type: 'checkbox',
      checked: state.filter.wishlistOnly,
      onChange: (event) => {
        state.filter.wishlistOnly = event.target.checked;
        renderList();
      },
    }),
    'My wishlist',
  ]);

  mount.append(
    search,
    select('All makers', manufacturers, 'manufacturer'),
    select('All lines', lines, 'line'),
    select('All types', categories, 'category', CATEGORY_LABELS),
    wishlistToggle,
  );
}

function renderList() {
  const mount = $('[data-radar-list]');
  clear(mount);

  const filtered = filterReleases(state.annotated, state.filter);
  const ordered =
    state.filter.stage === 'just-announced' ? sortByFirstSeen(filtered) : sortReleases(filtered);

  if (!ordered.length) {
    mount.append(
      el('div', { class: 'empty' }, [
        el('h2', { text: 'Nothing here' }),
        el('p', {
          text: state.filter.wishlistOnly
            ? 'Nothing tracked matches your wishlist yet. The feed refreshes daily.'
            : 'Try a different stage, or clear the filters.',
        }),
      ]),
    );
    updateIcs();
    return;
  }

  const fresh = newlyDiscovered(state.annotated);
  const list = el('ul', { class: 'radar-list' });
  for (const release of ordered) list.append(releaseRow(release, fresh.has(release.id)));
  mount.append(list);
  mount.append(
    el('p', { class: 'hint', style: 'margin-top:1rem', text: `${plural(ordered.length, 'release')}.` }),
  );
  updateIcs();
}

function updateIcs() {
  const btn = $('[data-ics]');
  if (!btn) return;
  // The count goes in the toast, not the button. A button labelled
  // "Download 142 .ics" reads like a bug.
  btn.disabled = eventCount(currentCalendarSet()) === 0;
}

/** What the calendar exports: your matches, or the current view if none. */
function currentCalendarSet() {
  const matches = state.annotated.filter((r) => r.match);
  if (matches.length) return matches;
  return filterReleases(state.annotated, state.filter);
}

function render() {
  renderMeta();
  renderStages();
  renderFilters();
  renderList();
}

/* ----------------------------------------------------------------- data */

async function recompute() {
  const wants = await store.itemsByStatus('want').catch(() => []);
  state.annotated = withStages(matchReleases(state.raw, wants));
  render();
}

async function load() {
  const mount = $('[data-radar-list]');
  try {
    const res = await fetch(`${BASE}data/releases.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`The release file returned ${res.status}.`);
    const payload = await res.json();
    state.raw = Array.isArray(payload.releases) ? payload.releases : [];
    state.meta = { generatedAt: payload.generatedAt, sources: payload.sources ?? [] };
    await recompute();
  } catch (err) {
    clear(mount).append(
      el('div', { class: 'empty' }, [
        el('h2', { text: 'Could not load the feed' }),
        el('p', { text: describeError(err) }),
      ]),
    );
  }
}

function downloadIcs() {
  const set = currentCalendarSet();
  if (!eventCount(set)) {
    toast('Nothing dated to put in a calendar yet.');
    return;
  }
  downloadFile('shelfledger-radar.ics', buildCalendar(set), 'text/calendar');
  toast(`Saved ${plural(eventCount(set), 'date')}. Open the file to add them to your calendar.`);
}

$('[data-ics]')?.addEventListener('click', downloadIcs);
store.onChange(recompute);
load();
