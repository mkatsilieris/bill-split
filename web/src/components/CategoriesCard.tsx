import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import type { Category, Group } from '../types';
import { ErrorBox, Field, SuccessBox } from './ui';

interface Props {
  group: Group;
  categories: Category[];
  onChanged: () => Promise<unknown> | void;
}

const MAX_LENGTH = 50;

/** The expense categories of the group: add, rename (the expenses follow) and remove. Any member may. */
export function CategoriesCard({ group, categories, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const message = await action();
      await onChanged();
      setOk(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const { category } = await api<{ category: Category }>(`/groups/${group.id}/categories`, { method: 'POST', body: { name: newName } });
      setNewName('');
      return `Η κατηγορία «${category.name}» προστέθηκε`;
    });
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { id, name } = editing;
    run(async () => {
      const r = await api<{ category: Category; expenses_updated: number }>(`/groups/${group.id}/categories/${id}`, {
        method: 'PATCH',
        body: { name },
      });
      setEditing(null);
      const n = r.expenses_updated;
      return n === 0
        ? `Η κατηγορία μετονομάστηκε σε «${r.category.name}»`
        : `Η κατηγορία μετονομάστηκε σε «${r.category.name}» (άλλαξε και σε ${n} ${n === 1 ? 'έξοδο' : 'έξοδα'})`;
    });
  }

  function remove(c: Category) {
    if (!confirm(`Να αφαιρεθεί η κατηγορία «${c.name}» από τη λίστα; Τα έξοδα που την έχουν ήδη θα την κρατήσουν.`)) return;
    run(async () => {
      await api(`/groups/${group.id}/categories/${c.id}`, { method: 'DELETE' });
      return `Η κατηγορία «${c.name}» αφαιρέθηκε`;
    });
  }

  return (
    <section className="card stack">
      <h2>Κατηγορίες εξόδων ({categories.length})</h2>
      <p className="muted small">
        Αυτές εμφανίζονται στη φόρμα εξόδου για όλα τα μέλη. Η μετονομασία αλλάζει την κατηγορία και στα έξοδα που την έχουν
        ήδη. Η αφαίρεση την κρύβει από τα νέα έξοδα, τα παλιά δεν αλλάζουν.
      </p>
      <ErrorBox error={error} />
      <SuccessBox message={ok} />

      {categories.length === 0 ? (
        <p className="muted">Δεν υπάρχουν κατηγορίες. Προσθέστε την πρώτη παρακάτω.</p>
      ) : (
        <ul className="list plain">
          {categories.map((c) =>
            editing?.id === c.id ? (
              <li key={c.id}>
                <form onSubmit={rename} className="list-item static">
                  <div className="list-main">
                    <input
                      required
                      autoFocus
                      maxLength={MAX_LENGTH}
                      aria-label={`Νέο όνομα για την κατηγορία ${c.name}`}
                      value={editing.name}
                      onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                      onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                    />
                  </div>
                  <div className="row gap">
                    <button className="btn btn-small btn-primary" disabled={busy || !editing.name.trim()}>
                      Αποθήκευση
                    </button>
                    <button type="button" className="btn btn-small" disabled={busy} onClick={() => setEditing(null)}>
                      Άκυρο
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={c.id} className="list-item static">
                <div className="list-main">
                  <div className="list-title">{c.name}</div>
                </div>
                <div className="row gap">
                  <button className="btn btn-small" disabled={busy} onClick={() => setEditing({ id: c.id, name: c.name })}>
                    Μετονομασία
                  </button>
                  <button className="btn btn-small" disabled={busy} onClick={() => remove(c)}>
                    Αφαίρεση
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <form onSubmit={add} className="row gap wrap align-end">
        <Field label="Νέα κατηγορία">
          <input maxLength={MAX_LENGTH} required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="π.χ. Κατοικίδια" />
        </Field>
        <button className="btn" disabled={busy || !newName.trim()}>
          Προσθήκη
        </button>
      </form>
    </section>
  );
}
