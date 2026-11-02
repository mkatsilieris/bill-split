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

/**
 * Greedy debt simplification: match the biggest debtor with the biggest creditor
 * until everyone is at zero. Produces at most (n - 1) transfers.
 */
export function simplifyDebts(balances: Balance[]): Transfer[] {
  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ userId: b.userId, cents: -b.netCents }))
    .sort((a, b) => b.cents - a.cents);
  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ userId: b.userId, cents: b.netCents }))
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
