import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, badRequest, forbidden, notFound } from '../errors.js';
import { loadMembers, parseId, requireMember, requireOwner } from '../lib/membership.js';
import { expensesRouter } from './expenses.js';
import { settlementsRouter } from './settlements.js';

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

const splitMode = z.enum(['equal', 'percentage']);

function newInviteCode(): string {
  // 8 chars, unambiguous alphabet
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/** All groups of the current user, with their personal balance in each. */
groupsRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.description, g.currency, g.split_mode, g.created_at, gm.role,
            (SELECT COUNT(*) FROM group_members WHERE group_id = g.id)::int AS member_count,
            COALESCE((SELECT SUM(amount) FROM expenses WHERE group_id = g.id), 0) AS total_spent,
              COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.group_id = g.id AND e.paid_by = $1), 0)
            - COALESCE((SELECT SUM(es.amount) FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
                         WHERE e.group_id = g.id AND es.user_id = $1), 0)
            + COALESCE((SELECT SUM(amount) FROM settlements WHERE group_id = g.id AND from_user = $1), 0)
            - COALESCE((SELECT SUM(amount) FROM settlements WHERE group_id = g.id AND to_user = $1), 0)
              AS my_balance
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
      ORDER BY g.created_at DESC`,
    [req.user.id],
  );
  res.json({ groups: rows });
});

groupsRouter.post('/', async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1, 'Το όνομα είναι υποχρεωτικό').max(100),
      description: z.string().trim().max(500).optional(),
      currency: z.string().trim().min(1).max(8).default('EUR'),
    })
    .parse(req.body);

  const group = await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO groups (name, description, currency, invite_code, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.name, body.description ?? null, body.currency.toUpperCase(), newInviteCode(), req.user.id],
    );
    await tx.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      rows[0].id,
      req.user.id,
    ]);
    return rows[0];
  });
  res.status(201).json({ group });
});

/** Join a group with its invite code. */
groupsRouter.post('/join', async (req, res) => {
  const body = z.object({ code: z.string().trim().toUpperCase().min(1) }).parse(req.body);
  const { rows } = await pool.query('SELECT * FROM groups WHERE invite_code = $1', [body.code]);
  const group = rows[0];
  if (!group) throw notFound('Δεν βρέθηκε ομάδα με αυτόν τον κωδικό');
  await pool.query(
    `INSERT INTO group_members (group_id, user_id, role, share_percent)
     VALUES ($1, $2, 'member', CASE WHEN $3 = 'percentage' THEN 0 ELSE NULL END)
     ON CONFLICT DO NOTHING`,
    [group.id, req.user.id, group.split_mode],
  );
  res.json({ group });
});

groupsRouter.get('/:id', async (req, res) => {
  const groupId = parseId(req.params.id);
  const { group, role } = await requireMember(groupId, req.user.id);
  const members = await loadMembers(groupId);
  res.json({ group, members, my_role: role });
});

/** Update name/description/currency and the default split rule of the group. */
groupsRouter.patch('/:id', async (req, res) => {
  const groupId = parseId(req.params.id);
  const body = z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().trim().max(500).nullable().optional(),
      currency: z.string().trim().min(1).max(8).optional(),
      split_mode: splitMode.optional(),
      shares: z
        .array(z.object({ user_id: z.number().int(), share_percent: z.number().min(0).max(100) }))
        .optional(),
    })
    .parse(req.body);

  const { group } = await requireMember(groupId, req.user.id);
  const members = await loadMembers(groupId);
  const finalMode = body.split_mode ?? group.split_mode;

  if (finalMode === 'percentage') {
    const shares = body.shares ?? members.map((m) => ({ user_id: m.user_id, share_percent: m.share_percent ?? 0 }));
    const ids = new Set(shares.map((s) => s.user_id));
    for (const m of members) {
      if (!ids.has(m.user_id)) throw badRequest(`Λείπει το ποσοστό για τον/την ${m.name}`);
    }
    for (const s of shares) {
      if (!members.some((m) => m.user_id === s.user_id)) throw badRequest('Άγνωστο μέλος στα ποσοστά');
    }
    const total = shares.reduce((sum, s) => sum + s.share_percent, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw badRequest(`Τα ποσοστά πρέπει να έχουν σύνολο 100% (τώρα: ${total.toFixed(2)}%)`);
    }
    body.shares = shares;
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE groups SET
         name = COALESCE($2, name),
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         currency = COALESCE($5, currency),
         split_mode = $6
       WHERE id = $1`,
      [
        groupId,
        body.name ?? null,
        body.description !== undefined,
        body.description ?? null,
        body.currency?.toUpperCase() ?? null,
        finalMode,
      ],
    );
    if (body.shares) {
      for (const s of body.shares) {
        await tx.query('UPDATE group_members SET share_percent = $3 WHERE group_id = $1 AND user_id = $2', [
          groupId,
          s.user_id,
          s.share_percent,
        ]);
      }
    }
  });

  const { rows } = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
  res.json({ group: rows[0], members: await loadMembers(groupId) });
});

