import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { date, money } from '../format';
import type { Expense, Group, Member } from '../types';
import { Avatar, Empty, ErrorBox, Spinner } from './ui';
import { ExpenseForm } from './ExpenseForm';

interface Props {
  group: Group;
  members: Member[];
  currentUserId: number;
  version: number;
  onChanged: () => void;
}

export function ExpensesTab({ group, members, currentUserId, version, onChanged }: Props) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  useEffect(() => {
    api<{ expenses: Expense[] }>(`/groups/${group.id}/expenses`)
      .then((r) => setExpenses(r.expenses))
      .catch((err) => setError(errorMessage(err)));
  }, [group.id, version]);

  const total = expenses?.reduce((s, e) => s + e.amount, 0) ?? 0;

  return (
    <div className="stack">
      <div className="row between">
        <div className="muted">
          Σύνολο: <strong>{money(total, group.currency)}</strong>
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
