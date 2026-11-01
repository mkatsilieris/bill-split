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
}

export interface MemberRow {
  user_id: number;
  name: string;
  email: string;
  role: 'owner' | 'member';
  share_percent: number | null;
}

export async function loadGroup(groupId: number, db: Queryable = pool): Promise<GroupRow> {
  const { rows } = await db.query<GroupRow>('SELECT * FROM groups WHERE id = $1', [groupId]);
  if (!rows[0]) throw notFound('Η ομάδα δεν βρέθηκε');
  return rows[0];
}

export async function loadMembers(groupId: number, db: Queryable = pool): Promise<MemberRow[]> {
  const { rows } = await db.query<MemberRow>(
    `SELECT gm.user_id, u.name, u.email, gm.role, gm.share_percent
       FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
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
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!rows[0]) throw forbidden('Δεν είστε μέλος αυτής της ομάδας');
  return { group, role: rows[0].role };
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