groupsRouter.delete('/:id', async (req, res) => {
  const groupId = parseId(req.params.id);
  await requireOwner(groupId, req.user.id);
  await pool.query('DELETE FROM groups WHERE id = $1', [groupId]);
  res.status(204).end();
});

groupsRouter.post('/:id/invite-code', async (req, res) => {
  const groupId = parseId(req.params.id);
  await requireOwner(groupId, req.user.id);
  const { rows } = await pool.query('UPDATE groups SET invite_code = $2 WHERE id = $1 RETURNING invite_code', [
    groupId,
    newInviteCode(),
  ]);
  res.json({ invite_code: rows[0].invite_code });
});

/** Add an already registered user to the group by email. */
groupsRouter.post('/:id/members', async (req, res) => {
  const groupId = parseId(req.params.id);
  const body = z.object({ email: z.string().trim().toLowerCase().email('Μη έγκυρο email') }).parse(req.body);
  const { group } = await requireMember(groupId, req.user.id);

  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE email = $1', [body.email]);
  if (!rows[0]) {
    throw notFound('Δεν υπάρχει χρήστης με αυτό το email. Πρέπει πρώτα να κάνει εγγραφή (ή δώστε του τον κωδικό πρόσκλησης).');
  }
  const result = await pool.query(
    `INSERT INTO group_members (group_id, user_id, role, share_percent)
     VALUES ($1, $2, 'member', CASE WHEN $3 = 'percentage' THEN 0 ELSE NULL END)
     ON CONFLICT DO NOTHING`,
    [groupId, rows[0].id, group.split_mode],
  );
  if (!result.rowCount) throw new HttpError(409, 'Είναι ήδη μέλος της ομάδας');
  res.status(201).json({ members: await loadMembers(groupId) });
});

/** Remove a member (owner) or leave the group (self). Only allowed when the member is settled. */
groupsRouter.delete('/:id/members/:userId', async (req, res) => {
  const groupId = parseId(req.params.id);
  const targetId = parseId(req.params.userId, 'user id');
  const { role } = await requireMember(groupId, req.user.id);
  if (targetId !== req.user.id && role !== 'owner') throw forbidden('Μόνο ο διαχειριστής μπορεί να αφαιρέσει μέλη');

  const { rows } = await pool.query<{ balance: number; count: number }>(
    `SELECT
       (  COALESCE((SELECT SUM(amount) FROM expenses WHERE group_id = $1 AND paid_by = $2), 0)
        - COALESCE((SELECT SUM(es.amount) FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
                     WHERE e.group_id = $1 AND es.user_id = $2), 0)
        + COALESCE((SELECT SUM(amount) FROM settlements WHERE group_id = $1 AND from_user = $2), 0)
        - COALESCE((SELECT SUM(amount) FROM settlements WHERE group_id = $1 AND to_user = $2), 0)
       ) AS balance,
       (SELECT COUNT(*) FROM group_members WHERE group_id = $1)::int AS count`,
    [groupId, targetId],
  );
  if (Math.abs(rows[0].balance) >= 0.005) {
    throw badRequest('Το μέλος έχει ανοιχτό υπόλοιπο. Κάντε πρώτα εξόφληση (settle up).');
  }
  if (targetId === req.user.id && role === 'owner' && rows[0].count > 1) {
    throw badRequest('Ο διαχειριστής δεν μπορεί να αποχωρήσει όσο υπάρχουν άλλα μέλη. Διαγράψτε την ομάδα ή αφαιρέστε τα μέλη πρώτα.');
  }
  await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, targetId]);
  if (rows[0].count === 1) {
    // last member left: remove the empty group
    await pool.query('DELETE FROM groups WHERE id = $1', [groupId]);
  }
  res.status(204).end();
});

groupsRouter.use('/:id/expenses', expensesRouter);
groupsRouter.use('/:id', settlementsRouter);
