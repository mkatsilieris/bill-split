import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { pool, withTransaction } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { loadMembers, parseId, requireMember } from '../lib/membership.js';

/**
 * Debt changes: who owes whom changes without an expense or money changing hands.
 *   - adjustment: a manual correction inside the group ("Α owes Β 20 less")
 *   - transfer: a debt moved to another group; two linked rows, 'transfer_out' in the source group
 *     (the debt disappears there) and 'transfer_in' in the target group (it appears there).
 * Mounted under /api/groups/:id.
 */
export const debtChangesRouter = Router({ mergeParams: true });

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Μη έγκυρη ημερομηνία');
const debtFields = {
  debtor: z.number().int(),
  creditor: z.number().int(),
  amount: z.number().positive('Το ποσό πρέπει να είναι μεγαλύτερο από 0'),
  note: z.string().trim().max(200).nullable().optional(),
  changed_at: dateStr.optional(),
};

const SELECT = `
  SELECT c.*, d.name AS debtor_name, k.name AS creditor_name,
         cg.id AS counterpart_group_id, cg.name AS counterpart_group_name
    FROM debt_changes c
    JOIN users d ON d.id = c.debtor
    JOIN users k ON k.id = c.creditor
    LEFT JOIN debt_changes cp ON cp.id = c.counterpart_id
    LEFT JOIN groups cg ON cg.id = cp.group_id`;

async function listChanges(groupId: number, deleted: boolean) {
  const { rows } = await pool.query(
    `${SELECT} WHERE c.group_id = $1 AND (c.deleted_at IS NOT NULL) = $2 ORDER BY c.changed_at DESC, c.created_at DESC`,
    [groupId, deleted],
  );
  return rows;
}

async function loadChange(groupId: number, changeId: number, db: pg.Pool | pg.PoolClient = pool) {
  const { rows } = await db.query(`${SELECT} WHERE c.group_id = $1 AND c.id = $2`, [groupId, changeId]);
  if (!rows[0]) throw notFound('Η αλλαγή χρέους δεν βρέθηκε');
  return rows[0];
}

function groupIdOf(req: { params: unknown }): number {
  return parseId((req.params as Record<string, string>).id);
}

async function requireBothMembers(groupId: number, debtor: number, creditor: number, what: string) {
  if (debtor === creditor) throw badRequest('Ο οφειλέτης και ο δικαιούχος πρέπει να διαφέρουν');
  const members = await loadMembers(groupId);
  const ids = new Set(members.map((m) => m.user_id));
  if (!ids.has(debtor) || !ids.has(creditor)) throw badRequest(`Και οι δύο πρέπει να είναι μέλη ${what}`);
}

debtChangesRouter.get('/debt-changes', async (req, res) => {
  const groupId = groupIdOf(req);
  await requireMember(groupId, req.user.id);
  res.json({ changes: await listChanges(groupId, false) });
});

debtChangesRouter.get('/debt-changes/deleted', async (req, res) => {
  const groupId = groupIdOf(req);
  await requireMember(groupId, req.user.id);
  res.json({ changes: await listChanges(groupId, true) });
});

/** Groups a debt between ?debtor and ?creditor could be moved to: both of them and I are members. */
debtChangesRouter.get('/debt-changes/targets', async (req, res) => {
  const groupId = groupIdOf(req);
  await requireMember(groupId, req.user.id);
  const debtor = parseId(String(req.query.debtor ?? ''), 'debtor');
  const creditor = parseId(String(req.query.creditor ?? ''), 'creditor');
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.currency
       FROM groups g
      WHERE g.deleted_at IS NULL AND g.id <> $1
        AND (SELECT count(*) FROM group_members gm
              WHERE gm.group_id = g.id AND gm.deleted_at IS NULL AND gm.user_id = ANY($2::int[])) = cardinality($2::int[])
      ORDER BY g.name`,
    [groupId, [...new Set([req.user.id, debtor, creditor])]],
  );
  res.json({ groups: rows });
});

/** Manual correction: the debtor owes the creditor `amount` more ('increase') or less ('decrease'). */
debtChangesRouter.post('/debt-changes', async (req, res) => {
  const groupId = groupIdOf(req);
  const body = z.object({ ...debtFields, direction: z.enum(['increase', 'decrease']) }).parse(req.body);
  await requireMember(groupId, req.user.id);
  await requireBothMembers(groupId, body.debtor, body.creditor, 'της ομάδας');

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO debt_changes (group_id, debtor, creditor, amount, direction, kind, note, changed_at, created_by)
     VALUES ($1, $2, $3, $4, $5, 'adjustment', $6, COALESCE($7::date, CURRENT_DATE), $8) RETURNING id`,
    [groupId, body.debtor, body.creditor, body.amount, body.direction, body.note ?? null, body.changed_at ?? null, req.user.id],
  );
  res.status(201).json({ change: await loadChange(groupId, rows[0].id) });
});

