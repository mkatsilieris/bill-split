import { z } from 'zod';
import { config } from '../config.js';

/**
 * The tools Claude sees. Each one is a thin wrapper over a route of this API, called with the
 * person's own token: the checks, the limits and the "only the groups you are a member of" rule
 * are the ones the web app goes through, written once, in the routes. No tool touches the database.
 */

/** Calls a route of this API as the person. Throws ToolError with the route's message on 4xx/5xx. */
export type ApiCall = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

/** A failure the model should read and act on (wrong input, not found, not allowed). */
export class ToolError extends Error {}

export interface Tool {
  name: string;
  title: string;
  description: string;
  /** changes data: hidden from read-only tokens */
  write: boolean;
  /** removes data that cannot be brought back */
  destructive?: boolean;
  input: z.ZodObject<z.ZodRawShape>;
  run: (args: any, api: ApiCall) => Promise<unknown>;
}

/** True for a real calendar day written YYYY-MM-DD. */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The calendar day it is now in a time zone, YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const today = () => todayIn(config.timeZone);

const day = z.string().refine(isDay, 'Expected a calendar day, YYYY-MM-DD');
const optionalDay = day.optional().describe('Calendar day YYYY-MM-DD. Default: today in the app time zone.');
const id = z.number().int().positive();
const groupId = id.describe('Group id from list_groups');
const userId = id.describe('user_id of a member, from get_group');
const amount = z.number().positive().max(100_000_000).describe('Money in the currency of the group, at most two decimals');
const note = z.string().max(200).optional();
const categoryId = id.describe('id of a category, from `categories` of get_group');
const categoryName = z.string().min(1).max(50).describe('Name of the category, without commas');
const none = z.object({});

const q = (params: Record<string, string | number | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const text = s.toString();
  return text ? `?${text}` : '';
};
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const SPLIT_HELP =
  'How the expense is shared. type "group" (default) = the rule of the group, no shares needed. ' +
  '"equal" = equal parts among the members listed in shares (value not needed). ' +
  '"percentage" = shares[].value is a percent, summing to 100. "exact" = shares[].value is an amount, summing to the total.';
const split = z
  .object({
    type: z.enum(['group', 'equal', 'percentage', 'exact']),
    shares: z.array(z.object({ user_id: userId, value: z.number().min(0).optional() })).max(100).optional(),
  })
  .describe(SPLIT_HELP);

interface SavedExpense {
  description: string;
  amount: number;
  paid_by: number;
  category: string | null;
  spent_at: string;
  split_type: 'group' | 'equal' | 'percentage' | 'exact';
  shares: { user_id: number; amount: number }[];
}

/**
 * The split to send back when an expense is edited without a new one, so that it keeps the way it
 * was shared (the PUT route always computes the shares again from the split it is given).
 */
export function keptSplit(old: SavedExpense, newAmount: number): z.infer<typeof split> {
  if (old.split_type === 'group') return { type: 'group' };
  if (old.split_type === 'equal') return { type: 'equal', shares: old.shares.map((s) => ({ user_id: s.user_id })) };
  if (old.split_type === 'exact') {
    if (Math.abs(newAmount - old.amount) >= 0.005) {
      throw new ToolError('This expense is split in exact amounts and the amount changes: send `split` with the new amounts.');
    }
    return { type: 'exact', shares: old.shares.map((s) => ({ user_id: s.user_id, value: s.amount })) };
  }
  // percentage: the shares are kept as amounts; turn them back to percents that sum to exactly 100
  const shares = old.shares.map((s) => ({ user_id: s.user_id, value: Math.round((s.amount / old.amount) * 10000) / 100 }));
  const rest = shares.slice(0, -1).reduce((sum, s) => sum + s.value, 0);
  if (shares.length) shares[shares.length - 1].value = Math.round((100 - rest) * 100) / 100;
  return { type: 'percentage', shares };
}

const DELETED_KINDS = ['group', 'expense', 'settlement', 'debt_change'] as const;
const deletedPath = (kind: (typeof DELETED_KINDS)[number], group: number | undefined): string => {
  if (kind === 'group') return '/groups';
  if (group === undefined) throw new ToolError('group_id is needed for this kind');
  return `/groups/${group}/${{ expense: 'expenses', settlement: 'settlements', debt_change: 'debt-changes' }[kind]}`;
};

