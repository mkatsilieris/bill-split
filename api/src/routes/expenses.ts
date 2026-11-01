import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { pool, withTransaction } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { fromCents, splitByWeight, splitEqually, toCents } from '../lib/money.js';
import { loadMembers, parseId, requireMember, type GroupRow, type MemberRow } from '../lib/membership.js';

export const expensesRouter = Router({ mergeParams: true });

const splitSchema = z
  .object({
    type: z.enum(['group', 'equal', 'percentage', 'exact']).default('group'),
    // equal: value ignored (presence = participates); percentage: percent; exact: amount
    shares: z.array(z.object({ user_id: z.number().int(), value: z.number().min(0).optional() })).optional(),
  })
  .default({ type: 'group' });

const expenseBody = z.object({
  description: z.string().trim().min(1, 'Η περιγραφή είναι υποχρεωτική').max(200),
  amount: z.number().positive('Το ποσό πρέπει να είναι μεγαλύτερο από 0'),
  paid_by: z.number().int(),
  category: z.string().trim().max(50).nullable().optional(),
  spent_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Μη έγκυρη ημερομηνία').optional(),
  split: splitSchema,
});
type ExpenseBody = z.infer<typeof expenseBody>;

/** Turns the requested split into exact per-user cents that sum to the total. */
function computeShares(body: ExpenseBody, group: GroupRow, members: MemberRow[]): Map<number, number> {
  const totalCents = toCents(body.amount);
  const memberIds = new Set(members.map((m) => m.user_id));
  const split = body.split;

  const assertMembers = (ids: number[]) => {
    for (const id of ids) if (!memberIds.has(id)) throw badRequest('Κάποιο μέλος του διαμοιρασμού δεν ανήκει στην ομάδα');
  };

  let type = split.type;
  if (type === 'group') type = group.split_mode; // resolve the group default

  if (type === 'equal') {
    const ids = split.shares?.length && split.type !== 'group' ? split.shares.map((s) => s.user_id) : [...memberIds];
    assertMembers(ids);
    if (ids.length === 0) throw badRequest('Επιλέξτε τουλάχιστον ένα μέλος');
    return splitEqually(totalCents, ids);
  }

  if (type === 'percentage') {
    const weights =
      split.type === 'group'
        ? members.map((m) => ({ userId: m.user_id, weight: m.share_percent ?? 0 }))
        : (split.shares ?? []).map((s) => ({ userId: s.user_id, weight: s.value ?? 0 }));
    assertMembers(weights.map((w) => w.userId));
    const total = weights.reduce((s, w) => s + w.weight, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw badRequest(`Τα ποσοστά πρέπει να έχουν σύνολο 100% (τώρα ${total.toFixed(2)}%)`);
    }
    return splitByWeight(totalCents, weights);
  }

  // exact amounts
  const shares = (split.shares ?? []).map((s) => ({ userId: s.user_id, cents: toCents(s.value ?? 0) }));
  assertMembers(shares.map((s) => s.userId));
  const sum = shares.reduce((s, x) => s + x.cents, 0);
  if (sum !== totalCents) {
    throw badRequest(`Τα ποσά πρέπει να έχουν σύνολο ${fromCents(totalCents).toFixed(2)} (τώρα ${fromCents(sum).toFixed(2)})`);
  }
  return new Map(shares.filter((s) => s.cents > 0).map((s) => [s.userId, s.cents]));
}

async function insertShares(tx: pg.PoolClient, expenseId: number, shares: Map<number, number>) {
  for (const [userId, cents] of shares) {
    await tx.query('INSERT INTO expense_shares (expense_id, user_id, amount) VALUES ($1, $2, $3)', [
      expenseId,
      userId,
      fromCents(cents),
    ]);
  }
}

async function loadExpense(groupId: number, expenseId: number) {
  const { rows } = await pool.query(
    `SELECT e.*, u.name AS paid_by_name,
            COALESCE(json_agg(json_build_object('user_id', es.user_id, 'name', su.name, 'amount', es.amount)
                     ORDER BY su.name) FILTER (WHERE es.user_id IS NOT NULL), '[]') AS shares
       FROM expenses e
       JOIN users u ON u.id = e.paid_by
       LEFT JOIN expense_shares es ON es.expense_id = e.id
       LEFT JOIN users su ON su.id = es.user_id
      WHERE e.group_id = $1 AND e.id = $2 AND e.deleted_at IS NULL
      GROUP BY e.id, u.name`,
    [groupId, expenseId],
  );
  if (!rows[0]) throw notFound('Το έξοδο δεν βρέθηκε');
  return rows[0];
}

