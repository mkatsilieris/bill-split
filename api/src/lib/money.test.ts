import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitByWeight, splitEqually, toCents } from './money.ts';

test('equal split distributes leftover cents and sums to total', () => {
  const shares = splitEqually(1000, [1, 2, 3]);
  const values = [...shares.values()];
  assert.equal(values.reduce((a, b) => a + b, 0), 1000);
  assert.deepEqual(values.sort(), [333, 333, 334].sort());
});

test('percentage split follows weights', () => {
  const shares = splitByWeight(10000, [
    { userId: 1, weight: 70 },
    { userId: 2, weight: 30 },
  ]);
  assert.equal(shares.get(1), 7000);
  assert.equal(shares.get(2), 3000);
});

test('members with zero weight get nothing', () => {
  const shares = splitByWeight(500, [
    { userId: 1, weight: 1 },
    { userId: 2, weight: 0 },
  ]);
  assert.equal(shares.get(1), 500);
  assert.equal(shares.has(2), false);
});

test('toCents avoids floating point drift', () => {
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents(0.1 + 0.2), 30);
});
