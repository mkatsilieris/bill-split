import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBalances,
  simplifyDebts,
  simplifyDebtsGreedy,
  EXACT_SIMPLIFY_MAX_MEMBERS,
  type Balance,
  type Transfer,
} from './balances.ts';

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

test('simplifyDebts settles a simple group with one transfer', () => {
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

// ---------------------------------------------------------------- minimum number of payments

function fromNets(nets: number[]): Balance[] {
  return nets.map((netCents, i) => ({
    userId: i + 1,
    paidCents: 0,
    owedCents: 0,
    settledOutCents: 0,
    settledInCents: 0,
    adjustedCents: 0,
    netCents,
  }));
}

/** Checks that the transfers bring everyone to zero and that money only goes from debtors to creditors. */
function assertSettles(nets: number[], transfers: Transfer[]) {
  const left = [...nets];
  for (const t of transfers) {
    assert.ok(t.amountCents > 0, 'positive amount');
    assert.ok(nets[t.fromUser - 1] < 0, 'payer is a debtor');
    assert.ok(nets[t.toUser - 1] > 0, 'receiver is a creditor');
    left[t.fromUser - 1] += t.amountCents;
    left[t.toUser - 1] -= t.amountCents;
  }
  assert.ok(left.every((c) => c === 0), `everyone at zero, got ${left}`);
}

/** Independent reference: fewest transfers by trying every way to clear the first open balance. */
function bruteMin(nets: number[]): number {
  const a = nets.filter((c) => c !== 0);
  const go = (start: number): number => {
    while (start < a.length && a[start] === 0) start++;
    if (start === a.length) return 0;
    let min = Infinity;
    for (let i = start + 1; i < a.length; i++) {
      if (a[i] * a[start] < 0) {
        a[i] += a[start];
        min = Math.min(min, 1 + go(start + 1));
        a[i] -= a[start];
      }
    }
    return min;
  };
  return go(0);
}

/** Small deterministic random generator, so a failure is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomNets(rand: () => number, n: number): number[] {
  // small amounts in steps of 5 euro, so that sub-groups summing to zero are common
  const nets = Array.from({ length: n - 1 }, () => (Math.floor(rand() * 13) - 6) * 500);
  nets.push(-nets.reduce((x, y) => x + y, 0));
  return nets;
}

test('simplifyDebts finds the minimum where the greedy matching does not', () => {
  const nets = [4000, 3000, 3000, -2000, -2000, -6000];
  const balances = fromNets(nets);
  assert.equal(simplifyDebtsGreedy(balances).length, 5);
  const transfers = simplifyDebts(balances);
  assert.equal(transfers.length, 4);
  assertSettles(nets, transfers);
});

test('simplifyDebts keeps the greedy result when it is already minimal', () => {
  const balances = fromNets([5000, 2000, -3000, -4000, 0]);
  assert.deepEqual(simplifyDebts(balances), simplifyDebtsGreedy(balances));
});

test('simplifyDebts: nothing to pay when everyone is at zero or the group is empty', () => {
  assert.deepEqual(simplifyDebts([]), []);
  assert.deepEqual(simplifyDebts(fromNets([0, 0, 0])), []);
});

test('simplifyDebts matches the brute-force minimum for random groups up to the limit', () => {
  const rand = rng(20261116);
  let improved = 0;
  for (let round = 0; round < 400; round++) {
    const n = 2 + Math.floor(rand() * (EXACT_SIMPLIFY_MAX_MEMBERS - 1)); // 2..10
    const nets = randomNets(rand, n);
    const balances = fromNets(nets);
    const transfers = simplifyDebts(balances);
    assertSettles(nets, transfers);
    assert.equal(transfers.length, bruteMin(nets), `nets ${nets}`);
    if (transfers.length < simplifyDebtsGreedy(balances).length) improved++;
  }
  assert.ok(improved > 0, 'the random groups include cases where the exact search beats the greedy one');
});

test('simplifyDebts: members at zero do not count towards the limit', () => {
  // 10 members with a balance plus 5 at zero: still exact
  const nets = [4000, 3000, 3000, -2000, -2000, -6000, 1500, -1500, 700, -700, 0, 0, 0, 0, 0];
  const transfers = simplifyDebts(fromNets(nets));
  assertSettles(nets, transfers);
  assert.equal(transfers.length, 6);
});

test('simplifyDebts falls back to the greedy matching above the limit', () => {
  // 12 members with a balance: the minimum is 7 payments, the greedy matching needs more
  const nets = [4000, 3000, 3000, -2000, -2000, -6000, 1500, -1500, 700, -700, 900, -900];
  const balances = fromNets(nets);
  const transfers = simplifyDebts(balances);
  assertSettles(nets, transfers);
  assert.deepEqual(transfers, simplifyDebtsGreedy(balances));
  assert.ok(transfers.length > 7 && transfers.length <= nets.length - 1);
});

test('simplifyDebts is fast at the limit', () => {
  const rand = rng(7);
  const started = Date.now();
  for (let round = 0; round < 200; round++) {
    const nets = randomNets(rand, EXACT_SIMPLIFY_MAX_MEMBERS);
    assertSettles(nets, simplifyDebts(fromNets(nets)));
  }
  assert.ok(Date.now() - started < 2000, 'under 10 ms per group');
});
