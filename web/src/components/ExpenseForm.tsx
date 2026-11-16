import { useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { money, today } from '../format';
import type { Category, Expense, Group, Member, SplitType } from '../types';
import { ErrorBox, Field, Modal } from './ui';

interface Props {
  group: Group;
  members: Member[];
  /** the categories of the group */
  categories: Category[];
  currentUserId: number;
  existing?: Expense;
  onClose: () => void;
  onSaved: () => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ExpenseForm({ group, members, categories, currentUserId, existing, onClose, onSaved }: Props) {
  const [description, setDescription] = useState(existing?.description ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [paidBy, setPaidBy] = useState<number>(existing?.paid_by ?? currentUserId);
  const [spentAt, setSpentAt] = useState(existing?.spent_at ?? today());
  const [category, setCategory] = useState(existing?.category ?? '');
  const [splitType, setSplitType] = useState<SplitType>(existing?.split_type ?? 'group');

  const [participants, setParticipants] = useState<Set<number>>(() => {
    if (existing && existing.split_type === 'equal') return new Set(existing.shares.map((s) => s.user_id));
    return new Set(members.map((m) => m.user_id));
  });
  const [percents, setPercents] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    if (existing && existing.split_type === 'percentage' && existing.amount > 0) {
      for (const s of existing.shares) init[s.user_id] = String(round2((s.amount / existing.amount) * 100));
    } else {
      for (const m of members) init[m.user_id] = String(round2(100 / members.length));
    }
    return init;
  });
  const [exacts, setExacts] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    if (existing && existing.split_type === 'exact') for (const s of existing.shares) init[s.user_id] = String(s.amount);
    return init;
  });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // an expense may have a category that is no longer on the list of the group: keep it selectable
  const categoryOptions = useMemo(() => {
    const names = categories.map((c) => c.name);
    return existing?.category && !names.includes(existing.category) ? [...names, existing.category] : names;
  }, [categories, existing]);

  const total = Number(amount) || 0;
  const percentSum = useMemo(
    () => members.reduce((s, m) => s + (Number(percents[m.user_id]) || 0), 0),
    [members, percents],
  );
  const exactSum = useMemo(() => members.reduce((s, m) => s + (Number(exacts[m.user_id]) || 0), 0), [members, exacts]);

  const groupDefaultLabel =
    group.split_mode === 'equal'
      ? 'Ίσα μέρη σε όλα τα μέλη'
      : `Ποσοστά της ομάδας (${members.map((m) => `${m.name} ${m.share_percent ?? 0}%`).join(', ')})`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(total > 0)) {
      setError('Το ποσό πρέπει να είναι μεγαλύτερο από 0');
      return;
    }
    const split: { type: SplitType; shares?: { user_id: number; value?: number }[] } = { type: splitType };
    if (splitType === 'equal') {
      split.shares = [...participants].map((user_id) => ({ user_id }));
      if (split.shares.length === 0) {
        setError('Επιλέξτε τουλάχιστον ένα μέλος');
        return;
      }
    } else if (splitType === 'percentage') {
      split.shares = members.map((m) => ({ user_id: m.user_id, value: Number(percents[m.user_id]) || 0 }));
    } else if (splitType === 'exact') {
      split.shares = members.map((m) => ({ user_id: m.user_id, value: Number(exacts[m.user_id]) || 0 }));
    }

    setBusy(true);
    try {
      const body = {
        description,
        amount: round2(total),
        paid_by: paidBy,
        spent_at: spentAt,
        category: category || null,
        split,
      };
      if (existing) await api(`/groups/${group.id}/expenses/${existing.id}`, { method: 'PUT', body });
      else await api(`/groups/${group.id}/expenses`, { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || !confirm('Να διαγραφεί αυτό το έξοδο;')) return;
    setBusy(true);
    try {
      await api(`/groups/${group.id}/expenses/${existing.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function distributeExactEqually() {
    const cents = Math.round(total * 100);
    const n = members.length;
    const base = Math.floor(cents / n);
    let rest = cents - base * n;
    const next: Record<number, string> = {};
    for (const m of members) {
      next[m.user_id] = ((base + (rest > 0 ? 1 : 0)) / 100).toFixed(2);
      if (rest > 0) rest--;
    }
    setExacts(next);
  }

  return (
    <Modal title={existing ? 'Επεξεργασία εξόδου' : 'Νέο έξοδο'} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorBox error={error} />
        <Field label="Περιγραφή">
          <input required maxLength={200} autoFocus placeholder="π.χ. Σούπερ μάρκετ" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label={`Ποσό (${group.currency})`}>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Ημερομηνία">
            <input type="date" required value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Πλήρωσε">
            <select value={paidBy} onChange={(e) => setPaidBy(Number(e.target.value))}>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === currentUserId ? `${m.name} (εγώ)` : m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Κατηγορία">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <fieldset className="fieldset">
          <legend>Διαμοιρασμός</legend>
          <label className="radio">
            <input type="radio" checked={splitType === 'group'} onChange={() => setSplitType('group')} />
            <span>
              Προεπιλογή ομάδας <span className="muted small">— {groupDefaultLabel}</span>
            </span>
          </label>
          <label className="radio">
            <input type="radio" checked={splitType === 'equal'} onChange={() => setSplitType('equal')} />
            <span>Ίσα, μόνο μεταξύ επιλεγμένων</span>
          </label>
          <label className="radio">
            <input type="radio" checked={splitType === 'percentage'} onChange={() => setSplitType('percentage')} />
            <span>Ποσοστά για αυτό το έξοδο</span>
          </label>
          <label className="radio">
            <input type="radio" checked={splitType === 'exact'} onChange={() => setSplitType('exact')} />
            <span>Ακριβή ποσά</span>
          </label>

          {splitType === 'equal' && (
            <div className="split-table">
              {members.map((m) => (
                <label key={m.user_id} className="split-row">
                  <input
                    type="checkbox"
                    checked={participants.has(m.user_id)}
                    onChange={(e) => {
                      const next = new Set(participants);
                      if (e.target.checked) next.add(m.user_id);
                      else next.delete(m.user_id);
                      setParticipants(next);
                    }}
                  />
                  <span className="split-name">{m.name}</span>
                  <span className="muted small">
                    {participants.has(m.user_id) && participants.size > 0 ? money(total / participants.size, group.currency) : '—'}
                  </span>
                </label>
              ))}
            </div>
          )}

          {splitType === 'percentage' && (
            <div className="split-table">
              {members.map((m) => (
                <div key={m.user_id} className="split-row">
                  <span className="split-name">{m.name}</span>
                  <span className="input-suffix">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max="100"
                      value={percents[m.user_id] ?? ''}
                      onChange={(e) => setPercents({ ...percents, [m.user_id]: e.target.value })}
                    />
                    <span>%</span>
                  </span>
                  <span className="muted small">{money((total * (Number(percents[m.user_id]) || 0)) / 100, group.currency)}</span>
                </div>
              ))}
              <div className={`split-sum ${Math.abs(percentSum - 100) > 0.01 ? 'neg' : 'pos'}`}>
                Σύνολο: {percentSum.toFixed(2)}% {Math.abs(percentSum - 100) > 0.01 && '(πρέπει να είναι 100%)'}
              </div>
            </div>
          )}

          {splitType === 'exact' && (
            <div className="split-table">
              {members.map((m) => (
                <div key={m.user_id} className="split-row">
                  <span className="split-name">{m.name}</span>
                  <span className="input-suffix">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={exacts[m.user_id] ?? ''}
                      onChange={(e) => setExacts({ ...exacts, [m.user_id]: e.target.value })}
                    />
                    <span>{group.currency}</span>
                  </span>
                </div>
              ))}
              <div className="row between">
                <div className={`split-sum ${Math.abs(exactSum - total) > 0.004 ? 'neg' : 'pos'}`}>
                  Σύνολο: {money(exactSum, group.currency)} / {money(total, group.currency)}
                </div>
                <button type="button" className="btn btn-small" onClick={distributeExactEqually}>
                  Μοίρασε ίσα
                </button>
              </div>
            </div>
          )}
        </fieldset>

        <div className="row between">
          {existing ? (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Διαγραφή
            </button>
          ) : (
            <span />
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
