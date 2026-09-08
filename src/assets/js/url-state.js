/**
 * Filters live in the URL.
 *
 * This is the replacement for an account. Narrow the radar to Marvel Legends
 * preorders, copy the address bar, and that exact view opens on any device with
 * nothing stored anywhere. It is also what the feed links hang off: the same
 * query string that filters the page names a feed.
 */

import { EMPTY_FILTER } from './stages.js';

/** Short query keys, because these URLs get shared. */
const KEYS = {
  stage: 'stage',
  manufacturer: 'maker',
  line: 'line',
  license: 'license',
  retailer: 'seller',
  category: 'type',
  availability: 'status',
  from: 'from',
  to: 'to',
  minPrice: 'min',
  maxPrice: 'max',
  text: 'q',
};

/** Read a filter out of a query string. Unknown keys are ignored. */
export function filterFromSearch(search) {
  const params = new URLSearchParams(search);
  const filter = { ...EMPTY_FILTER };
  for (const [field, key] of Object.entries(KEYS)) {
    const value = params.get(key);
    if (value !== null) filter[field] = value;
  }
  if (!filter.stage) filter.stage = 'all';
  return filter;
}

/** The query string for a filter, with defaults left out so URLs stay short. */
export function searchFromFilter(filter) {
  const params = new URLSearchParams();
  for (const [field, key] of Object.entries(KEYS)) {
    const value = filter[field];
    if (value === undefined || value === null || value === '') continue;
    if (field === 'stage' && value === 'all') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** True when nothing is narrowed. */
export function isDefaultFilter(filter) {
  return searchFromFilter(filter) === '';
}

/**
 * Push the filter into the address bar without reloading, so back and forward
 * move through views and the URL is always copyable.
 */
export function writeFilterToUrl(filter, { replace = false } = {}) {
  const url = `${location.pathname}${searchFromFilter(filter)}`;
  if (url === `${location.pathname}${location.search}`) return;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

/** A human summary of what is being shown, used in headings and feed titles. */
export function describeFilter(filter, stageLabels = {}) {
  const bits = [];
  if (filter.stage && filter.stage !== 'all') bits.push(stageLabels[filter.stage] ?? filter.stage);
  for (const field of ['manufacturer', 'line', 'license', 'retailer']) {
    if (filter[field]) bits.push(filter[field]);
  }
  if (filter.category) bits.push(filter.category.replace(/-/g, ' '));
  if (filter.availability) bits.push(filter.availability.replace(/-/g, ' '));
  if (filter.text) bits.push(`"${filter.text}"`);
  return bits.join(', ');
}
