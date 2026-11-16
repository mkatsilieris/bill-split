/**
 * Balance computation for one group. Everything is in integer cents.
 *
 *   net(user) = paid(user) - owed(user) + settlementsPaid(user) - settlementsReceived(user) + adjusted(user)
 *
 *   adjusted(user): debt changes (manual corrections, debts moved from / to another group).
 *   A change "debtor owes creditor X more" is -X for the debtor and +X for the creditor.
 *
 *   net > 0  → the group owes this user
 *   net < 0  → this user owes the group
 */

export interface ShareRow {
  expenseId: number;
  paidBy: number;
  userId: number;
  amountCents: number; // the share this user owes for this expense
}

export interface SettlementRow {
  fromUser: number;
  toUser: number;
  amountCents: number;
}

export interface DebtChangeRow {
  debtor: number;
  creditor: number;
  /** positive = the debtor owes the creditor this much more, negative = less */
  amountCents: number;
}

export interface Balance {
  userId: number;
  paidCents: number;
  owedCents: number;
  settledOutCents: number;
  settledInCents: number;
  adjustedCents: number;
  netCents: number;
}

export interface Transfer {
  fromUser: number;
  toUser: number;
  amountCents: number;
}

export function computeBalances(
  memberIds: number[],
  shares: ShareRow[],
  settlements: SettlementRow[],
  debtChanges: DebtChangeRow[] = [],
): Balance[] {
  const byUser = new Map<number, Balance>();
  const get = (id: number): Balance => {
    let b = byUser.get(id);
    if (!b) {
      b = { userId: id, paidCents: 0, owedCents: 0, settledOutCents: 0, settledInCents: 0, adjustedCents: 0, netCents: 0 };
      byUser.set(id, b);
    }
    return b;
  };
  memberIds.forEach(get);

  for (const s of shares) {
    get(s.paidBy).paidCents += s.amountCents;
    get(s.userId).owedCents += s.amountCents;
  }
  for (const s of settlements) {
    get(s.fromUser).settledOutCents += s.amountCents;
    get(s.toUser).settledInCents += s.amountCents;
  }
  for (const c of debtChanges) {
    get(c.debtor).adjustedCents -= c.amountCents;
    get(c.creditor).adjustedCents += c.amountCents;
  }
  for (const b of byUser.values()) {
    b.netCents = b.paidCents - b.owedCents + b.settledOutCents - b.settledInCents + b.adjustedCents;
  }
  return [...byUser.values()];
}

/** Up to this many members with a non-zero balance the suggested payments are the true minimum. */
export const EXACT_SIMPLIFY_MAX_MEMBERS = 10;

interface Open {
  userId: number;
  /** signed: positive = is owed, negative = owes */
  cents: number;
}

/**
 * Suggested payments that bring everyone to zero.
 *
 * Up to EXACT_SIMPLIFY_MAX_MEMBERS members with a non-zero balance the number of payments is the
 * minimum possible. Above that the exact search gets too expensive (it is exponential), so the
 * greedy matching is used, which gives at most (n - 1) payments but not always the fewest.
 */
export function simplifyDebts(balances: Balance[]): Transfer[] {
  const open: Open[] = balances.filter((b) => b.netCents !== 0).map((b) => ({ userId: b.userId, cents: b.netCents }));
  const greedy = greedyTransfers(open);
  if (open.length > EXACT_SIMPLIFY_MAX_MEMBERS) return greedy;

  const groups = zeroSumGroups(open);
  // n members split into k groups that each sum to zero need n - k payments. When the greedy result
  // already has that many, keep it, so the suggestions change only when there is a real gain.
  if (greedy.length <= open.length - groups.length) return greedy;
  return groups
    .flatMap(greedyTransfers)
    .sort((a, b) => b.amountCents - a.amountCents || a.fromUser - b.fromUser || a.toUser - b.toUser);
}

/**
 * Greedy debt simplification: match the biggest debtor with the biggest creditor
 * until everyone is at zero. Produces at most (n - 1) transfers.
 */
export function simplifyDebtsGreedy(balances: Balance[]): Transfer[] {
  return greedyTransfers(balances.map((b) => ({ userId: b.userId, cents: b.netCents })));
}

/**
 * Splits the members into the largest possible number of groups that each sum to zero
 * (dynamic programming over subsets, 2^n * n steps). A group of m members settles within itself
 * with m - 1 payments, so more groups means fewer payments. If the balances do not sum to zero
 * (should not happen), one of the returned groups carries the difference.
 */
function zeroSumGroups(open: Open[]): Open[][] {
  const n = open.length;
  if (n === 0) return [];
  const size = 1 << n;
  const sum = new Array<number>(size).fill(0);
  // best[mask]: the most zero-sum groups that can be peeled off the members in mask
  const best = new Int8Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = 31 - Math.clz32(mask & -mask);
    sum[mask] = sum[mask & (mask - 1)] + open[low].cents;
    let most = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) most = Math.max(most, best[mask ^ (1 << i)]);
    }
    best[mask] = most + (sum[mask] === 0 ? 1 : 0);
  }

  // Walk back from the full set, removing one member at a time along a best path. Every time the
  // members still left sum to zero, the ones removed since the previous such point form a group.
  const groups: Open[][] = [];
  let group: Open[] = [];
  let mask = size - 1;
  while (mask !== 0) {
    if (sum[mask] === 0 && group.length > 0) {
      groups.push(group);
      group = [];
    }
    const want = best[mask] - (sum[mask] === 0 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i) && best[mask ^ (1 << i)] === want) {
        group.push(open[i]);
        mask ^= 1 << i;
        break;
      }
    }
  }
  groups.push(group);
  return groups;
}

function greedyTransfers(open: Open[]): Transfer[] {
  const debtors = open
    .filter((b) => b.cents < 0)
    .map((b) => ({ userId: b.userId, cents: -b.cents }))
    .sort((a, b) => b.cents - a.cents);
  const creditors = open
    .filter((b) => b.cents > 0)
    .map((b) => ({ userId: b.userId, cents: b.cents }))
    .sort((a, b) => b.cents - a.cents);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amount = Math.min(d.cents, c.cents);
    if (amount > 0) transfers.push({ fromUser: d.userId, toUser: c.userId, amountCents: amount });
    d.cents -= amount;
    c.cents -= amount;
    if (d.cents === 0) i++;
    if (c.cents === 0) j++;
  }
  return transfers;
}
