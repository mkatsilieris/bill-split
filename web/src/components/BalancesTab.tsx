import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { date, money, today } from '../format';
import type { Balance, Group, Member, Settlement, Suggestion } from '../types';
import { Avatar, DeletedItems, Empty, ErrorBox, Field, Modal, Spinner } from './ui';

interface Props {
  group: Group;
  members: Member[];
  currentUserId: number;
  version: number;
  onChanged: () => void;
}

interface BalancesResponse {
  balances: Balance[];
  suggestions: Suggestion[];
  total_spent: number;
}

type SettleDraft = { from_user: number; to_user: number; amount: number } | null;

export function BalancesTab({ group, members, currentUserId, version, onChanged }: Props) {
  const [data, setData] = useState<BalancesResponse | null>(null);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [deleted, setDeleted] = useState<Settlement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettleDraft | 'new'>(null);

  useEffect(() => {
    Promise.all([
      api<BalancesResponse>(`/groups/${group.id}/balances`),
      api<{ settlements: Settlement[] }>(`/groups/${group.id}/settlements`),
      api<{ settlements: Settlement[] }>(`/groups/${group.id}/settlements/deleted`),
    ])
      .then(([b, s, removed]) => {
        setData(b);
        setSettlements(s.settlements);
        setDeleted(removed.settlements);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [group.id, version]);

  async function removeSettlement(s: Settlement) {
    if (!confirm(`Να διαγραφεί η πληρωμή ${money(s.amount, group.currency)} από ${s.from_name} προς ${s.to_name};`)) return;
    try {
      await api(`/groups/${group.id}/settlements/${s.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function restoreSettlement(s: Settlement) {
    try {
      await api(`/groups/${group.id}/settlements/${s.id}/restore`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!data || !settlements) return <Spinner />;

  const allSettled = data.suggestions.length === 0;

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Υπόλοιπα</h2>
        <ul className="list plain">
          {data.balances
            .filter((b) => b.is_member || Math.abs(b.net) > 0.004)
            .map((b) => (
              <li key={b.user_id} className="list-item static">
                <Avatar name={b.name} />
                <div className="list-main">
                  <div className="list-title">
                    {b.name}
                    {b.user_id === currentUserId && <span className="muted"> (εγώ)</span>}
                    {!b.is_member && <span className="muted small"> · αποχώρησε</span>}
                  </div>
                  <div className="muted small">
                    πλήρωσε {money(b.paid, group.currency)} · αναλογία {money(b.owed, group.currency)}
                  </div>
                </div>
                <div className="list-amount">
                  {Math.abs(b.net) < 0.005 ? (
                    <span className="balance zero">τακτοποιημένα</span>
                  ) : b.net > 0 ? (
                    <>
                      <span className="muted small">παίρνει</span>
                      <span className="balance pos">{money(b.net, group.currency)}</span>
                    </>
                  ) : (
                    <>
                      <span className="muted small">χρωστάει</span>
                      <span className="balance neg">{money(-b.net, group.currency)}</span>
                    </>
                  )}
                </div>
              </li>
            ))}
        </ul>
      </section>

      <section className="card stack">
        <div className="row between">
          <h2>Εξόφληση</h2>
          <button className="btn btn-small" onClick={() => setDraft('new')}>
            Καταγραφή πληρωμής
          </button>
        </div>
        {allSettled ? (
          <p className="muted">Όλα τακτοποιημένα, κανείς δεν χρωστάει τίποτα. 🎉</p>
        ) : (
          <>
            <p className="muted small">Οι λιγότερες δυνατές πληρωμές για να μηδενιστούν τα υπόλοιπα της ομάδας:</p>
            <ul className="list plain">
              {data.suggestions.map((s, i) => (
                <li key={i} className="list-item static">
                  <div className="list-main">
                    <div className="list-title">
                      <strong>{s.from_user === currentUserId ? 'Εσείς' : s.from_name}</strong> →{' '}
                      <strong>{s.to_user === currentUserId ? 'εσάς' : s.to_name}</strong>
                    </div>
                  </div>
                  <div className="row gap">
                    <span className="amount">{money(s.amount, group.currency)}</span>
                    <button
                      className="btn btn-small btn-primary"
                      onClick={() => setDraft({ from_user: s.from_user, to_user: s.to_user, amount: s.amount })}
                    >
                      Εξοφλήθηκε
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Ιστορικό πληρωμών</h2>
        {settlements.length === 0 ? (
          <Empty title="Καμία πληρωμή ακόμη" />
        ) : (
          <ul className="list plain">
            {settlements.map((s) => (
              <li key={s.id} className="list-item static">
                <div className="list-main">
                  <div className="list-title">
                    {s.from_name} → {s.to_name}
                  </div>
                  <div className="muted small">
                    {date(s.settled_at)}
                    {s.note ? ` · ${s.note}` : ''}
                  </div>
                </div>
                <div className="row gap">
                  <span className="amount">{money(s.amount, group.currency)}</span>
                  <button className="btn-icon" aria-label="Διαγραφή" onClick={() => removeSettlement(s)}>
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <DeletedItems
          items={deleted}
          label={(s) => (
            <>
              <div className="list-title">
                {s.from_name} → {s.to_name}
              </div>
              <div className="muted small">
                {date(s.settled_at)} · {money(s.amount, group.currency)}
              </div>
            </>
          )}
          onRestore={restoreSettlement}
        />
      </section>

      {draft !== null && (
        <SettleForm
          group={group}
          members={members}
          currentUserId={currentUserId}
          initial={draft === 'new' ? null : draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SettleForm({
  group,
  members,
  currentUserId,
  initial,
  onClose,
  onSaved,
}: {
  group: Group;
  members: Member[];
  currentUserId: number;
  initial: SettleDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const other = members.find((m) => m.user_id !== currentUserId)?.user_id ?? currentUserId;
  const [fromUser, setFromUser] = useState(initial?.from_user ?? currentUserId);
  const [toUser, setToUser] = useState(initial?.to_user ?? other);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [settledAt, setSettledAt] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.id}/settlements`, {
        method: 'POST',
        body: { from_user: fromUser, to_user: toUser, amount: Number(amount), settled_at: settledAt, note: note || null },
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const name = (id: number) => members.find((m) => m.user_id === id)?.name ?? `#${id}`;

  return (
    <Modal title="Καταγραφή πληρωμής" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorBox error={error} />
        <div className="grid-2">
          <Field label="Πλήρωσε">
            <select value={fromUser} onChange={(e) => setFromUser(Number(e.target.value))}>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === currentUserId ? `${m.name} (εγώ)` : m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Προς">
            <select value={toUser} onChange={(e) => setToUser(Number(e.target.value))}>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === currentUserId ? `${m.name} (εγώ)` : m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label={`Ποσό (${group.currency})`}>
            <input type="number" inputMode="decimal" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Ημερομηνία">
            <input type="date" required value={settledAt} onChange={(e) => setSettledAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Σημείωση (προαιρετικό)">
          <input maxLength={200} placeholder="π.χ. μεταφορά Revolut" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="muted small">
          Καταγράφεται ότι ο/η {name(fromUser)} έδωσε {amount ? money(Number(amount), group.currency) : '…'} στον/στην {name(toUser)}.
        </p>
        <button className="btn btn-primary btn-block" disabled={busy || fromUser === toUser}>
          Καταγραφή
        </button>
      </form>
    </Modal>
  );
}
