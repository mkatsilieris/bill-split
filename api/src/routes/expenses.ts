import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { pool, withTransaction } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { fromCents, splitByWeight, splitEqually, toCents } from '../lib/money.js';
import { loadMembers, parseId, requireMember, type GroupRow, type MemberRow } from '../lib/membership.js';
import { notifyUsers } from '../push.js';

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

interface ListFilter {
  /** 'YYYY-MM' or null for every month */
  month: string | null;
  /** text searched in the description (case- and accent-insensitive), null for no search */
  q: string | null;
  /** categories to keep (`none` = expenses without category); null keeps every category */
  categories: { names: string[]; none: boolean } | null;
}

/**
 * One page of expenses plus the count and the sum of everything that matches the same filter,
 * so the UI can page and show real totals.
 */
async function listExpenses(groupId: number, deleted: boolean, limit: number, offset: number, filter: ListFilter) {
  // $1 group, $2 deleted, $3 month, $4 q, $5 category names, $6 include no-category
  // search_norm() (schema.sql) ignores case, accents and the final sigma on both sides
  const where = `e.group_id = $1 AND (e.deleted_at IS NOT NULL) = $2
        AND ($3::text IS NULL OR to_char(e.spent_at, 'YYYY-MM') = $3)
        AND ($4::text IS NULL OR position(search_norm($4) IN search_norm(e.description)) > 0)
        AND ($5::text[] IS NULL OR e.category = ANY($5::text[]) OR ($6::boolean AND e.category IS NULL))`;
  const params = [groupId, deleted, filter.month, filter.q, filter.categories?.names ?? null, filter.categories?.none ?? false];
  const totals = await pool.query<{ count: number; amount: number }>(
    `SELECT count(*)::int AS count, COALESCE(sum(amount), 0)::numeric(12, 2) AS amount FROM expenses e WHERE ${where}`,
    params,
  );
  const { rows } = await pool.query(
    `SELECT e.*, u.name AS paid_by_name,
            COALESCE(json_agg(json_build_object('user_id', es.user_id, 'name', su.name, 'amount', es.amount)
                     ORDER BY su.name) FILTER (WHERE es.user_id IS NOT NULL), '[]') AS shares
       FROM expenses e
       JOIN users u ON u.id = e.paid_by
       LEFT JOIN expense_shares es ON es.expense_id = e.id
       LEFT JOIN users su ON su.id = es.user_id
      WHERE ${where}
      GROUP BY e.id, u.name
      ORDER BY e.spent_at DESC, e.created_at DESC
      LIMIT $7 OFFSET $8`,
    [...params, limit, offset],
  );
  return { expenses: rows, total: totals.rows[0] };
}

/** Token the client sends in ?categories= for "expenses without category". */
const NO_CATEGORY = '_none';

function pageParams(query: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 500);
  const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
  const month = typeof query.month === 'string' && /^\d{4}-\d{2}$/.test(query.month) ? query.month : null;
  const q = typeof query.q === 'string' && query.q.trim() ? query.q.trim().slice(0, 100) : null;
  let categories: ListFilter['categories'] = null;
  if (typeof query.categories === 'string') {
    const list = query.categories.split(',').map((c) => c.trim()).filter(Boolean);
    categories = { names: list.filter((c) => c !== NO_CATEGORY), none: list.includes(NO_CATEGORY) };
  }
  return { limit, offset, filter: { month, q, categories } };
}

/**
 * ?limit (default 100, max 500) and ?offset page through the list. Filters: ?month=YYYY-MM,
 * ?q=<text> (description, ignoring case and accents), ?categories=a,b,_none (comma separated,
 * `_none` = without category; absent = all). `total` matches the filter.
 */
expensesRouter.get('/', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  await requireMember(groupId, req.user.id);
  const { limit, offset, filter } = pageParams(req.query);
  res.json(await listExpenses(groupId, false, limit, offset, filter));
});

expensesRouter.get('/deleted', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  await requireMember(groupId, req.user.id);
  const { limit, offset, filter } = pageParams(req.query);
  res.json(await listExpenses(groupId, true, limit, offset, filter));
});

