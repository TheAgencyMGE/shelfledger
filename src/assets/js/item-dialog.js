/**
 * The add / edit sheet, shared by the collection and wishlist pages.
 *
 * Built once and reused. Catalogue search is optional at every step: if the
 * thing you own is not in the shared dataset you type it in yourself and it is
 * exactly as real as a catalogued entry.
 */

import { $, el, clear, toast, debounce, describeError } from './ui.js';
import { STATUSES, CONDITIONS, CATEGORIES, STATUS_LABELS } from './model.js';
import * as catalog from './catalog.js';
import * as store from './store.js';
import { openScanner, scanSupport } from './scan.js';

const CATEGORY_LABELS = {
  'funko-pop': 'Vinyl figure (Pop-style)',
  'action-figure': 'Action figure',
  'anime-figure': 'Anime figure',
  statue: 'Statue',
  other: 'Other',
};

const CONDITION_LABELS = {
  boxed: 'Boxed',
  loose: 'Loose (out of box)',
  unknown: 'Not recorded',
};

let dialog = null;
let form = null;
let onSaved = null;
let onDeleted = null;
let editingItem = null;

function field(label, control, hint) {
  const id = control.id;
  return el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    control,
    hint ? el('p', { class: 'hint', text: hint }) : null,
  ]);
}

function input(name, attrs = {}) {
  return el('input', { id: `f-${name}`, name, ...attrs });
}

function select(name, options, labels) {
  return el(
    'select',
    { id: `f-${name}`, name },
    options.map((value) => el('option', { value, text: labels[value] ?? value })),
  );
}

function build() {
  const searchInput = input('catalogQuery', {
    type: 'search',
    placeholder: 'Name or item number',
    autocomplete: 'off',
    enterkeyhint: 'search',
  });
  const results = el('ul', { class: 'results', 'data-results': '' });

  const scanBtn = el('button', {
    type: 'button',
    class: 'btn btn-sm',
    text: 'Scan',
    'data-scan': '',
  });

  form = el('form', { id: 'item-form', method: 'dialog' }, [
    el('div', { class: 'field', 'data-catalog-block': '' }, [
      el('label', { for: 'f-catalogQuery', text: 'Search the catalogue' }),
      el('div', { style: 'display:flex;gap:.5rem;align-items:flex-start' }, [searchInput, scanBtn]),
      el('p', { class: 'hint', text: 'Optional. Not listed? Just type it in below.' }),
      results,
    ]),

    field('Name', input('name', { type: 'text', required: true, maxlength: '200', autocomplete: 'off' })),

    el('div', { class: 'field-row' }, [
      field('Item number', input('number', { type: 'text', maxlength: '32', autocomplete: 'off' })),
      field('Licence or fandom', input('license', { type: 'text', maxlength: '120', autocomplete: 'off' })),
    ]),
    el('div', { class: 'field-row' }, [
      field('Series or line', input('series', { type: 'text', maxlength: '120', autocomplete: 'off' })),
      field('Type', select('category', CATEGORIES, CATEGORY_LABELS)),
    ]),

    el('div', { class: 'field-row' }, [
      field('Status', select('status', STATUSES, STATUS_LABELS)),
      field('Copies', input('quantity', { type: 'number', min: '1', max: '9999', value: '1', inputmode: 'numeric' })),
      field('Condition', select('condition', CONDITIONS, CONDITION_LABELS)),
    ]),

    el('div', { class: 'field-row' }, [
      field('Exclusive to', input('exclusive', { type: 'text', maxlength: '80', placeholder: 'Target, SDCC', autocomplete: 'off' })),
      field('Paid', input('paid', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal' })),
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', id: 'f-chase', name: 'chase' }),
        'Chase variant',
      ]),
    ]),

    field('Barcode', input('barcode', { type: 'text', maxlength: '32', inputmode: 'numeric', autocomplete: 'off' })),
    field('Notes', el('textarea', { id: 'f-notes', name: 'notes', rows: '2', maxlength: '2000' })),
    input('id', { type: 'hidden' }),
    input('catalogId', { type: 'hidden' }),
    input('addedAt', { type: 'hidden' }),
  ]);

  dialog = el('dialog', { 'data-item-dialog': '' }, [
    el('div', { class: 'dialog-head' }, [
      el('h2', { 'data-dialog-title': '', text: 'Add item' }),
      el('button', { type: 'button', class: 'btn btn-sm', text: 'Close', 'data-close': '' }),
    ]),
    el('div', { class: 'dialog-body' }, [form]),
    el('div', { class: 'dialog-foot' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-danger',
        text: 'Delete',
        'data-delete': '',
        style: 'margin-right:auto',
      }),
      el('button', { type: 'button', class: 'btn', text: 'Cancel', 'data-close': '' }),
      el('button', { type: 'submit', form: 'item-form', class: 'btn btn-primary', text: 'Save' }),
    ]),
  ]);

  document.body.append(dialog);

  for (const btn of dialog.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => dialog.close());
  }
  form.addEventListener('submit', handleSubmit);
  $('[data-delete]', dialog).addEventListener('click', handleDelete);
  searchInput.addEventListener('input', debounce(() => runSearch(searchInput.value, results), 200));
  scanBtn.addEventListener('click', handleScan);

  if (!scanSupport().possible) scanBtn.hidden = true;
}

