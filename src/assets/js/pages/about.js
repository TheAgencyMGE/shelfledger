/**
 * Renders the coverage list on the about page straight from the feed.
 *
 * Written this way so the page cannot claim a manufacturer the scraper is not
 * actually reading. Both lists come out of data/releases.json, which the daily
 * job writes, so the page is wrong only if the data is.
 */

import { $, el, clear, describeError, BASE } from '../ui.js';

function sourceRow(source) {
  return el('li', { class: source.ok ? 'cov cov-ok' : 'cov cov-down' }, [
    el('div', {}, [
      el('strong', { text: source.label }),
      source.ok
        ? el('span', { class: 'muted', text: ` ${source.count} tracked` })
        : el('span', { class: 'muted', text: ' not readable on the last run' }),
    ]),
    el('a', {
      class: 'muted',
      href: source.homepage,
      rel: 'noopener nofollow',
      target: '_blank',
      text: new URL(source.homepage).hostname,
    }),
  ]);
}

function gapRow(entry) {
  return el('li', { class: 'cov cov-gap' }, [
    el('div', {}, [
      el('strong', { text: entry.label }),
      entry.lines?.length ? el('span', { class: 'muted', text: ` ${entry.lines.join(', ')}` }) : null,
      el('p', { class: 'hint', text: entry.reason }),
    ]),
  ]);
}

async function render() {
  const mount = $('[data-coverage]');
  if (!mount) return;
  try {
    const res = await fetch(`${BASE}data/releases.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`The release file returned ${res.status}.`);
    const payload = await res.json();

    clear(mount);
    mount.append(
      el('h3', { text: 'Sources being read' }),
      el('ul', { class: 'cov-list' }, (payload.sources ?? []).map(sourceRow)),
    );

    if (payload.unsupported?.length) {
      mount.append(
        el('h3', { text: 'Asked for, not working' }),
        el('p', {
          class: 'hint',
          text: 'These come up often. None of them are faked in the feed, and each one is here for a specific reason.',
        }),
        el('ul', { class: 'cov-list' }, payload.unsupported.map(gapRow)),
      );
    }
  } catch (err) {
    clear(mount).append(el('p', { class: 'muted', text: describeError(err) }));
  }
}

render();
