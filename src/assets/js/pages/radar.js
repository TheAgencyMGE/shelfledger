/**
 * The radar.
 *
 * Everything on this page is derived from one static JSON file plus the query
 * string. There is no state anywhere else: no account, no storage, no request
 * that says who is asking. Narrowing the view rewrites the URL, so any view can
 * be bookmarked or sent to someone.
 */

import { $, el, clear, toast, downloadFile, describeError, formatDate, plural, debounce, BASE } from '../ui.js';
import {
  STAGES,
  CATEGORY_LABELS,
  EMPTY_FILTER,
  withStages,
  countByStage,
  filterReleases,
  facets,
  sortForStage,
  availabilityLabel,
} from '../stages.js';
import { filterFromSearch, searchFromFilter, writeFilterToUrl, describeFilter } from '../url-state.js';
import { toCsv, toJson, exportFilename } from '../exports.js';
import { buildCalendar, eventCount } from '../ics.js';

const STAGE_LABELS = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));

const state = {
  releases: [],
  meta: null,
  filter: { ...EMPTY_FILTER },
};

/* ------------------------------------------------------------------ rows */

function money(release) {
  if (typeof release.price !== 'number') return null;
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
  if (release.releaseWindow) {
    return el('div', { class: 'release-date', text: release.releaseWindow });
  }
  if (release.preorderDate) {
    return el('div', { class: 'release-date' }, [
      el('span', { class: 'muted', text: 'preorder' }),
      el('div', { text: formatDate(release.preorderDate, { day: 'numeric', month: 'short' }) }),
    ]);
  }
  return el('div', { class: 'release-date muted', text: 'no date' });
}

/** Every place you can buy it, with who said what. This is the provenance. */
function offerList(release) {
  return el(
    'ul',
    { class: 'offers' },
    (release.offers ?? []).map((offer) =>
      el('li', {}, [
        offer.url
          ? el('a', { href: offer.url, rel: 'noopener nofollow', target: '_blank', text: offer.seller })
          : el('span', { text: offer.seller }),
        typeof offer.price === 'number'
          ? el('span', { class: 'offer-price', text: `$${offer.price.toFixed(2)}` })
          : null,
        availabilityLabel(offer.availability)
          ? el('span', {
              class: 'avail',
              dataset: { v: offer.availability },
              text: availabilityLabel(offer.availability),
            })
          : null,
      ]),
    ),
  );
}

function releaseRow(release) {
  const multi = (release.offers ?? []).length > 1;
  const meta = [release.manufacturer, release.line, release.license]
    .filter((v, i, arr) => v && arr.indexOf(v) === i)
    .join(' · ');

  const flags = [];
  if (release.stages.includes('just-announced')) {
    flags.push(el('span', { class: 'flag flag-new', text: 'Just announced' }));
  } else if (release.stages.includes('new-preorders')) {
    flags.push(el('span', { class: 'flag flag-pre', text: 'New preorder' }));
  }
  if (release.stages.includes('restocks')) {
    flags.push(el('span', { class: 'flag flag-restock', text: 'Restock' }));
  }
  if (release.limitedRunSize) {
    flags.push(
      el('span', { class: 'flag flag-limited', text: `${release.limitedRunSize.toLocaleString()} pcs` }),
    );
  }

  return el('li', { class: 'release' }, [
    dateCell(release),
    el('div', { class: 'release-main' }, [
      el('h3', { class: 'release-name' }, [
        release.url
          ? el('a', { href: release.url, rel: 'noopener nofollow', target: '_blank', text: release.name })
          : release.name,
        ...flags,
      ]),
      meta ? el('p', { class: 'release-sub', text: meta }) : null,
      release.announcedDate
        ? el('p', {
            class: 'release-sub',
            text: `Listed ${formatDate(release.announcedDate)}${
              release.announcedBy ? ` by ${sellerName(release.announcedBy)}` : ''
            }`,
          })
        : null,
      offerList(release),
    ]),
    // With a single seller the offer chip already says the price and stock, so
    // the summary column would just repeat it.
    el('div', { class: 'release-side' }, [
      multi && money(release) ? el('span', { text: `from ${money(release)}` }) : null,
      multi && availabilityLabel(release.availability)
        ? el('span', {
            class: 'avail',
            dataset: { v: release.availability },
            text: availabilityLabel(release.availability),
          })
        : null,
      release.sku ? el('span', { class: 'accession', text: `#${release.sku}` }) : null,
    ]),
  ]);
}

