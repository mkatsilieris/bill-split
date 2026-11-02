import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { date, money } from '../format';
import type { Expense, Group, Member } from '../types';
import { Avatar, DeletedItems, Empty, ErrorBox, Spinner } from './ui';
import { ExpenseForm } from './ExpenseForm';

interface Props {
  group: Group;
  members: Member[];
  currentUserId: number;
  version: number;
  onChanged: () => void;
}

/** The API pages the list; this is how many we ask for at a time (its maximum is 500). */
const PAGE = 100;

interface ExpenseList {
  expenses: Expense[];
  /** count and sum of all expenses of the group, not only the ones returned */
  total: { count: number; amount: number };
}

export function ExpensesTab({ group, members, currentUserId, version, onChanged }: Props) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [total, setTotal] = useState<{ count: number; amount: number }>({ count: 0, amount: 0 });
  const [deleted, setDeleted] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  useEffect(() => {
    // After a change, reload at least as many as were already on screen so the user keeps their place.
    const limit = Math.min(Math.max(expenses?.length ?? 0, PAGE), 500);
    Promise.all([
      api<ExpenseList>(`/groups/${group.id}/expenses?limit=${limit}`),
      api<ExpenseList>(`/groups/${group.id}/expenses/deleted?limit=500`),
    ])
      .then(([active, removed]) => {
        setExpenses(active.expenses);
        setTotal(active.total);
        setDeleted(removed.expenses);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [group.id, version]);

  async function loadMore() {
    if (!expenses || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api<ExpenseList>(`/groups/${group.id}/expenses?limit=${PAGE}&offset=${expenses.length}`);
      const known = new Set(expenses.map((e) => e.id));
      setExpenses([...expenses, ...page.expenses.filter((e) => !known.has(e.id))]);
      setTotal(page.total);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function restore(e: Expense) {
    try {
      await api(`/groups/${group.id}/expenses/${e.id}/restore`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const remaining = expenses ? total.count - expenses.length : 0;

  return (
    <div className="stack">
      <div className="row between">
        <div className="muted">
          Σύνολο: <strong>{money(total.amount, group.currency)}</strong>
          {total.count > 0 && ` · ${total.count} έξοδα`}
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + Έξοδο
        </button>
      </div>
      <ErrorBox error={error} />
      {expenses === null ? (
        <Spinner />
      ) : expenses.length === 0 ? (
        <Empty title="Δεν υπάρχουν έξοδα ακόμη">
          <p className="muted">Πατήστε «+ Έξοδο» για να καταχωρίσετε το πρώτο.</p>
        </Empty>
      ) : (
        <ul className="list">
          {expenses.map((e) => {
            const myShare = e.shares.find((s) => s.user_id === currentUserId)?.amount ?? 0;
            const iPaid = e.paid_by === currentUserId;
            const myNet = (iPaid ? e.amount : 0) - myShare;
            return (
              <li key={e.id}>
                <button className="list-item" onClick={() => setEditing(e)}>
                  <Avatar name={e.paid_by_name} />
                  <div className="list-main">
                    <div className="list-title">{e.description}</div>
                    <div className="muted small">
                      {date(e.spent_at)} · πλήρωσε {iPaid ? 'εσείς' : e.paid_by_name}
                      {e.category ? ` · ${e.category}` : ''}
                    </div>
                  </div>
                  <div className="list-amount">
                    <div className="amount">{money(e.amount, group.currency)}</div>
                    <div className={`small balance ${myNet > 0.004 ? 'pos' : myNet < -0.004 ? 'neg' : 'zero'}`}>
                      {myNet > 0.004
                        ? `+${money(myNet, group.currency)}`
                        : myNet < -0.004
                          ? `-${money(-myNet, group.currency)}`
                          : 'δεν σας αφορά'}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {remaining > 0 && (
        <button className="btn" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Φόρτωση…' : `Περισσότερα (${remaining} ακόμη)`}
        </button>
      )}
      <DeletedItems
        items={deleted}
        label={(e) => (
          <>
            <div className="list-title">{e.description}</div>
            <div className="muted small">
              {date(e.spent_at)} · {money(e.amount, group.currency)}
            </div>
          </>
        )}
        onRestore={restore}
      />
      {editing && (
        <ExpenseForm
          group={group}
          members={members}
          currentUserId={currentUserId}
          existing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
