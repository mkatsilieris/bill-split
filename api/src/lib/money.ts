/** Convert a euro amount (number) to integer cents, rounding half away from zero. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert integer cents to a 2-decimal euro number. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export interface Weighted {
  userId: number;
  /** relative weight, e.g. 1 for equal split, or a percentage like 33.33 */
  weight: number;
}

/**
 * Split `totalCents` among members proportionally to their weights.
 * Uses the largest-remainder method so the shares always sum exactly to the total.
 */
export function splitByWeight(totalCents: number, members: Weighted[]): Map<number, number> {
  const result = new Map<number, number>();
  const active = members.filter((m) => m.weight > 0);
  if (active.length === 0) return result;

  const totalWeight = active.reduce((s, m) => s + m.weight, 0);
  const raw = active.map((m) => ({
    userId: m.userId,
    exact: (totalCents * m.weight) / totalWeight,
  }));
  const floored = raw.map((r) => ({ ...r, cents: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let remaining = totalCents - floored.reduce((s, r) => s + r.cents, 0);

  // hand out the leftover cents to the members with the largest fractional part
  floored
    .map((r, i) => ({ i, rem: r.rem }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i)
    .slice(0, remaining)
    .forEach(({ i }) => {
      floored[i].cents += 1;
      remaining -= 1;
    });

  for (const r of floored) result.set(r.userId, r.cents);
  return result;
}

/** Equal split: every member gets the same weight. */
export function splitEqually(totalCents: number, userIds: number[]): Map<number, number> {
  return splitByWeight(
    totalCents,
    userIds.map((userId) => ({ userId, weight: 1 })),
  );
}
