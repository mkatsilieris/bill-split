import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { percent } from '../format';
import type { Category, Group, Member, Role, SplitMode } from '../types';
import { CategoriesCard } from './CategoriesCard';
import { Avatar, ErrorBox, Field, SuccessBox } from './ui';

interface Props {
  group: Group;
  members: Member[];
  categories: Category[];
  myRole: Role;
  currentUserId: number;
  onChanged: () => Promise<unknown> | void;
  onLeft: () => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function MembersTab({ group, members, categories, myRole, currentUserId, onChanged, onLeft }: Props) {
  const isOwner = myRole === 'owner';
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- invite ---
  const inviteLink = `${window.location.origin}/join?code=${group.invite_code}`;
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      prompt('Αντιγράψτε:', text);
    }
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Ομάδα ${group.name}`, text: `Μπες στην ομάδα «${group.name}» στο Bill Split`, url: inviteLink });
      } catch {
        /* cancelled */
      }
    } else copy(inviteLink, 'link');
  }

  // --- add member ---
  const [email, setEmail] = useState('');
  async function addMember(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api(`/groups/${group.id}/members`, { method: 'POST', body: { email } });
      setEmail('');
      setOk('Το μέλος προστέθηκε');
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(m: Member) {
    const self = m.user_id === currentUserId;
    if (!confirm(self ? 'Να αποχωρήσετε από την ομάδα;' : `Να αφαιρεθεί ο/η ${m.name} από την ομάδα;`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.id}/members/${m.user_id}`, { method: 'DELETE' });
      if (self) onLeft();
      else await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // --- settings ---
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [currency, setCurrency] = useState(group.currency);
  const [splitMode, setSplitMode] = useState<SplitMode>(group.split_mode);
  const [shares, setShares] = useState<Record<number, string>>({});

  useEffect(() => {
    setName(group.name);
    setDescription(group.description ?? '');
    setCurrency(group.currency);
    setSplitMode(group.split_mode);
    const init: Record<number, string> = {};
    for (const m of members) init[m.user_id] = String(m.share_percent ?? 0);
    setShares(init);
  }, [group, members]);

  const shareSum = useMemo(() => members.reduce((s, m) => s + (Number(shares[m.user_id]) || 0), 0), [members, shares]);
  const sharesValid = Math.abs(shareSum - 100) <= 0.01;

  function equalize() {
    const n = members.length;
    const base = Math.floor((100 / n) * 100) / 100;
    let rest = round2(100 - base * n);
    const next: Record<number, string> = {};
    for (const m of members) {
      const extra = rest > 0 ? 0.01 : 0;
      next[m.user_id] = String(round2(base + extra));
      rest = round2(rest - extra);
    }
    setShares(next);
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api(`/groups/${group.id}`, {
        method: 'PATCH',
        body: {
          name,
          description: description || null,
          currency,
          split_mode: splitMode,
          shares:
            splitMode === 'percentage'
              ? members.map((m) => ({ user_id: m.user_id, share_percent: Number(shares[m.user_id]) || 0 }))
              : undefined,
        },
      });
      setOk('Οι ρυθμίσεις αποθηκεύτηκαν');
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function rotateCode() {
    if (!confirm('Ο παλιός κωδικός πρόσκλησης θα σταματήσει να ισχύει. Συνέχεια;')) return;
    try {
      await api(`/groups/${group.id}/invite-code`, { method: 'POST' });
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function deleteGroup() {
    if (!confirm(`Να διαγραφεί η ομάδα «${group.name}» για όλα τα μέλη;`)) return;
    try {
      await api(`/groups/${group.id}`, { method: 'DELETE' });
      onLeft();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <SuccessBox message={ok} />

      <section className="card stack">
        <h2>Μέλη ({members.length})</h2>
        <ul className="list plain">
          {members.map((m) => (
            <li key={m.user_id} className="list-item static">
              <Avatar name={m.name} />
              <div className="list-main">
                <div className="list-title">
                  {m.name}
                  {m.user_id === currentUserId && <span className="muted"> (εγώ)</span>}
                  {m.role === 'owner' && <span className="chip small">διαχειριστής</span>}
                </div>
                <div className="muted small">{m.email}</div>
              </div>
              <div className="row gap">
                {group.split_mode === 'percentage' && <span className="amount">{percent(m.share_percent ?? 0)}</span>}
                {(isOwner || m.user_id === currentUserId) && (
                  <button className="btn btn-small" disabled={busy} onClick={() => removeMember(m)}>
                    {m.user_id === currentUserId ? 'Αποχώρηση' : 'Αφαίρεση'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack">
        <h2>Πρόσκληση μελών</h2>
        <p className="muted small">
          Στείλτε τον κωδικό ή τον σύνδεσμο. Όποιος έχει λογαριασμό μπαίνει αμέσως, όποιος δεν έχει κάνει εγγραφή πρώτα και
          μετά χρησιμοποιεί τον κωδικό.
        </p>
        <div className="invite-box">
          <code className="invite-code">{group.invite_code}</code>
          <div className="row gap wrap">
            <button className="btn btn-small" onClick={() => copy(group.invite_code, 'code')}>
              {copied === 'code' ? 'Αντιγράφηκε ✓' : 'Αντιγραφή κωδικού'}
            </button>
            <button className="btn btn-small" onClick={() => copy(inviteLink, 'link')}>
              {copied === 'link' ? 'Αντιγράφηκε ✓' : 'Αντιγραφή συνδέσμου'}
            </button>
            <button className="btn btn-small btn-primary" onClick={share}>
              Κοινοποίηση
            </button>
            {isOwner && (
              <button className="btn btn-small" onClick={rotateCode}>
                Νέος κωδικός
              </button>
            )}
          </div>
        </div>
        <form onSubmit={addMember} className="row gap wrap align-end">
          <Field label="Ή προσθήκη με email (υπάρχοντος χρήστη)">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
          </Field>
          <button className="btn" disabled={busy}>
            Προσθήκη
          </button>
        </form>
      </section>

      <section className="card stack">
        <h2>Ρυθμίσεις ομάδας</h2>
        <form onSubmit={saveSettings} className="stack">
          <Field label="Όνομα">
            <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Περιγραφή">
            <input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Νόμισμα">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {['EUR', 'USD', 'GBP', 'CHF'].includes(currency) || <option value={currency}>{currency}</option>}
              <option value="EUR">€ Ευρώ (EUR)</option>
              <option value="USD">$ Δολάριο (USD)</option>
              <option value="GBP">£ Λίρα (GBP)</option>
              <option value="CHF">CHF</option>
            </select>
          </Field>

          <fieldset className="fieldset">
            <legend>Πώς μοιράζονται τα έξοδα (προεπιλογή)</legend>
            <label className="radio">
              <input type="radio" checked={splitMode === 'equal'} onChange={() => setSplitMode('equal')} />
              <span>
                Ίσα μέρη <span className="muted small">— π.χ. μισά-μισά για 2 μέλη</span>
              </span>
            </label>
            <label className="radio">
              <input type="radio" checked={splitMode === 'percentage'} onChange={() => setSplitMode('percentage')} />
              <span>
                Ποσοστό ανά μέλος <span className="muted small">— π.χ. 60% / 40%</span>
              </span>
            </label>
            {splitMode === 'percentage' && (
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
                        value={shares[m.user_id] ?? ''}
                        onChange={(e) => setShares({ ...shares, [m.user_id]: e.target.value })}
                      />
                      <span>%</span>
                    </span>
                  </div>
                ))}
                <div className="row between">
                  <div className={`split-sum ${sharesValid ? 'pos' : 'neg'}`}>
                    Σύνολο: {shareSum.toFixed(2)}% {!sharesValid && '(πρέπει να είναι 100%)'}
                  </div>
                  <button type="button" className="btn btn-small" onClick={equalize}>
                    Μοίρασε ίσα
                  </button>
                </div>
              </div>
            )}
            <p className="muted small">
              Η προεπιλογή εφαρμόζεται στα νέα έξοδα. Σε κάθε έξοδο μπορείτε να επιλέξετε διαφορετικό διαμοιρασμό. Τα ήδη
              καταχωρισμένα έξοδα δεν αλλάζουν.
            </p>
          </fieldset>

          <button className="btn btn-primary" disabled={busy || (splitMode === 'percentage' && !sharesValid)}>
            Αποθήκευση ρυθμίσεων
          </button>
        </form>
      </section>

      <CategoriesCard group={group} categories={categories} onChanged={onChanged} />

      {isOwner && (
        <section className="card stack danger-zone">
          <h2>Διαγραφή ομάδας</h2>
          <p className="muted small">
            Η ομάδα εξαφανίζεται για όλα τα μέλη. Ο διαχειριστής μπορεί να την επαναφέρει με όλα τα στοιχεία της από τη λίστα
            «Οι ομάδες μου».
          </p>
          <button className="btn btn-danger" onClick={deleteGroup}>
            Διαγραφή ομάδας
          </button>
        </section>
      )}
    </div>
  );
}
