import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { date, money, today } from '../format';
import type { Balance, DebtChange, Group, Member, Settlement, Suggestion, TransferTarget } from '../types';
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
type DebtDraft = { debtor: number; creditor: number; amount: number } | null;

export function BalancesTab({ group, members, currentUserId, version, onChanged }: Props) {
  const [data, setData] = useState<BalancesResponse | null>(null);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [deleted, setDeleted] = useState<Settlement[]>([]);
  const [changes, setChanges] = useState<DebtChange[]>([]);
  const [deletedChanges, setDeletedChanges] = useState<DebtChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettleDraft | 'new'>(null);
  const [adjust, setAdjust] = useState<DebtDraft | 'new'>(null);
  const [transfer, setTransfer] = useState<DebtDraft | 'new'>(null);

  useEffect(() => {
    Promise.all([
      api<BalancesResponse>(`/groups/${group.id}/balances`),
      api<{ settlements: Settlement[] }>(`/groups/${group.id}/settlements`),
      api<{ settlements: Settlement[] }>(`/groups/${group.id}/settlements/deleted`),
      api<{ changes: DebtChange[] }>(`/groups/${group.id}/debt-changes`),
      api<{ changes: DebtChange[] }>(`/groups/${group.id}/debt-changes/deleted`),
    ])
      .then(([b, s, removed, c, removedChanges]) => {
        setData(b);
        setSettlements(s.settlements);
        setDeleted(removed.settlements);
        setChanges(c.changes);
        setDeletedChanges(removedChanges.changes);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [group.id, version]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function removeSettlement(s: Settlement) {
    if (!confirm(`Να διαγραφεί η πληρωμή ${money(s.amount, group.currency)} από ${s.from_name} προς ${s.to_name};`)) return;
    void run(() => api(`/groups/${group.id}/settlements/${s.id}`, { method: 'DELETE' }));
  }

  function removeChange(c: DebtChange) {
    const extra = c.kind === 'adjustment' ? '' : ` Θα αναιρεθεί και στην ομάδα «${c.counterpart_group_name}».`;
    if (!confirm(`Να διαγραφεί αυτή η αλλαγή χρέους;${extra}`)) return;
    void run(() => api(`/groups/${group.id}/debt-changes/${c.id}`, { method: 'DELETE' }));
  }

  if (error && !data) return <ErrorBox error={error} />;
  if (!data || !settlements) return <Spinner />;

  const allSettled = data.suggestions.length === 0;
  const closeAll = () => {
    setDraft(null);
    setAdjust(null);
    setTransfer(null);
  };
  const saved = () => {
    closeAll();
    onChanged();
  };

  return (
    <div className="stack">
      <ErrorBox error={error} />
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
                    {Math.abs(b.adjusted) > 0.004 && ` · αλλαγές χρεών ${b.adjusted > 0 ? '+' : '−'}${money(Math.abs(b.adjusted), group.currency)}`}
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
                    <div className="amount">{money(s.amount, group.currency)}</div>
                  </div>
                  <div className="row gap wrap">
                    <button
                      className="btn btn-small"
                      title="Μεταφορά του χρέους σε άλλη ομάδα"
                      onClick={() => setTransfer({ debtor: s.from_user, creditor: s.to_user, amount: s.amount })}
                    >
                      Μεταφορά
                    </button>
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
        <div className="row between wrap">
          <h2>Αλλαγές χρεών</h2>
          <div className="row gap">
            <button className="btn btn-small" onClick={() => setAdjust('new')}>
              Αλλαγή χρέους
            </button>
            <button className="btn btn-small" onClick={() => setTransfer('new')}>
              Μεταφορά σε άλλη ομάδα
            </button>
          </div>
        </div>
        <p className="muted small">
          Διορθώσεις στο ποιος χρωστάει τι, χωρίς έξοδο ή πληρωμή, και χρέη που μεταφέρθηκαν από ή προς άλλη ομάδα.
        </p>
        {changes.length === 0 ? (
          <p className="muted">Καμία αλλαγή ακόμη.</p>
        ) : (
          <ul className="list plain">
            {changes.map((c) => (
              <li key={c.id} className="list-item static">
                <div className="list-main">
                  <div className="list-title">
                    <ChangeText change={c} currency={group.currency} />
                  </div>
                  <div className="muted small">
                    {date(c.changed_at)}
                    {c.note ? ` · ${c.note}` : ''}
                  </div>
                </div>
                <div className="row gap">
                  <span className="amount">{money(c.amount, group.currency)}</span>
                  <button className="btn-icon" aria-label="Διαγραφή" onClick={() => removeChange(c)}>
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <DeletedItems
          items={deletedChanges}
          label={(c) => (
            <>
              <div className="list-title">
                <ChangeText change={c} currency={group.currency} />
              </div>
              <div className="muted small">
                {date(c.changed_at)} · {money(c.amount, group.currency)}
              </div>
            </>
          )}
          onRestore={(c) => run(() => api(`/groups/${group.id}/debt-changes/${c.id}/restore`, { method: 'POST' }))}
        />
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
          onRestore={(s) => run(() => api(`/groups/${group.id}/settlements/${s.id}/restore`, { method: 'POST' }))}
        />
      </section>

      {draft !== null && (
        <SettleForm
          group={group}
          members={members}
          currentUserId={currentUserId}
          initial={draft === 'new' ? null : draft}
          onClose={closeAll}
          onSaved={saved}
        />
      )}
      {adjust !== null && (
        <AdjustForm group={group} members={members} currentUserId={currentUserId} initial={adjust === 'new' ? null : adjust} onClose={closeAll} onSaved={saved} />
      )}
      {transfer !== null && (
        <TransferForm
          group={group}
          members={members}
          currentUserId={currentUserId}
          initial={transfer === 'new' ? null : transfer}
          onClose={closeAll}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function ChangeText({ change: c, currency }: { change: DebtChange; currency: string }) {
  if (c.kind === 'transfer_out') {
    return (
      <>
        Χρέος {c.debtor_name} → {c.creditor_name} μεταφέρθηκε στην ομάδα «{c.counterpart_group_name ?? '…'}»
      </>
    );
  }
  if (c.kind === 'transfer_in') {
    return (
      <>
        Χρέος {c.debtor_name} → {c.creditor_name} ήρθε από την ομάδα «{c.counterpart_group_name ?? '…'}»
      </>
    );
  }
  return (
    <>
      {c.debtor_name} χρωστάει {c.direction === 'increase' ? 'περισσότερα' : 'λιγότερα'} κατά {money(c.amount, currency)} στον/στην{' '}
      {c.creditor_name}
    </>
  );
}

function MemberSelect({
  members,
  currentUserId,
  value,
  onChange,
}: {
  members: Member[];
  currentUserId: number;
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.user_id === currentUserId ? `${m.name} (εγώ)` : m.name}
        </option>
      ))}
    </select>
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
            <MemberSelect members={members} currentUserId={currentUserId} value={fromUser} onChange={setFromUser} />
          </Field>
          <Field label="Προς">
            <MemberSelect members={members} currentUserId={currentUserId} value={toUser} onChange={setToUser} />
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

/** Manual correction of a debt inside the group. */
function AdjustForm({
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
  initial: DebtDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const other = members.find((m) => m.user_id !== currentUserId)?.user_id ?? currentUserId;
  const [debtor, setDebtor] = useState(initial?.debtor ?? currentUserId);
  const [creditor, setCreditor] = useState(initial?.creditor ?? other);
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [changedAt, setChangedAt] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.id}/debt-changes`, {
        method: 'POST',
        body: { debtor, creditor, amount: Number(amount), direction, changed_at: changedAt, note: note || null },
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const name = (id: number) => members.find((m) => m.user_id === id)?.name ?? `#${id}`;

  return (
    <Modal title="Αλλαγή χρέους" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorBox error={error} />
        <p className="muted small">Αλλάζει το ποιος χρωστάει τι χωρίς να καταγραφεί έξοδο ή πληρωμή, π.χ. για μια διόρθωση ή μια συμφωνία.</p>
        <div className="grid-2">
          <Field label="Χρωστάει">
            <MemberSelect members={members} currentUserId={currentUserId} value={debtor} onChange={setDebtor} />
          </Field>
          <Field label="Στον/στην">
            <MemberSelect members={members} currentUserId={currentUserId} value={creditor} onChange={setCreditor} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Αλλαγή">
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease')}>
              <option value="increase">περισσότερα κατά</option>
              <option value="decrease">λιγότερα κατά</option>
            </select>
          </Field>
          <Field label={`Ποσό (${group.currency})`}>
            <input type="number" inputMode="decimal" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Ημερομηνία">
            <input type="date" required value={changedAt} onChange={(e) => setChangedAt(e.target.value)} />
          </Field>
          <Field label="Λόγος (προαιρετικό)">
            <input maxLength={200} placeholder="π.χ. λάθος στο Splitwise" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <p className="muted small">
          Ο/η {name(debtor)} θα χρωστάει {direction === 'increase' ? 'περισσότερα' : 'λιγότερα'} κατά{' '}
          {amount ? money(Number(amount), group.currency) : '…'} στον/στην {name(creditor)}.
        </p>
        <button className="btn btn-primary btn-block" disabled={busy || debtor === creditor}>
          Καταχώριση
        </button>
      </form>
    </Modal>
  );
}

/** Moves a debt between two members to another group where both are members. */
function TransferForm({
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
  initial: DebtDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const other = members.find((m) => m.user_id !== currentUserId)?.user_id ?? currentUserId;
  const [debtor, setDebtor] = useState(initial?.debtor ?? currentUserId);
  const [creditor, setCreditor] = useState(initial?.creditor ?? other);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [targets, setTargets] = useState<TransferTarget[] | null>(null);
  const [target, setTarget] = useState<number | ''>('');
  const [changedAt, setChangedAt] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (debtor === creditor) return;
    setTargets(null);
    api<{ groups: TransferTarget[] }>(`/groups/${group.id}/debt-changes/targets?debtor=${debtor}&creditor=${creditor}`)
      .then((r) => {
        const usable = r.groups.filter((g) => g.currency === group.currency);
        setTargets(usable);
        setTarget((t) => (t !== '' && usable.some((g) => g.id === t) ? t : (usable[0]?.id ?? '')));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [group.id, group.currency, debtor, creditor]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (target === '') return;
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.id}/debt-changes/transfer`, {
        method: 'POST',
        body: { debtor, creditor, amount: Number(amount), target_group_id: target, changed_at: changedAt, note: note || null },
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const name = (id: number) => members.find((m) => m.user_id === id)?.name ?? `#${id}`;
  const targetName = targets?.find((g) => g.id === target)?.name;

  return (
    <Modal title="Μεταφορά χρέους σε άλλη ομάδα" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorBox error={error} />
        <p className="muted small">
          Το χρέος φεύγει από αυτή την ομάδα και εμφανίζεται στην άλλη. Χρειάζεται να είστε μέλη της και οι δύο, με το ίδιο νόμισμα.
        </p>
        <div className="grid-2">
          <Field label="Χρωστάει">
            <MemberSelect members={members} currentUserId={currentUserId} value={debtor} onChange={setDebtor} />
          </Field>
          <Field label="Στον/στην">
            <MemberSelect members={members} currentUserId={currentUserId} value={creditor} onChange={setCreditor} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label={`Ποσό (${group.currency})`}>
            <input type="number" inputMode="decimal" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Προς ομάδα">
            {targets === null ? (
              <select disabled>
                <option>Φόρτωση…</option>
              </select>
            ) : targets.length === 0 ? (
              <select disabled>
                <option>Καμία κοινή ομάδα</option>
              </select>
            ) : (
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {targets.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Ημερομηνία">
            <input type="date" required value={changedAt} onChange={(e) => setChangedAt(e.target.value)} />
          </Field>
          <Field label="Σημείωση (προαιρετικό)">
            <input maxLength={200} placeholder="π.χ. κλείσιμο ομάδας ταξιδιού" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {targets !== null && targets.length === 0 && (
          <p className="muted small">
            Δεν υπάρχει άλλη ομάδα στην οποία να είναι μέλη ο/η {name(debtor)} και ο/η {name(creditor)} με νόμισμα {group.currency}.
          </p>
        )}
        {targetName && (
          <p className="muted small">
            Το χρέος {amount ? money(Number(amount), group.currency) : '…'} του/της {name(debtor)} προς {name(creditor)} θα μεταφερθεί στην ομάδα «{targetName}».
          </p>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || debtor === creditor || target === ''}>
          Μεταφορά
        </button>
      </form>
    </Modal>
  );
}
