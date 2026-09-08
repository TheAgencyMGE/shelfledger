/**
 * The collection page: everything you own, want, or used to own.
 */

import { $, el, toast, describeError } from '../ui.js';
import { openItemDialog } from '../item-dialog.js';
import { openScanner, scanSupport } from '../scan.js';
import * as catalog from '../catalog.js';
import { mountCollectionView } from '../collection-view.js';

function emptyState() {
  return el('div', { class: 'empty' }, [
    el('h2', { text: 'Nothing here yet' }),
    el('p', { text: 'Add the first thing you own. It stays in this browser.' }),
    el('div', { class: 'empty-actions' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: 'Add item',
        onClick: () => openItemDialog({}),
      }),
      scanSupport().possible
        ? el('button', {
            type: 'button',
            class: 'btn',
            text: 'Scan',
            onClick: startScan,
          })
        : null,
      el('a', { class: 'btn', href: `${document.documentElement.dataset.base}backup/`, text: 'Import' }),
    ]),
  ]);
}

/** Scan first, then open the sheet with whatever the barcode told us. */
async function startScan() {
  try {
    const code = await openScanner();
    if (!code) return;
    const entry = await catalog.findByBarcode(code).catch(() => null);
    if (entry) {
      openItemDialog({ defaults: { ...catalog.toItemDraft(entry), barcode: code, status: 'have' } });
      toast(`Matched ${entry.name}.`);
    } else {
      openItemDialog({ defaults: { barcode: code, status: 'have' } });
      toast(`Scanned ${code}. Not in the catalogue yet, name it yourself.`);
    }
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

$('[data-add]')?.addEventListener('click', () => openItemDialog({}));

const scanButton = $('[data-scan-start]');
if (scanButton) {
  if (scanSupport().possible) scanButton.addEventListener('click', startScan);
  else scanButton.hidden = true;
}

mountCollectionView({ root: '[data-collection]', renderEmpty: emptyState });
