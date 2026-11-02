export interface User {
  id: number;
  email: string;
  name: string;
  /** May manage the Internet allowlist (Cloudflare Access) from the app. */
  is_admin: boolean;
}

export type SplitMode = 'equal' | 'percentage';
export type Role = 'owner' | 'member';

export interface Group {
  id: number;
  name: string;
  description: string | null;
  currency: string;
  split_mode: SplitMode;
  invite_code: string;
  created_by: number;
  created_at: string;
}

export interface GroupSummary extends Omit<Group, 'invite_code' | 'created_by'> {
  role: Role;
  member_count: number;
  total_spent: number;
  my_balance: number;
}

export interface DeletedGroup {
  id: number;
  name: string;
  deleted_at: string;
}

export interface Member {
  user_id: number;
  name: string;
  email: string;
  role: Role;
  share_percent: number | null;
}

export interface ExpenseShare {
  user_id: number;
  name: string;
  amount: number;
}

export type SplitType = 'group' | 'equal' | 'percentage' | 'exact';

export interface Expense {
  id: number;
  group_id: number;
  paid_by: number;
  paid_by_name: string;
  description: string;
  amount: number;
  category: string | null;
  spent_at: string;
  split_type: SplitType;
  created_by: number;
  created_at: string;
  shares: ExpenseShare[];
}

export interface Balance {
  user_id: number;
  name: string;
  is_member: boolean;
  paid: number;
  owed: number;
  settled_out: number;
  settled_in: number;
  /** net effect of debt changes (corrections, transfers) */
  adjusted: number;
  net: number;
}

export interface Suggestion {
  from_user: number;
  from_name: string;
  to_user: number;
  to_name: string;
  amount: number;
}

export interface Settlement {
  id: number;
  group_id: number;
  from_user: number;
  from_name: string;
  to_user: number;
  to_name: string;
  amount: number;
  note: string | null;
  settled_at: string;
  created_at: string;
}

export type DebtChangeKind = 'adjustment' | 'transfer_out' | 'transfer_in';

/** A change of who owes whom without an expense or a payment (correction or move to another group). */
export interface DebtChange {
  id: number;
  group_id: number;
  debtor: number;
  debtor_name: string;
  creditor: number;
  creditor_name: string;
  amount: number;
  /** increase = the debtor owes the creditor `amount` more */
  direction: 'increase' | 'decrease';
  kind: DebtChangeKind;
  counterpart_id: number | null;
  counterpart_group_id: number | null;
  counterpart_group_name: string | null;
  note: string | null;
  changed_at: string;
  created_at: string;
}

export interface TransferTarget {
  id: number;
  name: string;
  currency: string;
}

/** Totals of one month ('YYYY-MM') of a group, as GET /groups/:id/expenses/months returns them. */
export interface MonthStats {
  month: string;
  count: number;
  total: number;
  by_category: { category: string | null; count: number; total: number }[];
  by_member: { user_id: number; paid: number; share: number }[];
}
