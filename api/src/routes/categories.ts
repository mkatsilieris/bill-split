import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction, type Queryable } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { categoryName } from '../lib/categories.js';
import { parseId, requireMember } from '../lib/membership.js';

/** The categories a group offers in its expense form. Any member may add, rename or remove them. */
export const categoriesRouter = Router({ mergeParams: true });

export interface CategoryRow {
  id: number;
  name: string;
}

/** Categories of the group in the order they were added (the defaults first). */
export async function loadCategories(groupId: number, db: Queryable = pool): Promise<CategoryRow[]> {
  const { rows } = await db.query<CategoryRow>(
    'SELECT id, name FROM group_categories WHERE group_id = $1 AND deleted_at IS NULL ORDER BY id',
    [groupId],
  );
  return rows;
}

/** Gives a new group the default categories (schema.sql, default_categories()). */
export async function seedCategories(groupId: number, userId: number, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO group_categories (group_id, name, created_by)
     SELECT $1, d.name, $2 FROM unnest(default_categories()) WITH ORDINALITY AS d(name, pos) ORDER BY d.pos`,
    [groupId, userId],
  );
}

const body = z.object({ name: categoryName });
const groupIdOf = (params: unknown) => parseId((params as Record<string, string>).id);

/** Runs a write and turns the unique index on (group, name ignoring case and accents) into a 409. */
async function uniqueName<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'Υπάρχει ήδη κατηγορία με αυτό το όνομα');
    throw err;
  }
}

categoriesRouter.get('/', async (req, res) => {
  const groupId = groupIdOf(req.params);
  await requireMember(groupId, req.user.id);
  res.json({ categories: await loadCategories(groupId) });
});

categoriesRouter.post('/', async (req, res) => {
  const groupId = groupIdOf(req.params);
  const { name } = body.parse(req.body);
  await requireMember(groupId, req.user.id);
  const { rows } = await uniqueName(() =>
    pool.query<CategoryRow>('INSERT INTO group_categories (group_id, name, created_by) VALUES ($1, $2, $3) RETURNING id, name', [
      groupId,
      name,
      req.user.id,
    ]),
  );
  res.status(201).json({ category: rows[0], categories: await loadCategories(groupId) });
});

/** Renames a category, and with it every expense of the group that has it (deleted ones too, so a restore matches). */
categoriesRouter.patch('/:categoryId', async (req, res) => {
  const groupId = groupIdOf(req.params);
  const categoryId = parseId(req.params.categoryId);
  const { name } = body.parse(req.body);
  await requireMember(groupId, req.user.id);

  const expensesUpdated = await uniqueName(() =>
    withTransaction(async (tx) => {
      const { rows } = await tx.query<CategoryRow>(
        'SELECT id, name FROM group_categories WHERE group_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE',
        [groupId, categoryId],
      );
      if (!rows[0]) throw notFound('Η κατηγορία δεν βρέθηκε');
      const old = rows[0].name;
      if (old === name) return 0;
      await tx.query('UPDATE group_categories SET name = $2 WHERE id = $1', [categoryId, name]);
      const updated = await tx.query('UPDATE expenses SET category = $3 WHERE group_id = $1 AND category = $2', [groupId, old, name]);
      return updated.rowCount ?? 0;
    }),
  );
  res.json({ category: { id: categoryId, name }, expenses_updated: expensesUpdated, categories: await loadCategories(groupId) });
});

/** Takes a category off the list. Expenses that have it keep it. */
categoriesRouter.delete('/:categoryId', async (req, res) => {
  const groupId = groupIdOf(req.params);
  const categoryId = parseId(req.params.categoryId);
  await requireMember(groupId, req.user.id);
  const result = await pool.query(
    'UPDATE group_categories SET deleted_at = now(), deleted_by = $3 WHERE group_id = $1 AND id = $2 AND deleted_at IS NULL',
    [groupId, categoryId, req.user.id],
  );
  if (!result.rowCount) throw notFound('Η κατηγορία δεν βρέθηκε');
  res.status(204).end();
});
