import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenise,
  significantTokens,
  tokenSimilarity,
  scoreEntry,
  searchEntries,
  filterItems,
} from '../src/assets/js/search.js';
import { normaliseItem } from '../src/assets/js/model.js';

test('tokenise strips punctuation, case and accents', () => {
  assert.deepEqual(tokenise('Pop! Batman (Glow-in-the-Dark)'), [
    'pop', 'batman', 'glow', 'in', 'the', 'dark',
  ]);
  assert.deepEqual(tokenise('Pokémon Pikachu'), ['pokemon', 'pikachu']);
  assert.deepEqual(tokenise(''), []);
  assert.deepEqual(tokenise(null), []);
});

test('significantTokens drops hobby filler words', () => {
  assert.deepEqual(significantTokens('Pop! Vinyl Figure Batman'), ['batman']);
  assert.ok(significantTokens('Pop! 08').includes('08'), 'numbers are kept');
});

test('tokenSimilarity recognises the same figure written differently', () => {
  assert.ok(tokenSimilarity('Pop! Batman Beyond', 'Batman Beyond') > 0.9);
  assert.ok(tokenSimilarity('Pop! Chun-Li (2026)', 'Chun Li 2026') > 0.9);
  assert.ok(tokenSimilarity('Pop! Batman', 'Pop! Superman') < 0.5);
  assert.equal(tokenSimilarity('', 'anything'), 0);
});

const catalogue = [
  { id: 'funko-93125', name: 'Pop! Batman Beyond', number: '93125', license: 'DC Comics' },
  { id: 'funko-93126', name: 'Pop! Batman Zur-En-Arrh', number: '93126', license: 'DC Comics' },
  { id: 'funko-94168', name: 'Pop! Chun-Li (2026)', number: '94168', license: 'Street Fighter' },
  { id: 'funko-96240', name: 'Pop! Mystery Flora 6-Pack', number: '96240', license: null },
];

test('every typed word has to match something', () => {
  assert.equal(scoreEntry('batman beyond', catalogue[0]) > 0, true);
  assert.equal(scoreEntry('batman spaceship', catalogue[0]), 0);
});

test('search ranks the closest name first', () => {
  const results = searchEntries('batman', catalogue);
  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Pop! Batman Beyond');
});

test('search finds an item by its number', () => {
  const results = searchEntries('94168', catalogue);
  assert.equal(results[0].id, 'funko-94168');
});

test('search matches on licence as well as name', () => {
  const results = searchEntries('street fighter', catalogue);
  assert.equal(results[0].id, 'funko-94168');
});

test('search ignores queries too short to be useful', () => {
  assert.deepEqual(searchEntries('b', catalogue), []);
  assert.deepEqual(searchEntries('', catalogue), []);
});

const collection = [
  normaliseItem({ name: 'Pop! Batman Beyond', license: 'DC Comics', series: 'Heroes', status: 'have' }),
  normaliseItem({ name: 'Pop! Rhysand', license: 'ACOTAR', status: 'want' }),
  normaliseItem({ name: 'Pop! Chun-Li', license: 'Street Fighter', status: 'had' }),
];

test('filterItems combines status, licence and free text', () => {
  assert.equal(filterItems(collection, { status: 'want' }).length, 1);
  assert.equal(filterItems(collection, { license: 'DC Comics' }).length, 1);
  assert.equal(filterItems(collection, { text: 'chun' }).length, 1);
  assert.equal(filterItems(collection, { text: 'pop' }).length, 3);
  assert.equal(filterItems(collection, { text: 'batman', status: 'want' }).length, 0);
  assert.equal(filterItems(collection, {}).length, 3);
});

test('free text requires every word to appear', () => {
  assert.equal(filterItems(collection, { text: 'batman beyond' }).length, 1);
  assert.equal(filterItems(collection, { text: 'batman rhysand' }).length, 0);
});
