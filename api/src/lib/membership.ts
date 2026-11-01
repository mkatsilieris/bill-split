import { pool, type Queryable } from '../db.js';
import { forbidden, notFound } from '../errors.js';

export interface GroupRow {
  id: number;
  name: string;
  description: string | null;
  currency: string;
  split_mode: 'equal' | 'percentage';
  invite_code: string;
  created_by: number;
  created_at: string;
  deleted_at: string | null;
}

export interface MemberRow {
  user_id: number;
  name: string;
  email: string;
  role: 'owner' | 'member';
  share_percent: number | null;
}

export async function loadGroup(groupId: number, db: Queryable = pool): Promise<GroupRow> {
  const { rows } = await db.query<GroupRow>('SELECT * FROM groups WHERE id = $1 AND deleted_at IS NULL', [groupId]);
  if (!rows[0]) throw notFound('Η ομάδα δεν βρέθηκε');
  return rows[0];
}

export async function loadMembers(groupId: number, db: Queryable = pool): Promise<MemberRow[]> {
  const { rows } = await db.query<MemberRow>(
    `SELECT gm.user_id, u.name, u.email, gm.role, gm.share_percent
       FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1 AND gm.deleted_at IS NULL
      ORDER BY gm.joined_at, u.name`,
    [groupId],
  );
  return rows;
}

/** Ensures the user is a member of the group. Returns the group and the user's role. */
export async function requireMember(
  groupId: number,
  userId: number,
  db: Queryable = pool,
): Promise<{ group: GroupRow; role: 'owner' | 'member' }> {
  const group = await loadGroup(groupId, db);
  const { rows } = await db.query<{ role: 'owner' | 'member' }>(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [groupId, userId],
  );
  if (!rows[0]) throw forbidden('Δεν είστε μέλος αυτής της ομάδας');
  return { group, role: rows[0].role };
}

/** Adds the user to the group, or brings back a former member. Returns false if already a member. */
export async function addMember(group: GroupRow, userId: number, db: Queryable = pool): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO group_members (group_id, user_id, role, share_percent)
     VALUES ($1, $2, 'member', CASE WHEN $3 = 'percentage' THEN 0 ELSE NULL END)
     ON CONFLICT (group_id, user_id) DO UPDATE
       SET deleted_at = NULL, deleted_by = NULL, share_percent = EXCLUDED.share_percent, joined_at = now()
       WHERE group_members.deleted_at IS NOT NULL`,
    [group.id, userId, group.split_mode],
  );
  return Boolean(result.rowCount);
}

export async function requireOwner(groupId: number, userId: number, db: Queryable = pool): Promise<GroupRow> {
  const { group, role } = await requireMember(groupId, userId, db);
  if (role !== 'owner') throw forbidden('Μόνο ο διαχειριστής της ομάδας μπορεί να το κάνει αυτό');
  return group;
}

export function parseId(raw: string, label = 'id'): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw notFound(`Μη έγκυρο ${label}`);
  return n;
}
