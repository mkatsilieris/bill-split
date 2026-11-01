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
