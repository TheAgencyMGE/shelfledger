/**
 * The wishlist: the same shelf, pinned to status "want".
 *
 * Nothing about this list is stored anywhere but here, which is why the
 * release radar has to do its matching in the browser.
 */

import { $, el } from '../ui.js';
import { openItemDialog } from '../item-dialog.js';
import { mountCollectionView } from '../collection-view.js';

const BASE = document.documentElement.dataset.base || '/';

function emptyState() {
  return el('div', { class: 'empty' }, [
    el('h2', { text: 'Nothing on the hunt list' }),
    el('p', { text: 'Add something you are after. The radar flags it when it shows up.' }),
    el('div', { class: 'empty-actions' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: 'Add item',
        onClick: () => openItemDialog({ defaults: { status: 'want' } }),
      }),
      el('a', { class: 'btn', href: `${BASE}radar/`, text: 'Release radar' }),
    ]),
  ]);
}

$('[data-add-want]')?.addEventListener('click', () =>
  openItemDialog({ defaults: { status: 'want' } }),
);

mountCollectionView({ root: '[data-wishlist]', fixedStatus: 'want', renderEmpty: emptyState });
