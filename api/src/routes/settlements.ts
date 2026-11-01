import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { computeBalances, simplifyDebts, type SettlementRow, type ShareRow } from '../lib/balances.js';
import { fromCents, toCents } from '../lib/money.js';
import { loadMembers, parseId, requireMember } from '../lib/membership.js';

export const settlementsRouter = Router({ mergeParams: true });

/** Per-member balances of the group + suggested transfers to settle everything. */
settlementsRouter.get('/balances', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  await requireMember(groupId, req.user.id);
  const members = await loadMembers(groupId);

  const shareRows = await pool.query<{ expense_id: number; paid_by: number; user_id: number; amount: number }>(
    `SELECT es.expense_id, e.paid_by, es.user_id, es.amount
       FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
      WHERE e.group_id = $1`,
    [groupId],
  );
  const settlementRows = await pool.query<{ from_user: number; to_user: number; amount: number }>(
    'SELECT from_user, to_user, amount FROM settlements WHERE group_id = $1',
    [groupId],
  );

  const shares: ShareRow[] = shareRows.rows.map((r) => ({
    expenseId: r.expense_id,
    paidBy: r.paid_by,
    userId: r.user_id,
    amountCents: toCents(r.amount),
  }));
  const settlements: SettlementRow[] = settlementRows.rows.map((r) => ({
    fromUser: r.from_user,
    toUser: r.to_user,
    amountCents: toCents(r.amount),
  }));

  const balances = computeBalances(
    members.map((m) => m.user_id),
    shares,
    settlements,
  );
  const transfers = simplifyDebts(balances);

  // Names for users that may have left the group but still appear in history
  const knownIds = new Set(members.map((m) => m.user_id));
  const missing = balances.map((b) => b.userId).filter((id) => !knownIds.has(id));
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  if (missing.length) {
    const { rows } = await pool.query<{ id: number; name: string }>('SELECT id, name FROM users WHERE id = ANY($1)', [missing]);
    rows.forEach((r) => names.set(r.id, r.name));
  }
  const nameOf = (id: number) => names.get(id) ?? `Χρήστης #${id}`;

  res.json({
    balances: balances.map((b) => ({
      user_id: b.userId,
      name: nameOf(b.userId),
      is_member: knownIds.has(b.userId),
      paid: fromCents(b.paidCents),
      owed: fromCents(b.owedCents),
      settled_out: fromCents(b.settledOutCents),
      settled_in: fromCents(b.settledInCents),
      net: fromCents(b.netCents),
    })),
    suggestions: transfers.map((t) => ({
      from_user: t.fromUser,
      from_name: nameOf(t.fromUser),
      to_user: t.toUser,
      to_name: nameOf(t.toUser),
      amount: fromCents(t.amountCents),
    })),
    total_spent: fromCents(shares.reduce((s, r) => s + r.amountCents, 0)),
  });
});

settlementsRouter.get('/settlements', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  await requireMember(groupId, req.user.id);
  const { rows } = await pool.query(
    `SELECT s.*, fu.name AS from_name, tu.name AS to_name
       FROM settlements s
       JOIN users fu ON fu.id = s.from_user
       JOIN users tu ON tu.id = s.to_user
      WHERE s.group_id = $1
      ORDER BY s.settled_at DESC, s.created_at DESC`,
    [groupId],
  );
  res.json({ settlements: rows });
});

/** Record a payment between two members ("settle up"). */
settlementsRouter.post('/settlements', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  const body = z
    .object({
      from_user: z.number().int(),
      to_user: z.number().int(),
      amount: z.number().positive('Το ποσό πρέπει να είναι μεγαλύτερο από 0'),
      note: z.string().trim().max(200).nullable().optional(),
      settled_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Μη έγκυρη ημερομηνία').optional(),
    })
    .parse(req.body);
  await requireMember(groupId, req.user.id);
  if (body.from_user === body.to_user) throw badRequest('Ο πληρωτής και ο αποδέκτης πρέπει να διαφέρουν');
  const members = await loadMembers(groupId);
  const ids = new Set(members.map((m) => m.user_id));
  if (!ids.has(body.from_user) || !ids.has(body.to_user)) throw badRequest('Και οι δύο πρέπει να είναι μέλη της ομάδας');

  const { rows } = await pool.query(
    `INSERT INTO settlements (group_id, from_user, to_user, amount, note, settled_at, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7) RETURNING *`,
    [groupId, body.from_user, body.to_user, body.amount, body.note ?? null, body.settled_at ?? null, req.user.id],
  );
  res.status(201).json({ settlement: rows[0] });
});

settlementsRouter.delete('/settlements/:settlementId', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  const settlementId = parseId(req.params.settlementId);
  await requireMember(groupId, req.user.id);
  const result = await pool.query('DELETE FROM settlements WHERE group_id = $1 AND id = $2', [groupId, settlementId]);
  if (!result.rowCount) throw notFound('Η εξόφληση δεν βρέθηκε');
  res.status(204).end();
});