function sellerName(sourceId) {
  return state.meta?.sources?.find((s) => s.id === sourceId)?.label ?? sourceId;
}

/* --------------------------------------------------------------- chrome */

function renderMeta() {
  const node = $('[data-radar-meta]');
  if (!node || !state.meta) return;
  clear(node);

  const ok = state.meta.sources.filter((s) => s.ok);
  const broken = state.meta.sources.filter((s) => !s.ok);

  node.append(
    el('ul', { class: 'tally' }, [
      el('li', {}, [el('b', { text: String(state.releases.length) }), 'tracked']),
      el('li', {}, [el('b', { text: `${ok.length}/${state.meta.sources.length}` }), 'sources live']),
      el('li', {}, [
        el('b', { text: formatDate(state.meta.generatedAt) || '' }),
        'last checked',
      ]),
      el('li', {}, [el('a', { href: `${BASE}sources/`, text: 'Source health' })]),
    ]),
  );

  if (broken.length) {
    node.append(
      el('p', {
        class: 'hint',
        text: `${broken.map((s) => s.label).join(' and ')} could not be read on the last run, so those rows are from an earlier one.`,
      }),
    );
  }
}

function renderStages() {
  const nav = $('[data-stages]');
  if (!nav) return;
  clear(nav);
  const counts = countByStage(state.releases);

  for (const stage of STAGES) {
    if (stage.id !== 'all' && counts[stage.id] === 0) continue;
    nav.append(
      el(
        'button',
        {
          type: 'button',
          class: 'stage',
          'aria-pressed': String(state.filter.stage === stage.id),
          onClick: () => update({ stage: stage.id }),
        },
        [stage.label, el('span', { class: 'stage-count', text: String(counts[stage.id] ?? 0) })],
      ),
    );
  }
}

function selectControl(label, values, key, labels) {
  const node = el('select', { 'aria-label': label }, [
    el('option', { value: '', text: label }),
    ...values.map((v) => el('option', { value: v, text: labels?.[v] ?? v })),
  ]);
  node.value = state.filter[key] ?? '';
  node.addEventListener('change', () => update({ [key]: node.value }));
  return node;
}

function activeFilterCount() {
  return Object.entries(state.filter).filter(
    ([key, value]) => key !== 'stage' && value !== '' && value != null,
  ).length;
}

function renderFilters() {
  const mount = $('[data-radar-filters]');
  if (!mount) return;
  clear(mount);
  const f = facets(state.releases);

  const search = el('input', {
    type: 'search',
    placeholder: 'Search releases',
    'aria-label': 'Search releases',
    autocomplete: 'off',
    value: state.filter.text,
  });
  search.addEventListener('input', debounce(() => update({ text: search.value }, { replace: true }), 200));

  const dateInput = (key, label) => {
    const node = el('input', { type: 'date', 'aria-label': label, value: state.filter[key] });
    node.addEventListener('change', () => update({ [key]: node.value }));
    return node;
  };
  const priceInput = (key, label) => {
    const node = el('input', {
      type: 'number',
      min: '0',
      step: '1',
      placeholder: label,
      'aria-label': label,
      value: state.filter[key],
    });
    node.addEventListener('change', () => update({ [key]: node.value }));
    return node;
  };

  const fields = el('div', { class: 'filter-grid' }, [
    search,
    selectControl('All makers', f.manufacturers, 'manufacturer'),
    selectControl('All lines', f.lines, 'line'),
    selectControl('All franchises', f.licenses, 'license'),
    selectControl('All sellers', f.retailers, 'retailer'),
    selectControl('All types', f.categories, 'category', CATEGORY_LABELS),
    selectControl('Any availability', f.availabilities, 'availability', {
      'in-stock': 'In stock',
      'pre-order': 'Preorder',
      'out-of-stock': 'Sold out',
      waitlist: 'Waitlist',
      announced: 'Announced',
    }),
    el('div', { class: 'range' }, [dateInput('from', 'Released from'), dateInput('to', 'Released to')]),
    el('div', { class: 'range' }, [priceInput('minPrice', 'Min $'), priceInput('maxPrice', 'Max $')]),
  ]);

  const active = activeFilterCount();
  const panel = el('details', { class: 'filter-panel', open: active > 0 || innerWidth >= 720 }, [
    el('summary', {}, [
      'Filters',
      active ? el('span', { class: 'stage-count', text: String(active) }) : null,
    ]),
    fields,
  ]);
  mount.append(panel);
}

