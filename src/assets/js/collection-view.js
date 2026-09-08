/**
 * The shelf: filters, counts, and the grid of item cards.
 *
 * The collection page and the wishlist page are the same view with different
 * settings. A wishlist is this list pinned to status "want".
 */

import { $, el, clear, debounce, describeError } from './ui.js';
import { STATUS_LABELS, tally } from './model.js';
import { filterItems } from './search.js';
import * as store from './store.js';
import { openItemDialog } from './item-dialog.js';

function itemCard(item, { onChanged }) {
  // The left spine already says what the status is, so no status chip here.
  const meta = [item.license, item.series, item.condition === 'loose' ? 'Loose' : null]
    .filter(Boolean)
    .join(' · ');

  const tags = [];
  if (item.chase) tags.push(el('span', { class: 'tag tag-chase', text: 'Chase' }));
  if (item.exclusive) tags.push(el('span', { class: 'tag', text: item.exclusive }));

  // The whole card is the control. Editing, changing status, adjusting copies
  // and deleting all live in the sheet, so nothing needs a row of buttons.
  const body = el(
    'button',
    {
      type: 'button',
      class: 'item-hit',
      onClick: () => openItemDialog({ item, onSaved: onChanged, onDeleted: onChanged }),
    },
    [
      item.number || item.quantity > 1
        ? el('span', { class: 'item-top' }, [
            item.number ? el('span', { class: 'accession', text: `#${item.number}` }) : el('span'),
            item.quantity > 1 ? el('span', { class: 'qty', text: `×${item.quantity}` }) : null,
          ])
        : null,
      el('span', { class: 'item-name', text: item.name }),
      meta ? el('span', { class: 'item-meta', text: meta }) : null,
      tags.length ? el('span', { class: 'item-tags' }, tags) : null,
    ],
  );

  return el('li', { class: 'item', dataset: { status: item.status, id: item.id } }, [body]);
}

function tallyRow(counts, { fixedStatus }) {
  if (fixedStatus) {
    return el('ul', { class: 'tally' }, [
      el('li', { class: 't-want' }, [el('b', { text: String(counts.want) }), 'wanted']),
    ]);
  }
  const rows = [
    el('li', { class: 't-have' }, [el('b', { text: String(counts.have) }), 'have']),
    el('li', { class: 't-want' }, [el('b', { text: String(counts.want) }), 'want']),
  ];
  if (counts.had) rows.push(el('li', {}, [el('b', { text: String(counts.had) }), 'had']));
  if (counts.copies !== counts.have) {
    rows.push(el('li', {}, [el('b', { text: String(counts.copies) }), 'copies']));
  }
  return el('ul', { class: 'tally' }, rows);
}

/**
 * Wire up a shelf view.
 * @param {object} opts
 * @param {string} opts.root selector for the container
 * @param {string|null} opts.fixedStatus pin the list to one status
 * @param {Function} opts.renderEmpty builds the empty state for this page
 */
export function mountCollectionView({ root, fixedStatus = null, renderEmpty }) {
  const container = $(root);
  if (!container) return;

  const state = { text: '', status: fixedStatus ?? '', license: '', series: '' };

  // Controls carry their own labels through placeholder and option text, so no
  // separate row of field labels is needed above them.
  const searchInput = el('input', {
    type: 'search',
    placeholder: fixedStatus ? 'Search wishlist' : 'Search collection',
    'aria-label': fixedStatus ? 'Search your wishlist' : 'Search your collection',
    autocomplete: 'off',
  });
  const licenseSelect = el('select', { 'aria-label': 'Filter by licence' });
  const seriesSelect = el('select', { 'aria-label': 'Filter by series' });

  const statusSeg = fixedStatus
    ? null
    : el('div', { class: 'seg', role: 'group', 'aria-label': 'Filter by status' }, [
        ...['', 'have', 'want', 'had'].map((value) =>
          el('button', {
            type: 'button',
            text: value ? STATUS_LABELS[value] : 'All',
            'aria-pressed': String(state.status === value),
            onClick: (event) => {
              state.status = value;
              for (const b of event.currentTarget.parentElement.children) {
                b.setAttribute('aria-pressed', String(b === event.currentTarget));
              }
              render();
            },
          }),
        ),
      ]);

  const filters = el(
    'div',
    { class: 'filters' },
    [searchInput, licenseSelect, seriesSelect, statusSeg].filter(Boolean),
  );

  const tallyMount = el('div');
  const listMount = el('div');
  container.append(filters, tallyMount, listMount);

  searchInput.addEventListener(
    'input',
    debounce(() => {
      state.text = searchInput.value;
      render();
    }, 140),
  );
  licenseSelect.addEventListener('change', () => {
    state.license = licenseSelect.value;
    render();
  });
  seriesSelect.addEventListener('change', () => {
    state.series = seriesSelect.value;
    render();
  });

  function fillSelect(select, values, label) {
    const previous = select.value;
    clear(select);
    select.append(el('option', { value: '', text: `All ${label}` }));
    for (const value of values) select.append(el('option', { value, text: value }));
    select.value = values.includes(previous) ? previous : '';
  }

  async function render() {
    let items;
    try {
      items = await store.allItems();
    } catch (err) {
      clear(listMount).append(el('p', { class: 'muted', text: describeError(err) }));
      return;
    }

    const scope = fixedStatus ? items.filter((i) => i.status === fixedStatus) : items;
    const facets = (field) =>
      [...new Set(scope.map((i) => i[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    fillSelect(licenseSelect, facets('license'), 'licences');
    fillSelect(seriesSelect, facets('series'), 'series');

    clear(tallyMount);
    clear(listMount);

    if (items.length === 0) {
      filters.hidden = true;
      listMount.append(renderEmpty());
      return;
    }
    filters.hidden = false;
    tallyMount.append(tallyRow(tally(scope), { fixedStatus }));

    const visible = filterItems(items, state);
    if (visible.length === 0) {
      listMount.append(
        el('div', { class: 'empty' }, [
          el('h2', { text: 'Nothing matches' }),
          el('p', { text: 'Try a shorter search, or clear the filters.' }),
        ]),
      );
      return;
    }

    const list = el('ul', { class: 'shelf' });
    for (const item of visible) list.append(itemCard(item, { onChanged: render }));
    listMount.append(list);
  }

  store.onChange(render);
  render();
  return { render };
}
