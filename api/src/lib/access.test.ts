import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameFromEmail } from '../access.js';

test('nameFromEmail builds a readable placeholder name', () => {
  assert.equal(nameFromEmail('maria.papadopoulou@example.com'), 'Maria Papadopoulou');
  assert.equal(nameFromEmail('stavroula_p-2@gmail.com'), 'Stavroula P 2');
  assert.equal(nameFromEmail('x@y.z'), 'X');
});
