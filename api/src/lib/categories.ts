import { z } from 'zod';

/** Token the client sends in ?categories= for "expenses without category". */
export const NO_CATEGORY = '_none';

export const CATEGORY_MAX_LENGTH = 50;

/**
 * Name of a category of a group: trimmed, inner whitespace collapsed, 1-50 characters.
 * No comma (the expense filter ?categories=a,b is comma separated) and not the reserved `_none`.
 */
export const categoryName = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Το όνομα της κατηγορίας είναι υποχρεωτικό')
      .max(CATEGORY_MAX_LENGTH, `Το όνομα της κατηγορίας έχει έως ${CATEGORY_MAX_LENGTH} χαρακτήρες`)
      .refine((s) => !s.includes(','), 'Το όνομα της κατηγορίας δεν μπορεί να έχει κόμμα')
      .refine((s) => s !== NO_CATEGORY, 'Αυτό το όνομα δεν επιτρέπεται'),
  );