interface MonthStats {
  month: string;
  count: number;
  total: number;
  by_category: { category: string | null; count: number; total: number }[];
  by_member: { user_id: number; paid: number; share: number }[];
}

/** Every month that has expenses, newest first, with totals per category and per member (for the list and the stats). */
expensesRouter.get('/months', async (req, res) => {
  const groupId = parseId((req.params as Record<string, string>).id);
  await requireMember(groupId, req.user.id);
  const [months, categories, paid, shares] = await Promise.all([
    pool.query<{ month: string; count: number; total: number }>(
      `SELECT to_char(spent_at, 'YYYY-MM') AS month, count(*)::int AS count, sum(amount)::numeric(12, 2) AS total
         FROM expenses WHERE group_id = $1 AND deleted_at IS NULL GROUP BY 1 ORDER BY 1 DESC`,
      [groupId],
    ),
    pool.query<{ month: string; category: string | null; count: number; total: number }>(
      `SELECT to_char(spent_at, 'YYYY-MM') AS month, category, count(*)::int AS count, sum(amount)::numeric(12, 2) AS total
         FROM expenses WHERE group_id = $1 AND deleted_at IS NULL GROUP BY 1, 2 ORDER BY 1 DESC, 4 DESC`,
      [groupId],
    ),
    pool.query<{ month: string; user_id: number; paid: number }>(
      `SELECT to_char(spent_at, 'YYYY-MM') AS month, paid_by AS user_id, sum(amount)::numeric(12, 2) AS paid
         FROM expenses WHERE group_id = $1 AND deleted_at IS NULL GROUP BY 1, 2`,
      [groupId],
    ),
    pool.query<{ month: string; user_id: number; share: number }>(
      `SELECT to_char(e.spent_at, 'YYYY-MM') AS month, es.user_id, sum(es.amount)::numeric(12, 2) AS share
         FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
        WHERE e.group_id = $1 AND e.deleted_at IS NULL GROUP BY 1, 2`,
      [groupId],
    ),
  ]);

  const byMonth = new Map<string, MonthStats>();
  for (const m of months.rows) byMonth.set(m.month, { ...m, by_category: [], by_member: [] });
  for (const c of categories.rows) byMonth.get(c.month)?.by_category.push({ category: c.category, count: c.count, total: c.total });
  const member = (month: string, userId: number) => {
    const m = byMonth.get(month)!;
    let entry = m.by_member.find((x) => x.user_id === userId);
    if (!entry) {
      entry = { user_id: userId, paid: 0, share: 0 };
      m.by_member.push(entry);
    }
    return entry;
  };
  for (const p of paid.rows) member(p.month, p.user_id).paid = p.paid;
  for (const s of shares.rows) member(s.month, s.user_id).share = s.share;
  res.json({ months: [...byMonth.values()] });
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
  const expense = await loadExpense(groupId, expenseId);
  res.status(201).json({ expense });
  void notifyNewExpense(group, members, req.user.id, expense);
});

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('el-GR', { style: 'currency', currency }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

/** Tells every other member of the group about the new expense, with their own share in it. */
async function notifyNewExpense(
  group: GroupRow,
  members: MemberRow[],
  creatorId: number,
  expense: { id: number; description: string; amount: number; paid_by: number; shares: { user_id: number; amount: number }[] },
) {
  const name = (id: number) => members.find((m) => m.user_id === id)?.name ?? '';
  const amount = formatMoney(expense.amount, group.currency);
  let body = `${name(creatorId)} πρόσθεσε «${expense.description}» ${amount}`;
  if (expense.paid_by !== creatorId) body += ` (πλήρωσε: ${name(expense.paid_by)})`;
  await Promise.all(
    members
      .filter((m) => m.user_id !== creatorId)
      .map((m) => {
        const share = expense.shares.find((s) => s.user_id === m.user_id)?.amount;
        return notifyUsers([m.user_id], {
          title: group.name,
          body: share ? `${body}
Το μερίδιό σου: ${formatMoney(share, group.currency)}` : body,
          url: `/groups/${group.id}`,
          tag: `expense-${expense.id}`,
        });
      }),
  );
}

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