function renderToolbar(visible) {
  const mount = $('[data-radar-tools]');
  if (!mount) return;
  clear(mount);

  const summary = describeFilter(state.filter, STAGE_LABELS);
  const search = searchFromFilter(state.filter);

  mount.append(
    el('p', { class: 'hint', text: `${plural(visible.length, 'release')}${summary ? `: ${summary}` : ''}` }),
    el('div', { class: 'tool-links' }, [
      el('a', {
        class: 'btn btn-sm',
        href: `${BASE}feed.xml`,
        text: 'RSS',
        title: 'Full radar feed',
      }),
      el('a', { class: 'btn btn-sm', href: `${BASE}feed.json`, text: 'JSON' }),
      el('button', {
        type: 'button',
        class: 'btn btn-sm',
        text: 'CSV',
        onClick: () => {
          downloadFile(exportFilename('csv', state.filter), toCsv(visible), 'text/csv');
          toast(`Exported ${plural(visible.length, 'release')}.`);
        },
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-sm',
        text: 'Calendar',
        onClick: () => {
          const dated = visible.filter((r) => r.releaseDate);
          if (!eventCount(dated)) {
            toast('Nothing in this view has a date yet.');
            return;
          }
          downloadFile(exportFilename('ics', state.filter), buildCalendar(dated), 'text/calendar');
          toast(`Saved ${plural(eventCount(dated), 'date')}.`);
        },
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-sm',
        text: 'Copy link',
        onClick: async () => {
          const url = `${location.origin}${location.pathname}${search}`;
          try {
            await navigator.clipboard.writeText(url);
            toast('Link copied. It opens this exact view anywhere.');
          } catch {
            toast(url);
          }
        },
      }),
      search
        ? el('button', {
            type: 'button',
            class: 'btn btn-sm btn-quiet',
            text: 'Clear filters',
            onClick: () => update({ ...EMPTY_FILTER }),
          })
        : null,
    ]),
  );
}

function renderList() {
  const mount = $('[data-radar-list]');
  clear(mount);

  const visible = sortForStage(filterReleases(state.releases, state.filter), state.filter.stage);
  renderToolbar(visible);

  if (!visible.length) {
    mount.append(
      el('div', { class: 'empty' }, [
        el('h2', { text: 'Nothing matches' }),
        el('p', { text: 'Try a wider date range, or clear the filters.' }),
      ]),
    );
    return;
  }

  const list = el('ul', { class: 'radar-list' });
  for (const release of visible) list.append(releaseRow(release));
  mount.append(list);
}

function render() {
  renderMeta();
  renderStages();
  renderFilters();
  renderList();
}

/** Change the filter, push it into the URL, redraw. */
function update(patch, { replace = false } = {}) {
  state.filter = { ...state.filter, ...patch };
  writeFilterToUrl(state.filter, { replace });
  render();
}

/* ----------------------------------------------------------------- data */

async function load() {
  const mount = $('[data-radar-list]');
  try {
    const res = await fetch(`${BASE}data/releases.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`The release file returned ${res.status}.`);
    const payload = await res.json();
    state.releases = withStages(Array.isArray(payload.releases) ? payload.releases : []);
    state.meta = { generatedAt: payload.generatedAt, sources: payload.sources ?? [] };
    state.filter = filterFromSearch(location.search);
    render();
  } catch (err) {
    clear(mount).append(
      el('div', { class: 'empty' }, [
        el('h2', { text: 'Could not load the radar' }),
        el('p', { text: describeError(err) }),
      ]),
    );
  }
}

addEventListener('popstate', () => {
  state.filter = filterFromSearch(location.search);
  render();
});

load();