export const tools: Tool[] = [
  // ---------------------------------------------------------------- account
  {
    name: 'get_account',
    title: 'Λογαριασμός',
    description: 'Who this token belongs to: user_id, name and e-mail of the person, the app time zone and today\'s date there. The user_id is "me" in every other tool.',
    write: false,
    input: none,
    run: async (_a, api) => ({ ...(await api('GET', '/auth/me')), time_zone: config.timeZone, today: today() }),
  },
  {
    name: 'update_account_name',
    title: 'Αλλαγή ονόματος',
    description: 'Changes the display name of the account (the name the other members see).',
    write: true,
    input: z.object({ name: z.string().min(1).max(100) }),
    run: ({ name }, api) => api('PATCH', '/auth/me', { name }),
  },

  // ---------------------------------------------------------------- groups
  {
    name: 'list_groups',
    title: 'Οι ομάδες μου',
    description:
      'The groups the person is a member of: id, name, currency, split rule, role, number of members, total spent, and my_balance ' +
      '(positive = the person is owed money in that group, negative = they owe). Start here.',
    write: false,
    input: none,
    run: (_a, api) => api('GET', '/groups'),
  },
  {
    name: 'get_group',
    title: 'Ομάδα και μέλη',
    description:
      'One group: its settings (split_mode equal or percentage, invite code), its members with user_id, name, e-mail, role and share_percent, ' +
      'and `categories`, the expense categories of the group (id, name). Use it to turn a name the person says into a user_id.',
    write: false,
    input: z.object({ group_id: groupId }),
    run: (a, api) => api('GET', `/groups/${a.group_id}`),
  },
  {
    name: 'create_group',
    title: 'Νέα ομάδα',
    description: 'Creates a group with the person as its owner. Others join with the invite code (get_group) or are added by e-mail (add_member).',
    write: true,
    input: z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      currency: z.string().min(1).max(8).optional().describe('ISO code, default EUR'),
    }),
    run: (a, api) => api('POST', '/groups', defined(a)),
  },
  {
    name: 'update_group',
    title: 'Ρυθμίσεις ομάδας',
    description:
      'Changes the name, description, currency or default split rule of a group. Send only what changes. ' +
      'With split_mode "percentage", `shares` gives a percent to every member and must sum to 100. Past expenses keep the shares they were saved with.',
    write: true,
    input: z.object({
      group_id: groupId,
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).nullable().optional(),
      currency: z.string().min(1).max(8).optional(),
      split_mode: z.enum(['equal', 'percentage']).optional(),
      shares: z.array(z.object({ user_id: userId, share_percent: z.number().min(0).max(100) })).max(100).optional(),
    }),
    run: ({ group_id, ...rest }, api) => api('PATCH', `/groups/${group_id}`, defined(rest)),
  },
  {
    name: 'delete_group',
    title: 'Διαγραφή ομάδας',
    description: 'Deletes a group for every member (only its owner can). It can be brought back with restore_deleted. Confirm with the person before calling.',
    write: true,
    input: z.object({ group_id: groupId }),
    run: (a, api) => api('DELETE', `/groups/${a.group_id}`),
  },
  {
    name: 'join_group',
    title: 'Συμμετοχή με κωδικό',
    description: 'Joins the person to a group with its invite code.',
    write: true,
    input: z.object({ code: z.string().min(1).max(20) }),
    run: (a, api) => api('POST', '/groups/join', { code: a.code }),
  },
  {
    name: 'add_member',
    title: 'Προσθήκη μέλους',
    description: 'Adds someone who already has an account to a group, by their e-mail.',
    write: true,
    input: z.object({ group_id: groupId, email: z.string().email().max(200) }),
    run: (a, api) => api('POST', `/groups/${a.group_id}/members`, { email: a.email }),
  },
  {
    name: 'remove_member',
    title: 'Αφαίρεση μέλους',
    description:
      'Removes a member from a group (the owner), or leaves the group (user_id = the person). Only when that member\'s balance is zero. Confirm with the person before calling.',
    write: true,
    input: z.object({ group_id: groupId, user_id: userId }),
    run: (a, api) => api('DELETE', `/groups/${a.group_id}/members/${a.user_id}`),
  },
  {
    name: 'new_invite_code',
    title: 'Νέος κωδικός πρόσκλησης',
    description: 'Replaces the invite code of a group (only its owner can). The old code and links stop working.',
    write: true,
    input: z.object({ group_id: groupId }),
    run: (a, api) => api('POST', `/groups/${a.group_id}/invite-code`),
  },

  // ---------------------------------------------------------------- categories
  {
    name: 'add_category',
    title: 'Νέα κατηγορία',
    description: 'Adds an expense category to a group, for every member. The current ones are in `categories` of get_group. Names are unique in the group, ignoring case and accents.',
    write: true,
    input: z.object({ group_id: groupId, name: categoryName }),
    run: (a, api) => api('POST', `/groups/${a.group_id}/categories`, { name: a.name }),
  },
  {
    name: 'rename_category',
    title: 'Μετονομασία κατηγορίας',
    description:
      'Renames an expense category of a group. Every expense of the group that has it gets the new name too (`expenses_updated` says how many), so past months and statistics follow.',
    write: true,
    input: z.object({ group_id: groupId, category_id: categoryId, name: categoryName }),
    run: (a, api) => api('PATCH', `/groups/${a.group_id}/categories/${a.category_id}`, { name: a.name }),
  },
  {
    name: 'remove_category',
    title: 'Αφαίρεση κατηγορίας',
    description:
      'Takes an expense category off the list of a group, so that it is no longer offered for new expenses. Expenses that already have it keep it. Confirm with the person before calling.',
    write: true,
    input: z.object({ group_id: groupId, category_id: categoryId }),
    run: (a, api) => api('DELETE', `/groups/${a.group_id}/categories/${a.category_id}`),
  },

  // ---------------------------------------------------------------- expenses
  {
    name: 'list_expenses',
    title: 'Έξοδα',
    description:
      'Expenses of a group, newest first, each with who paid and the share of every member. `total` has the count and the sum of everything that matches the filter, ' +
      'not only of this page. Filters: month, text in the description (ignores case and accents), categories.',
    write: false,
    input: z.object({
      group_id: groupId,
      month: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM').optional().describe('Only this month, YYYY-MM'),
      query: z.string().max(100).optional().describe('Text to find in the description'),
      categories: z.array(z.string().min(1).max(50)).max(20).optional().describe('Only these categories'),
      without_category: z.boolean().optional().describe('Also (or only) the expenses that have no category'),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    run: (a, api) => {
      const cats = [...(a.categories ?? []), ...(a.without_category ? ['_none'] : [])];
      return api(
        'GET',
        `/groups/${a.group_id}/expenses${q({ month: a.month, q: a.query, categories: cats.length ? cats.join(',') : undefined, limit: a.limit, offset: a.offset })}`,
      );
    },
  },
  {
    name: 'get_expense',
    title: 'Ένα έξοδο',
    description: 'One expense with its shares.',
    write: false,
    input: z.object({ group_id: groupId, expense_id: id.describe('Expense id from list_expenses') }),
    run: (a, api) => api('GET', `/groups/${a.group_id}/expenses/${a.expense_id}`),
  },
  {
    name: 'get_monthly_stats',
    title: 'Στατιστικά ανά μήνα',
    description:
      'Per month, newest first: number and sum of expenses, the sum per category, and per member what they paid and what their share was. ' +
      'Use it for "how much did we spend on ... in ..." questions instead of adding up list_expenses.',
    write: false,
    input: z.object({ group_id: groupId, last_months: z.number().int().min(1).max(240).default(12).describe('How many of the latest months to return') }),
    run: async (a, api) => {
      const r = await api('GET', `/groups/${a.group_id}/expenses/months`);
      return { ...r, months: Array.isArray(r.months) ? r.months.slice(0, a.last_months) : r.months };
    },
  },
  {
    name: 'add_expense',
    title: 'Νέο έξοδο',
    description:
      'Adds an expense to a group. The other members get a notification with their share. Without `split` it follows the rule of the group. ' +
      '`category`: one of the `categories` of the group (get_group), written exactly as there. If none fits, leave it out or offer to add one with add_category.',
    write: true,
    input: z.object({
      group_id: groupId,
      description: z.string().min(1).max(200),
      amount,
      paid_by: userId.optional().describe('user_id of who paid. Default: the person this token belongs to.'),
      spent_at: optionalDay,
      category: z.string().max(50).optional(),
      split: split.optional(),
    }),
    run: async (a, api) => {
      const paidBy = a.paid_by ?? (await api('GET', '/auth/me')).user.id;
      return api('POST', `/groups/${a.group_id}/expenses`, {
        description: a.description,
        amount: a.amount,
        paid_by: paidBy,
        spent_at: a.spent_at ?? today(),
        category: a.category ?? null,
        split: a.split ?? { type: 'group' },
      });
    },
  },
  {
    name: 'update_expense',
    title: 'Διόρθωση εξόδου',
    description:
      'Changes an expense. Send only what changes; the rest stays, including the way it was split. ' +
      'An expense split in exact amounts needs a new `split` when its amount changes. category null removes the category.',
    write: true,
    input: z.object({
      group_id: groupId,
      expense_id: id.describe('Expense id from list_expenses'),
      description: z.string().min(1).max(200).optional(),
      amount: amount.optional(),
      paid_by: userId.optional(),
      spent_at: day.optional(),
      category: z.string().max(50).nullable().optional(),
      split: split.optional(),
    }),
    run: async (a, api) => {
      const path = `/groups/${a.group_id}/expenses/${a.expense_id}`;
      const old = (await api('GET', path)).expense as SavedExpense;
      const newAmount = a.amount ?? old.amount;
      return api('PUT', path, {
        description: a.description ?? old.description,
        amount: newAmount,
        paid_by: a.paid_by ?? old.paid_by,
        spent_at: a.spent_at ?? old.spent_at,
        category: a.category === undefined ? old.category : a.category,
        split: a.split ?? keptSplit(old, newAmount),
      });
    },
  },
  {
    name: 'delete_expense',
    title: 'Διαγραφή εξόδου',
    description: 'Deletes an expense; the balances of the group change. It can be brought back with restore_deleted. Confirm with the person which expense before calling.',
    write: true,
    input: z.object({ group_id: groupId, expense_id: id.describe('Expense id from list_expenses') }),
    run: (a, api) => api('DELETE', `/groups/${a.group_id}/expenses/${a.expense_id}`),
  },

  // ---------------------------------------------------------------- balances & payments
  {
    name: 'get_balances',
    title: 'Υπόλοιπα',
    description:
      'Who owes whom in a group. `balances`: per member what they paid, what their share was, payments made and received, and net (positive = is owed, negative = owes). ' +
      '`suggestions`: payments that settle everything; the fewest possible when up to 10 members have a non-zero balance, close to the fewest above that.',
    write: false,
    input: z.object({ group_id: groupId }),
    run: (a, api) => api('GET', `/groups/${a.group_id}/balances`),
  },
  {
    name: 'list_settlements',
    title: 'Εξοφλήσεις',
    description: 'Payments between members of a group ("settle up"), newest first.',
    write: false,
    input: z.object({ group_id: groupId }),
    run: (a, api) => api('GET', `/groups/${a.group_id}/settlements`),
  },
  {
    name: 'add_settlement',
    title: 'Καταγραφή εξόφλησης',
    description: 'Records that one member paid money to another (it only writes it down; no money is moved). from_user paid, to_user received.',
    write: true,
    input: z.object({ group_id: groupId, from_user: userId, to_user: userId, amount, note, settled_at: optionalDay }),
    run: ({ group_id, ...rest }, api) => api('POST', `/groups/${group_id}/settlements`, { ...defined(rest), settled_at: rest.settled_at ?? today() }),
  },
  {
    name: 'delete_settlement',
    title: 'Διαγραφή εξόφλησης',
    description: 'Deletes a recorded payment; the balances change. It can be brought back with restore_deleted. Confirm with the person before calling.',
    write: true,
    input: z.object({ group_id: groupId, settlement_id: id.describe('Settlement id from list_settlements') }),
    run: (a, api) => api('DELETE', `/groups/${a.group_id}/settlements/${a.settlement_id}`),
  },

  // ---------------------------------------------------------------- debt changes
  {
    name: 'list_debt_changes',
    title: 'Αλλαγές χρεών',
    description:
      'Changes of who owes whom that are neither an expense nor a payment: manual corrections (kind adjustment) and debts moved to or from another group (transfer_out / transfer_in).',
    write: false,
    input: z.object({ group_id: groupId }),
    run: (a, api) => api('GET', `/groups/${a.group_id}/debt-changes`),
  },
  {
    name: 'adjust_debt',
    title: 'Διόρθωση χρέους',
    description: 'A manual correction inside a group: the debtor owes the creditor `amount` more (direction increase) or less (decrease), without an expense or a payment.',
    write: true,
    input: z.object({ group_id: groupId, debtor: userId, creditor: userId, amount, direction: z.enum(['increase', 'decrease']), note, changed_at: optionalDay }),
    run: ({ group_id, ...rest }, api) => api('POST', `/groups/${group_id}/debt-changes`, { ...defined(rest), changed_at: rest.changed_at ?? today() }),
  },
  {
    name: 'list_debt_transfer_targets',
    title: 'Ομάδες για μεταφορά χρέους',
    description: 'The other groups a debt between two members could be moved to: groups where the person, the debtor and the creditor are all members.',
    write: false,
    input: z.object({ group_id: groupId, debtor: userId, creditor: userId }),
    run: (a, api) => api('GET', `/groups/${a.group_id}/debt-changes/targets${q({ debtor: a.debtor, creditor: a.creditor })}`),
  },
  {
    name: 'transfer_debt',
    title: 'Μεταφορά χρέους',
    description:
      'Moves a debt to another group with the same currency: the debtor owes the creditor `amount` less in group_id and `amount` more in target_group_id. ' +
      'The two halves are deleted and restored together.',
    write: true,
    input: z.object({ group_id: groupId, target_group_id: id.describe('Group id from list_debt_transfer_targets'), debtor: userId, creditor: userId, amount, note, changed_at: optionalDay }),
    run: ({ group_id, ...rest }, api) => api('POST', `/groups/${group_id}/debt-changes/transfer`, { ...defined(rest), changed_at: rest.changed_at ?? today() }),
  },
  {
    name: 'delete_debt_change',
    title: 'Διαγραφή αλλαγής χρέους',
    description: 'Deletes a correction or a transfer (both halves of a transfer). It can be brought back with restore_deleted. Confirm with the person before calling.',
    write: true,
    input: z.object({ group_id: groupId, change_id: id.describe('Id from list_debt_changes') }),
    run: (a, api) => api('DELETE', `/groups/${a.group_id}/debt-changes/${a.change_id}`),
  },

  // ---------------------------------------------------------------- deleted items
  {
    name: 'list_deleted',
    title: 'Διαγραμμένα',
    description: 'Deleted items that can be brought back: the groups the person owns (kind group), or the expenses, settlements or debt changes of one group.',
    write: false,
    input: z.object({ kind: z.enum(DELETED_KINDS), group_id: groupId.optional().describe('Needed for every kind except group') }),
    run: (a, api) => api('GET', `${deletedPath(a.kind, a.group_id)}/deleted`),
  },
  {
    name: 'restore_deleted',
    title: 'Επαναφορά',
    description: 'Brings back a deleted group (only its owner can), expense, settlement or debt change. Ids come from list_deleted.',
    write: true,
    input: z.object({ kind: z.enum(DELETED_KINDS), id, group_id: groupId.optional().describe('Needed for every kind except group') }),
    run: (a, api) => api('POST', `${deletedPath(a.kind, a.group_id)}/${a.id}/restore`),
  },

  // ---------------------------------------------------------------- notifications
  {
    name: 'send_test_notification',
    title: 'Δοκιμαστική ειδοποίηση',
    description:
      'Sends a test push notification to every device where the person turned notifications on. ' +
      '(Turning them on for a phone or browser is done in the app on that device; it cannot be done from here.)',
    write: true,
    input: none,
    run: (_a, api) => api('POST', '/push/test'),
  },
];