async function listExpenses(groupId: number, deleted: boolean, limit: number, offset: number) {
  const { rows } = await pool.query(
    `SELECT e.*, u.name AS paid_by_name,
            COALESCE(json_agg(json_build_object('user_id', es.user_id, 'name', su.name, 'amount', es.amount)
                     ORDER BY su.name) FILTER (WHERE es.user_id IS NOT NULL), '[]') AS shares
       FROM expenses e
       JOIN users u ON u.id = e.paid_by
       LEFT JOIN expense_shares es ON es.expense_id = e.id
       LEFT JOIN users su ON su.id = es.user_id
      WHERE e.group_id = $1 AND (e.deleted_at IS NOT NULL) = $2
      GROUP BY e.id, u.name
      ORDER BY e.spent_at DESC, e.created_at DESC
      LIMIT $3 OFFSET $4`,
    [groupId, deleted, limit, offset],
  );
  return rows;
}

expensesRouter.get('/', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  await requireMember(groupId, req.user.id);
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  res.json({ expenses: await listExpenses(groupId, false, limit, offset) });
});

expensesRouter.get('/deleted', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  await requireMember(groupId, req.user.id);
  res.json({ expenses: await listExpenses(groupId, true, 500, 0) });
});

expensesRouter.post('/', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  const body = expenseBody.parse(req.body);
  const { group } = await requireMember(groupId, req.user.id);
  const members = await loadMembers(groupId);
  if (!members.some((m) => m.user_id === body.paid_by)) throw badRequest('Ο πληρωτής δεν είναι μέλος της ομάδας');

  const shares = computeShares(body, group, members);
  const expenseId = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO expenses (group_id, paid_by, description, amount, category, spent_at, split_type, created_by)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8) RETURNING id`,
      [
        groupId,
        body.paid_by,
        body.description,
        body.amount,
        body.category ?? null,
        body.spent_at ?? null,
        body.split.type,
        req.user.id,
      ],
    );
    await insertShares(tx, rows[0].id, shares);
    return rows[0].id;
  });
  res.status(201).json({ expense: await loadExpense(groupId, expenseId) });
});

expensesRouter.put('/:expenseId', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  const expenseId = parseId(req.params.expenseId);
  const body = expenseBody.parse(req.body);
  const { group } = await requireMember(groupId, req.user.id);
  const members = await loadMembers(groupId);
  if (!members.some((m) => m.user_id === body.paid_by)) throw badRequest('Ο πληρωτής δεν είναι μέλος της ομάδας');
  await loadExpense(groupId, expenseId); // 404 if missing

  const shares = computeShares(body, group, members);
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE expenses SET paid_by = $3, description = $4, amount = $5, category = $6,
              spent_at = COALESCE($7::date, spent_at), split_type = $8
        WHERE group_id = $1 AND id = $2`,
      [groupId, expenseId, body.paid_by, body.description, body.amount, body.category ?? null, body.spent_at ?? null, body.split.type],
    );
    await tx.query('DELETE FROM expense_shares WHERE expense_id = $1', [expenseId]);
    await insertShares(tx, expenseId, shares);
  });
  res.json({ expense: await loadExpense(groupId, expenseId) });
});

expensesRouter.delete('/:expenseId', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  const expenseId = parseId(req.params.expenseId);
  await requireMember(groupId, req.user.id);
  const result = await pool.query(
    'UPDATE expenses SET deleted_at = now(), deleted_by = $3 WHERE group_id = $1 AND id = $2 AND deleted_at IS NULL',
    [groupId, expenseId, req.user.id],
  );
  if (!result.rowCount) throw notFound('Το έξοδο δεν βρέθηκε');
  res.status(204).end();
});

expensesRouter.post('/:expenseId/restore', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  const expenseId = parseId(req.params.expenseId);
  await requireMember(groupId, req.user.id);
  const result = await pool.query(
    'UPDATE expenses SET deleted_at = NULL, deleted_by = NULL WHERE group_id = $1 AND id = $2 AND deleted_at IS NOT NULL',
    [groupId, expenseId],
  );
  if (!result.rowCount) throw notFound('Το έξοδο δεν βρέθηκε');
  res.json({ expense: await loadExpense(groupId, expenseId) });
});
