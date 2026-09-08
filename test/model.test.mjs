import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseItem, validateItem, tally, newId } from '../src/assets/js/model.js';

test('normaliseItem fills in sensible defaults', () => {
  const item = normaliseItem({ name: 'Pop! Batman' });
  assert.equal(item.name, 'Pop! Batman');
  assert.equal(item.status, 'have');
  assert.equal(item.quantity, 1);
  assert.equal(item.condition, 'unknown');
  assert.equal(item.category, 'funko-pop');
  assert.equal(item.chase, false);
  assert.ok(item.id.length > 10);
  assert.ok(item.addedAt.endsWith('Z'));
});

test('normaliseItem rejects junk from a hand-edited backup', () => {
  const item = normaliseItem({
    name: '  Spaced Out  ',
    status: 'STOLEN',
    quantity: -4,
    condition: 'mint-in-box',
    category: 'spaceship',
    paid: 'free',
    barcode: ' 889 698 1234 ',
  });
  assert.equal(item.name, 'Spaced Out');
  assert.equal(item.status, 'have', 'unknown status falls back');
  assert.equal(item.quantity, 1, 'negative quantity floors at one');
  assert.equal(item.condition, 'unknown');
  assert.equal(item.category, 'funko-pop');
  assert.equal(item.paid, null, 'unparseable money becomes null');
  assert.equal(item.barcode, '8896981234', 'whitespace stripped');
});

test('normaliseItem caps runaway values', () => {
  const item = normaliseItem({ name: 'x'.repeat(500), quantity: 1e9, notes: 'y'.repeat(5000) });
  assert.equal(item.name.length, 200);
  assert.equal(item.quantity, 9999);
  assert.equal(item.notes.length, 2000);
});

test('normaliseItem rounds money to cents', () => {
  assert.equal(normaliseItem({ name: 'a', paid: '12.999' }).paid, 13);
  assert.equal(normaliseItem({ name: 'a', paid: 0 }).paid, 0);
  assert.equal(normaliseItem({ name: 'a', paid: '' }).paid, null);
});

test('validateItem insists on a name', () => {
  assert.deepEqual(validateItem(normaliseItem({ name: '' })).length, 1);
  assert.deepEqual(validateItem(normaliseItem({ name: 'Fine' })), []);
});

test('tally counts statuses, copies and licences', () => {
  const items = [
    normaliseItem({ name: 'a', status: 'have', quantity: 3, license: 'DC' }),
    normaliseItem({ name: 'b', status: 'have', quantity: 1, license: 'DC' }),
    normaliseItem({ name: 'c', status: 'want', license: 'Marvel' }),
    normaliseItem({ name: 'd', status: 'had' }),
  ];
  const counts = tally(items);
  assert.equal(counts.have, 2);
  assert.equal(counts.want, 1);
  assert.equal(counts.had, 1);
  assert.equal(counts.copies, 4, 'only owned copies are counted');
  assert.equal(counts.licenses, 2);
});

test('newId produces distinct ids', () => {
  const ids = new Set(Array.from({ length: 500 }, newId));
  assert.equal(ids.size, 500);
});
