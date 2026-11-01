import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { money } from '../format';
import type { Group, GroupSummary } from '../types';
import { Empty, ErrorBox, Field, Modal, Spinner } from '../components/ui';

export default function Groups() {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const load = useCallback(() => {
    api<{ groups: GroupSummary[] }>('/groups')
      .then((r) => setGroups(r.groups))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Οι ομάδες μου</h1>
        <div className="row gap">
          <button className="btn" onClick={() => setShowJoin(true)}>
            Συμμετοχή με κωδικό
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Νέα ομάδα
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {groups === null ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <Empty title="Δεν έχετε ακόμη ομάδες">
          <p className="muted">
            Δημιουργήστε μια ομάδα για το σπίτι, ένα ταξίδι ή οποιαδήποτε κοινά έξοδα, ή μπείτε σε υπάρχουσα με τον κωδικό
            πρόσκλησης.
          </p>
        </Empty>
      ) : (
        <ul className="card-list">
          {groups.map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.id}`} className="card group-card">
                <div className="group-card-main">
                  <div className="group-card-title">{g.name}</div>
                  <div className="muted small">
                    {g.member_count} {g.member_count === 1 ? 'μέλος' : 'μέλη'} · σύνολο {money(g.total_spent, g.currency)} ·{' '}
                    {g.split_mode === 'equal' ? 'ίσα μέρη' : 'ποσοστά'}
                  </div>
                </div>
                <div className="group-card-balance">
                  {Math.abs(g.my_balance) < 0.005 ? (
                    <span className="balance zero">Τακτοποιημένα</span>
                  ) : g.my_balance > 0 ? (
                    <>
                      <span className="muted small">σας χρωστούν</span>
                      <span className="balance pos">{money(g.my_balance, g.currency)}</span>
                    </>
                  ) : (
                    <>
                      <span className="muted small">χρωστάτε</span>
                      <span className="balance neg">{money(-g.my_balance, g.currency)}</span>
                    </>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} />}
      {showJoin && <JoinGroupModal onClose={() => setShowJoin(false)} />}
    </div>
  );
}

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ group: Group }>('/groups', {
        method: 'POST',
        body: { name, description: description || undefined, currency },
      });
      navigate(`/groups/${r.group.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Νέα ομάδα" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorBox error={error} />
        <Field label="Όνομα">
          <input required maxLength={100} placeholder="π.χ. Σπίτι, Ταξίδι Κρήτη" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Περιγραφή (προαιρετικό)">
          <input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Νόμισμα">
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="EUR">€ Ευρώ (EUR)</option>
            <option value="USD">$ Δολάριο (USD)</option>
            <option value="GBP">£ Λίρα (GBP)</option>
            <option value="CHF">CHF</option>
          </select>
        </Field>
        <p className="muted small">Μετά τη δημιουργία μπορείτε να ορίσετε αν τα έξοδα μοιράζονται ίσα ή με ποσοστά.</p>
        <button className="btn btn-primary btn-block" disabled={busy}>
          Δημιουργία
        </button>
      </form>
    </Modal>
  );
}

function JoinGroupModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ group: Group }>('/groups/join', { method: 'POST', body: { code } });
      navigate(`/groups/${r.group.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Συμμετοχή σε ομάδα" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorBox error={error} />
        <Field label="Κωδικός πρόσκλησης" hint="Τον βρίσκει ο διαχειριστής της ομάδας στην καρτέλα «Μέλη»">
          <input
            required
            className="code-input"
            placeholder="ABCD2345"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>
          Συμμετοχή
        </button>
      </form>
    </Modal>
  );
}
