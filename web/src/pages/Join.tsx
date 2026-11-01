import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import type { Group } from '../types';
import { ErrorBox, Spinner } from '../components/ui';
import { AuthShell } from './AuthShell';

/** Landing page for invite links: /join?code=XXXX */
export default function Join() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = params.get('code') ?? '';
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError('Ο σύνδεσμος πρόσκλησης δεν περιέχει κωδικό');
      return;
    }
    api<{ group: Group }>('/groups/join', { method: 'POST', body: { code } })
      .then((r) => navigate(`/groups/${r.group.id}`, { replace: true }))
      .catch((err) => setError(errorMessage(err)));
  }, [code, navigate]);

  return (
    <AuthShell title="Συμμετοχή σε ομάδα">
      {error ? (
        <div className="stack">
          <ErrorBox error={error} />
          <Link className="btn btn-block" to="/">
            Πίσω στις ομάδες
          </Link>
        </div>
      ) : (
        <Spinner />
      )}
    </AuthShell>
  );
}
