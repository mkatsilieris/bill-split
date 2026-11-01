import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, Spinner, SuccessBox } from '../components/ui';

interface AllowlistResponse {
  emails: string[];
  mail_configured: boolean;
}

/** Who may open the app from the Internet: the e-mail allowlist of the Cloudflare Access policy. */
export default function Admin() {
  const { user } = useAuth();
  const [emails, setEmails] = useState<string[] | null>(null);
  const [mailConfigured, setMailConfigured] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<AllowlistResponse>('/admin/allowlist')
      .then((r) => {
        setEmails(r.emails);
        setMailConfigured(r.mail_configured);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    setInvitation(null);
    try {
      const r = await api<{ emails: string[]; mail_sent: boolean; invitation_text: string }>('/admin/allowlist', {
        method: 'POST',
        body: { email: newEmail },
      });
      setEmails(r.emails);
      setNewEmail('');
      if (r.mail_sent) {
        setOk(`Προστέθηκε και στάλθηκε email πρόσκλησης στο ${newEmail.trim().toLowerCase()}`);
      } else {
        setOk('Προστέθηκε. Δεν στάλθηκε email (δεν υπάρχει SMTP στον server), στείλτε το παρακάτω μήνυμα εσείς:');
        setInvitation(r.invitation_text);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(email: string) {
    if (!window.confirm(`Να αφαιρεθεί το ${email}; Δεν θα μπορεί πια να ανοίξει την εφαρμογή από το Internet.`)) return;
    setBusy(true);
    setError(null);
    setOk(null);
    setInvitation(null);
    try {
      const r = await api<{ emails: string[]; revoked: boolean }>(`/admin/allowlist/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      setEmails(r.emails);
      setOk(
        r.revoked
          ? `Το ${email} αφαιρέθηκε και η σύνδεσή του τερματίστηκε`
          : `Το ${email} αφαιρέθηκε. Αν είναι ήδη συνδεδεμένο, η σύνδεσή του λήγει μόνη της μέσα σε 30 ημέρες.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitation() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation);
      setOk('Το μήνυμα αντιγράφηκε');
    } catch {
      /* clipboard unavailable: the text is visible below anyway */
    }
  }

  return (
    <div className="page narrow">
      <div className="page-header">
        <h1>Πρόσβαση από το Internet</h1>
      </div>
      <p className="muted">
        Μόνο αυτά τα email μπορούν να ανοίξουν την εφαρμογή από το Internet. Κάθε νέο μέλος συνδέεται με κωδικό μίας
        χρήσης που λαμβάνει στο email του, χωρίς εγγραφή.
      </p>
      <ErrorBox error={error} />
      <SuccessBox message={ok} />
      {invitation && (
        <section className="card stack">
          <pre className="invite-box" style={{ whiteSpace: 'pre-wrap' }}>
            {invitation}
          </pre>
          <button className="btn" onClick={copyInvitation}>
            Αντιγραφή μηνύματος
          </button>
        </section>
      )}

      <section className="card stack">
        <h2>Προσθήκη μέλους</h2>
        <form onSubmit={add} className="stack">
          <Field
            label="Email"
            hint={
              mailConfigured
                ? 'Θα λάβει email με οδηγίες σύνδεσης'
                : 'Δεν υπάρχει SMTP: θα σας δοθεί το μήνυμα για να το στείλετε εσείς'
            }
          >
            <input
              type="email"
              autoComplete="off"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </Field>
          <button className="btn btn-primary" disabled={busy || !newEmail}>
            {busy ? 'Προσθήκη…' : 'Προσθήκη'}
          </button>
        </form>
      </section>

      <section className="card stack">
        <h2>Μέλη με πρόσβαση</h2>
        {emails === null ? (
          <Spinner />
        ) : (
          <ul className="list">
            {emails.map((email) => (
              <li key={email} className="list-item">
                <div className="list-main">
                  <div className="list-title">{email}</div>
                  {email === user?.email && <div className="muted small">εσείς</div>}
                </div>
                {email !== user?.email && (
                  <button className="btn btn-small btn-danger" disabled={busy} onClick={() => remove(email)}>
                    Αφαίρεση
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
