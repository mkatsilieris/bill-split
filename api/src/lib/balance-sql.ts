/**
 * SQL expression for the net balance of one user in one group, the same formula as
 * computeBalances() in balances.ts (paid - owed + settlements paid - settlements received + debt changes).
 * `group` and `user` are SQL expressions such as 'g.id' or '$1', never user input.
 */
export function userBalanceSql(group: string, user: string): string {
  return `(
      COALESCE((SELECT SUM(amount) FROM expenses WHERE group_id = ${group} AND paid_by = ${user} AND deleted_at IS NULL), 0)
    - COALESCE((SELECT SUM(es.amount) FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
                 WHERE e.group_id = ${group} AND es.user_id = ${user} AND e.deleted_at IS NULL), 0)
    + COALESCE((SELECT SUM(amount) FROM settlements WHERE group_id = ${group} AND from_user = ${user} AND deleted_at IS NULL), 0)
    - COALESCE((SELECT SUM(amount) FROM settlements WHERE group_id = ${group} AND to_user = ${user} AND deleted_at IS NULL), 0)
    + COALESCE((SELECT SUM(CASE WHEN direction = 'increase' THEN amount ELSE -amount END) FROM debt_changes
                 WHERE group_id = ${group} AND creditor = ${user} AND deleted_at IS NULL), 0)
    - COALESCE((SELECT SUM(CASE WHEN direction = 'increase' THEN amount ELSE -amount END) FROM debt_changes
                 WHERE group_id = ${group} AND debtor = ${user} AND deleted_at IS NULL), 0)
  )`;
}
