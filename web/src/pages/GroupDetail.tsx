import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import type { Group, Member, Role } from '../types';
import { ErrorBox, Spinner } from '../components/ui';
import { ExpensesTab } from '../components/ExpensesTab';
import { BalancesTab } from '../components/BalancesTab';
import { MembersTab } from '../components/MembersTab';
import { StatsTab } from '../components/StatsTab';

export interface GroupData {
  group: Group;
  members: Member[];
  my_role: Role;
}

type Tab = 'expenses' | 'balances' | 'stats' | 'members';
const TABS: { key: Tab; label: string }[] = [
  { key: 'expenses', label: 'Έξοδα' },
  { key: 'balances', label: 'Υπόλοιπα' },
  { key: 'stats', label: 'Στατιστικά' },
  { key: 'members', label: 'Μέλη & ρυθμίσεις' },
];

export default function GroupDetail() {
  const { id } = useParams();
  const groupId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'expenses';
  const [data, setData] = useState<GroupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // bumped after any mutation so that every tab reloads its data
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => {
    setVersion((v) => v + 1);
    return api<GroupData>(`/groups/${groupId}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)));
  }, [groupId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) {
    return (
      <div className="page">
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!data || !user) return <Spinner />;

  const { group, members, my_role } = data;
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  return (
    <div className="page">
      <div className="group-head">
        <div>
          <h1>{group.name}</h1>
          {group.description && <p className="muted">{group.description}</p>}
        </div>
        <span className="chip">{group.split_mode === 'equal' ? 'Ίσα μέρη' : 'Ποσοστά'}</span>
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'expenses' && (
        <ExpensesTab group={group} members={members} currentUserId={user.id} version={version} onChanged={reload} />
      )}
      {tab === 'balances' && (
        <BalancesTab group={group} members={members} currentUserId={user.id} version={version} onChanged={reload} />
      )}
      {tab === 'stats' && <StatsTab group={group} members={members} currentUserId={user.id} version={version} />}
      {tab === 'members' && (
        <MembersTab
          group={group}
          members={members}
          myRole={my_role}
          currentUserId={user.id}
          onChanged={reload}
          onLeft={() => navigate('/')}
        />
      )}
    </div>
  );
}