/** Move a debt to another group: it disappears here and appears there. */
debtChangesRouter.post('/debt-changes/transfer', async (req, res) => {
  const groupId = groupIdOf(req);
  const body = z.object({ ...debtFields, target_group_id: z.number().int() }).parse(req.body);
  if (body.target_group_id === groupId) throw badRequest('Επιλέξτε διαφορετική ομάδα προορισμού');
  const { group } = await requireMember(groupId, req.user.id);
  const { group: target } = await requireMember(body.target_group_id, req.user.id);
  if (group.currency !== target.currency) throw badRequest('Οι δύο ομάδες έχουν διαφορετικό νόμισμα');
  await requireBothMembers(groupId, body.debtor, body.creditor, 'της ομάδας');
  await requireBothMembers(target.id, body.debtor, body.creditor, `της ομάδας «${target.name}»`);

  const ids = await withTransaction(async (tx) => {
    const insert = async (gid: number, direction: string, kind: string, counterpart: number | null) => {
      const { rows } = await tx.query<{ id: number }>(
        `INSERT INTO debt_changes (group_id, debtor, creditor, amount, direction, kind, counterpart_id, note, changed_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, CURRENT_DATE), $10) RETURNING id`,
        [gid, body.debtor, body.creditor, body.amount, direction, kind, counterpart, body.note ?? null, body.changed_at ?? null, req.user.id],
      );
      return rows[0].id;
    };
    const out = await insert(groupId, 'decrease', 'transfer_out', null);
    const into = await insert(target.id, 'increase', 'transfer_in', out);
    await tx.query('UPDATE debt_changes SET counterpart_id = $2 WHERE id = $1', [out, into]);
    return { out, into };
  });
  res.status(201).json({ change: await loadChange(groupId, ids.out), counterpart: await loadChange(target.id, ids.into) });
});

/** Soft-deletes the change and, for a transfer, its other half, so both groups stay consistent. */
async function setDeleted(groupId: number, changeId: number, userId: number, deleted: boolean) {
  await withTransaction(async (tx) => {
    const change = await loadChange(groupId, changeId, tx);
    if ((change.deleted_at !== null) === deleted) throw notFound('Η αλλαγή χρέους δεν βρέθηκε');
    const ids = [change.id, change.counterpart_id].filter((id): id is number => id !== null);
    await tx.query(
      deleted
        ? 'UPDATE debt_changes SET deleted_at = now(), deleted_by = $2 WHERE id = ANY($1::int[]) AND deleted_at IS NULL'
        : 'UPDATE debt_changes SET deleted_at = NULL, deleted_by = NULL WHERE id = ANY($1::int[]) AND deleted_at IS NOT NULL',
      deleted ? [ids, userId] : [ids],
    );
  });
}

debtChangesRouter.delete('/debt-changes/:changeId', async (req, res) => {
  const groupId = groupIdOf(req);
  await requireMember(groupId, req.user.id);
  await setDeleted(groupId, parseId(req.params.changeId), req.user.id, true);
  res.status(204).end();
});

debtChangesRouter.post('/debt-changes/:changeId/restore', async (req, res) => {
  const groupId = groupIdOf(req);
  await requireMember(groupId, req.user.id);
  await setDeleted(groupId, parseId(req.params.changeId), req.user.id, false);
  res.status(204).end();
});
