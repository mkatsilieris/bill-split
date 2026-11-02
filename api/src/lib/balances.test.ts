import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBalances, simplifyDebts } from './balances.ts';

test('balances: payer is credited, sharers are debited', () => {
  // user 1 paid 90, split equally among 1,2,3
  const balances = computeBalances(
    [1, 2, 3],
    [
      { expenseId: 1, paidBy: 1, userId: 1, amountCents: 3000 },
      { expenseId: 1, paidBy: 1, userId: 2, amountCents: 3000 },
      { expenseId: 1, paidBy: 1, userId: 3, amountCents: 3000 },
    ],
    [],
  );
  const net = Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));
  assert.deepEqual(net, { 1: 6000, 2: -3000, 3: -3000 });
});

test('settlement reduces debt', () => {
  const balances = computeBalances(
    [1, 2],
    [
      { expenseId: 1, paidBy: 1, userId: 1, amountCents: 500 },
      { expenseId: 1, paidBy: 1, userId: 2, amountCents: 500 },
    ],
    [{ fromUser: 2, toUser: 1, amountCents: 500 }],
  );
  assert.ok(balances.every((b) => b.netCents === 0));
});

test('simplifyDebts produces minimal greedy transfers that zero everyone', () => {
  const balances = computeBalances(
    [1, 2, 3],
    [
      { expenseId: 1, paidBy: 1, userId: 1, amountCents: 2000 },
      { expenseId: 1, paidBy: 1, userId: 2, amountCents: 2000 },
      { expenseId: 1, paidBy: 1, userId: 3, amountCents: 2000 },
      { expenseId: 2, paidBy: 2, userId: 1, amountCents: 1000 },
      { expenseId: 2, paidBy: 2, userId: 2, amountCents: 1000 },
      { expenseId: 2, paidBy: 2, userId: 3, amountCents: 1000 },
    ],
    [],
  );
  const transfers = simplifyDebts(balances);
  // user3 owes 3000 total; user1 is owed 3000; user2 is even.
  assert.deepEqual(transfers, [{ fromUser: 3, toUser: 1, amountCents: 3000 }]);
});

test('debt changes move balance between two members without an expense or a payment', () => {
  // 1 paid 100 split equally: 2 owes 50. A correction says 2 owes 20 less; a transfer into this
  // group says 2 owes 1 another 30.
  const balances = computeBalances(
    [1, 2],
    [
      { expenseId: 1, paidBy: 1, userId: 1, amountCents: 5000 },
      { expenseId: 1, paidBy: 1, userId: 2, amountCents: 5000 },
    ],
    [],
    [
      { debtor: 2, creditor: 1, amountCents: -2000 },
      { debtor: 2, creditor: 1, amountCents: 3000 },
    ],
  );
  const byUser = Object.fromEntries(balances.map((b) => [b.userId, b]));
  assert.equal(byUser[1].adjustedCents, 1000);
  assert.equal(byUser[2].adjustedCents, -1000);
  assert.equal(byUser[1].netCents, 6000);
  assert.equal(byUser[2].netCents, -6000);
  assert.deepEqual(simplifyDebts(balances), [{ fromUser: 2, toUser: 1, amountCents: 6000 }]);
});
