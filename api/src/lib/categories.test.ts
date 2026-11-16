import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryName, NO_CATEGORY } from './categories.ts';

test('category name is trimmed and inner whitespace is collapsed', () => {
  assert.equal(categoryName.parse('  Κατοικίδια '), 'Κατοικίδια');
  assert.equal(categoryName.parse('Σούπερ   μάρκετ'), 'Σούπερ μάρκετ');
});

test('category name: empty, too long, with a comma or reserved is refused', () => {
  for (const bad of ['', '   ', 'x'.repeat(51), 'Φαγητό, ποτό', NO_CATEGORY, 42, null]) {
    assert.equal(categoryName.safeParse(bad).success, false, String(bad));
  }
  assert.equal(categoryName.safeParse('x'.repeat(50)).success, true);
});
