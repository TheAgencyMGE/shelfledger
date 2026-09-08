/**
 * Export and import.
 *
 * This page is the replacement for an account. There is no sync service to fall
 * back on, so the file it produces has to be complete, readable, and reliable 
 * treat any change here as a change to the only copy of someone's data.
 */

import { $, el, clear, toast, downloadFile, readFileText, describeError, formatDate, plural } from '../ui.js';
import { serialise, parseImport, mergeItems, backupFilename, ImportError } from '../backup-format.js';
import * as store from '../store.js';
import * as db from '../db.js';

let pending = null; // parsed file waiting on a merge/replace decision

async function refreshSummary() {
  const node = $('[data-summary]');
  if (!node) return;
  try {
    const items = await store.allItems();
    const usage = await db.estimateUsage();
    clear(node);
    node.append(
      el('ul', { class: 'tally' }, [
        el('li', {}, [el('b', { text: String(items.length) }), 'items']),
        items.length ? el('li', {}, [el('b', { text: formatDate(items[0].updatedAt) }), 'last change']) : null,
        usage?.usage
          ? el('li', {}, [el('b', { text: `${(usage.usage / 1024).toFixed(0)}kb` }), 'stored'])
          : null,
      ]),
    );
  } catch (err) {
    clear(node).append(el('p', { class: 'muted', text: describeError(err) }));
  }
}

async function doExport() {
  try {
    const [items, settings] = await Promise.all([store.allItems(), store.allSettings()]);
    if (!items.length) {
      toast('There is nothing to export yet.');
      return;
    }
    downloadFile(backupFilename(), serialise(items, settings));
    toast(`Exported ${plural(items.length, 'item')}.`);
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

function renderPending() {
  const node = $('[data-import-preview]');
  clear(node);
  if (!pending) {
    node.hidden = true;
    return;
  }
  node.hidden = false;

  const lines = [
    `${plural(pending.items.length, 'item')} in the file.`,
    pending.exportedAt ? `Exported ${formatDate(pending.exportedAt)}.` : null,
    pending.skipped.length ? `${plural(pending.skipped.length, 'record')} skipped as unreadable.` : null,
  ].filter(Boolean);

  node.append(
    el('h3', { text: 'Ready to import' }),
    el('p', { class: 'hint', text: lines.join(' ') }),
    el('div', { class: 'empty-actions', style: 'justify-content:flex-start;margin-top:.75rem' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: 'Merge',
        onClick: () => applyImport('merge'),
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-danger',
        text: 'Replace all',
        onClick: () => applyImport('replace'),
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-quiet',
        text: 'Cancel',
        onClick: () => {
          pending = null;
          renderPending();
        },
      }),
    ]),
  );

  if (pending.skipped.length) {
    node.append(
      el(
        'ul',
        { class: 'hint', style: 'margin-top:.75rem;padding-left:1.1rem' },
        pending.skipped
          .slice(0, 5)
          .map((s) => el('li', { text: `Row ${s.index + 1} (${s.name}): ${s.errors.join(' ')}` })),
      ),
    );
  }
}

async function applyImport(mode) {
  if (!pending) return;
  try {
    if (mode === 'replace') {
      const ok = confirm(
        `Replace your collection with ${pending.items.length} items?\n\nWhat is in this browser now will be gone.`,
      );
      if (!ok) return;
      await store.replaceCollection(pending.items);
      if (Object.keys(pending.settings).length) await store.replaceSettings(pending.settings);
      toast(`Replaced your collection with ${plural(pending.items.length, 'item')}.`);
    } else {
      const existing = await store.allItems();
      const { items, added, updated, unchanged } = mergeItems(existing, pending.items);
      await store.replaceCollection(items);
      toast(`Merged: ${added} added, ${updated} updated, ${unchanged} already current.`);
    }
    pending = null;
    renderPending();
    await refreshSummary();
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

async function handleFile(file) {
  if (!file) return;
  try {
    pending = parseImport(await readFileText(file));
    if (!pending.items.length) {
      pending = null;
      toast('That backup has no usable items in it.', 'error');
      return;
    }
    renderPending();
  } catch (err) {
    pending = null;
    renderPending();
    toast(err instanceof ImportError ? err.message : describeError(err), 'error');
  }
}

async function wipe() {
  const ok = confirm(
    'Delete everything stored in this browser?\n\nThis cannot be undone and there is no copy on a server.',
  );
  if (!ok) return;
  try {
    await store.clearCollection();
    toast('Collection cleared.');
    await refreshSummary();
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

$('[data-export]')?.addEventListener('click', doExport);
$('[data-wipe]')?.addEventListener('click', wipe);

const fileInput = $('[data-import-file]');
fileInput?.addEventListener('change', (event) => {
  handleFile(event.target.files?.[0]);
  event.target.value = '';
});

refreshSummary();