async function runSearch(query, results) {
  clear(results);
  if (query.trim().length < 2) return;
  let entries;
  try {
    entries = await catalog.search(query, 12);
  } catch (err) {
    results.append(el('li', { class: 'hint', style: 'padding:.6rem .7rem', text: describeError(err) }));
    return;
  }
  if (!entries.length) {
    results.append(
      el('li', {
        class: 'hint',
        style: 'padding:.6rem .7rem',
        text: 'No match. Fill in the details below.',
      }),
    );
    return;
  }
  for (const entry of entries) {
    results.append(
      el('li', {}, [
        el(
          'button',
          {
            type: 'button',
            class: 'result',
            onClick: () => {
              applyDraft(catalog.toItemDraft(entry));
              clear(results);
              toast(`Filled in ${entry.name}.`);
              form.elements.name.focus();
            },
          },
          [
            entry.number ? el('span', { class: 'accession', text: `#${entry.number}` }) : null,
            el('span', { class: 'result-name', text: entry.name }),
            entry.license ? el('span', { class: 'result-lic', text: entry.license }) : null,
          ],
        ),
      ]),
    );
  }
}

async function handleScan() {
  try {
    const code = await openScanner();
    if (!code) return;
    form.elements.barcode.value = code;
    const entry = await catalog.findByBarcode(code).catch(() => null);
    if (entry) {
      applyDraft(catalog.toItemDraft(entry));
      toast(`Matched ${entry.name}.`);
    } else {
      toast(`Scanned ${code}. Not in the catalogue, so name it yourself.`);
      form.elements.name.focus();
    }
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

/** Fill the catalogue-derived fields without clobbering what someone typed. */
function applyDraft(draft) {
  for (const [key, value] of Object.entries(draft)) {
    const control = form.elements[key];
    if (!control || value === null || value === undefined) continue;
    control.value = value;
  }
}

function readForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    ...data,
    chase: form.elements.chase.checked,
    quantity: Number(data.quantity || 1),
    paid: data.paid === '' ? null : data.paid,
  };
}

async function handleDelete() {
  if (!editingItem) return;
  const ok = confirm(`Remove "${editingItem.name}"? This cannot be undone.`);
  if (!ok) return;
  try {
    await store.deleteItem(editingItem.id);
    dialog.close();
    toast(`Removed ${editingItem.name}.`);
    onDeleted?.(editingItem);
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  try {
    const saved = await store.saveItem(readForm());
    dialog.close();
    toast(`Saved ${saved.name}.`);
    onSaved?.(saved);
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

function reset(values = {}) {
  form.reset();
  for (const [key, value] of Object.entries(values)) {
    const control = form.elements[key];
    if (!control) continue;
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = value ?? '';
  }
  clear($('[data-results]', dialog));
  const query = form.elements.catalogQuery;
  if (query) query.value = '';
}

/**
 * Open the sheet. Pass `item` to edit an existing entry, or `defaults` to
 * pre-set fields on a new one (the wishlist page opens it with status "want").
 */
export function openItemDialog({
  item = null,
  defaults = {},
  onSaved: cb = null,
  onDeleted: deleteCb = null,
} = {}) {
  if (!dialog) build();
  onSaved = cb;
  onDeleted = deleteCb;
  editingItem = item;

  const editing = Boolean(item);
  $('[data-delete]', dialog).hidden = !editing;
  $('[data-dialog-title]', dialog).textContent = editing ? 'Edit item' : 'Add item';
  $('[data-catalog-block]', dialog).hidden = editing;

  // Explicit defaults, so a select's first option never records a fact about
  // someone's collection that they did not actually state.
  reset(
    editing
      ? item
      : { status: 'have', quantity: 1, category: 'funko-pop', condition: 'unknown', ...defaults },
  );

  dialog.showModal();
  const first = editing ? form.elements.name : form.elements.catalogQuery;
  requestAnimationFrame(() => (editing || !first ? form.elements.name : first).focus());
}
