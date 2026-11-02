import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { date, money, monthLabel } from '../format';
import type { Expense, Group, Member, MonthStats } from '../types';
import { Avatar, DeletedItems, Empty, ErrorBox, Spinner } from './ui';
import { ExpenseForm } from './ExpenseForm';

interface Props {
  group: Group;
  members: Member[];
  currentUserId: number;
  version: number;
  onChanged: () => void;
}

/** Expenses of a month are paged; this is the page size (the API allows up to 500). */
const PAGE = 100;
/** How many month sections are shown at first; "Περισσότεροι μήνες" reveals the next batch. */
const MONTHS_STEP = 6;

interface ExpenseList {
  expenses: Expense[];
  total: { count: number; amount: number };
}

interface MonthPage {
  expenses: Expense[];
  total: { count: number; amount: number };
  loading: boolean;
}

/**
 * The list grouped by month: the latest month is open, the others collapsed until tapped.
 * Each month loads its own expenses on demand and pages through them.
 */
export function ExpensesTab({ group, members, currentUserId, version, onChanged }: Props) {
  const [months, setMonths] = useState<MonthStats[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<Map<string, MonthPage>>(new Map());
  const [visibleMonths, setVisibleMonths] = useState(MONTHS_STEP);
  const [deleted, setDeleted] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  const setPage = useCallback((month: string, update: (p: MonthPage | undefined) => MonthPage) => {
    setPages((prev) => {
      const next = new Map(prev);
      next.set(month, update(prev.get(month)));
      return next;
    });
  }, []);

  /** Loads (or reloads) the first `limit` expenses of a month, or appends the next page. */
  const loadMonth = useCallback(
    async (month: string, mode: 'reload' | 'more', known?: MonthPage) => {
      const offset = mode === 'more' ? (known?.expenses.length ?? 0) : 0;
      const limit = mode === 'more' ? PAGE : Math.min(Math.max(known?.expenses.length ?? 0, PAGE), 500);
      setPage(month, (p) => ({ expenses: p?.expenses ?? [], total: p?.total ?? { count: 0, amount: 0 }, loading: true }));
      try {
        const page = await api<ExpenseList>(`/groups/${group.id}/expenses?month=${month}&limit=${limit}&offset=${offset}`);
        setPage(month, (p) => {
          const base = mode === 'more' ? (p?.expenses ?? []) : [];
          const ids = new Set(base.map((e) => e.id));
          return { expenses: [...base, ...page.expenses.filter((e) => !ids.has(e.id))], total: page.total, loading: false };
        });
      } catch (err) {
        setError(errorMessage(err));
        setPage(month, (p) => ({ expenses: p?.expenses ?? [], total: p?.total ?? { count: 0, amount: 0 }, loading: false }));
      }
    },
    [group.id, setPage],
  );

  // Mirrors of the state for the effect below, which must read the latest values without depending on them
  const expandedRef = useRef(expanded);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ months: MonthStats[] }>(`/groups/${group.id}/expenses/months`),
      api<ExpenseList>(`/groups/${group.id}/expenses/deleted?limit=500`),
    ])
      .then(([m, removed]) => {
        if (cancelled) return;
        setMonths(m.months);
        setDeleted(removed.expenses);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [group.id, version]);

  // Whenever the months arrive (first load or after a change): the latest month is open, months the
  // user had opened stay open, and every open month reloads with as many rows as it showed.
  useEffect(() => {
    if (!months) return;
    const existing = new Set(months.map((m) => m.month));
    const open = new Set([...expandedRef.current].filter((m) => existing.has(m)));
    if (months[0]) open.add(months[0].month);
    expandedRef.current = open;
    setExpanded(open);
    for (const month of open) void loadMonth(month, 'reload', pagesRef.current.get(month));
  }, [months, loadMonth]);

  function toggle(month: string) {
    const next = new Set(expandedRef.current);
    if (next.has(month)) next.delete(month);
    else {
      next.add(month);
      if (!pagesRef.current.get(month)) void loadMonth(month, 'reload');
    }
    expandedRef.current = next;
    setExpanded(next);
  }

  async function restore(e: Expense) {
    try {
      await api(`/groups/${group.id}/expenses/${e.id}/restore`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const totalAmount = months?.reduce((s, m) => s + m.total, 0) ?? 0;
  const totalCount = months?.reduce((s, m) => s + m.count, 0) ?? 0;

  return (
    <div className="stack">
      <div className="row between">
        <div className="muted">
          Σύνολο: <strong>{money(totalAmount, group.currency)}</strong>
          {totalCount > 0 && ` · ${totalCount} έξοδα`}
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + Έξοδο
        </button>
      </div>
      <ErrorBox error={error} />
      {months === null ? (
        <Spinner />
      ) : months.length === 0 ? (
        <Empty title="Δεν υπάρχουν έξοδα ακόμη">
          <p className="muted">Πατήστε «+ Έξοδο» για να καταχωρίσετε το πρώτο.</p>
        </Empty>
      ) : (
        <>
          {months.slice(0, visibleMonths).map((m) => {
            const mine = m.by_member.find((x) => x.user_id === currentUserId);
            const myNet = mine ? mine.paid - mine.share : 0;
            const open = expanded.has(m.month);
            const page = pages.get(m.month);
            return (
              <section key={m.month} className="month">
                <button className="month-head" aria-expanded={open} onClick={() => toggle(m.month)}>
                  <span className="chev" aria-hidden="true">
                    ▸
                  </span>
                  <span className="month-title">{monthLabel(m.month)}</span>
                  <span className="muted small">{m.count} έξοδα</span>
                  <span className="list-amount">
                    <span className="amount">{money(m.total, group.currency)}</span>
                    <span className={`small balance ${myNet > 0.004 ? 'pos' : myNet < -0.004 ? 'neg' : 'zero'}`}>
                      {myNet > 0.004 ? `+${money(myNet, group.currency)}` : myNet < -0.004 ? `-${money(-myNet, group.currency)}` : '±0'}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="month-body stack">
                    {!page || (page.loading && page.expenses.length === 0) ? (
                      <Spinner />
                    ) : (
                      <ul className="list">
                        {page.expenses.map((e) => (
                          <ExpenseRow key={e.id} expense={e} currency={group.currency} currentUserId={currentUserId} onOpen={() => setEditing(e)} />
                        ))}
                      </ul>
                    )}
                    {page && page.expenses.length < page.total.count && (
                      <button className="btn" disabled={page.loading} onClick={() => loadMonth(m.month, 'more', page)}>
                        {page.loading ? 'Φόρτωση…' : `Περισσότερα (${page.total.count - page.expenses.length} ακόμη)`}
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          {months.length > visibleMonths && (
            <button className="btn" onClick={() => setVisibleMonths((n) => n + MONTHS_STEP * 2)}>
              Περισσότεροι μήνες ({months.length - visibleMonths} ακόμη)
            </button>
          )}
        </>
      )}
      <DeletedItems
        items={deleted}
        label={(e) => (
          <>
            <div className="list-title">{e.description}</div>
            <div className="muted small">
              {date(e.spent_at)} · {money(e.amount, group.currency)}
            </div>
          </>
        )}
        onRestore={restore}
      />
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

function ExpenseRow({
  expense: e,
  currency,
  currentUserId,
  onOpen,
}: {
  expense: Expense;
  currency: string;
  currentUserId: number;
  onOpen: () => void;
}) {
  const myShare = e.shares.find((s) => s.user_id === currentUserId)?.amount ?? 0;
  const iPaid = e.paid_by === currentUserId;
  const myNet = (iPaid ? e.amount : 0) - myShare;
  return (
    <li>
      <button className="list-item" onClick={onOpen}>
        <Avatar name={e.paid_by_name} />
        <div className="list-main">
          <div className="list-title">{e.description}</div>
          <div className="muted small">
            {date(e.spent_at)} · πλήρωσε {iPaid ? 'εσείς' : e.paid_by_name}
            {e.category ? ` · ${e.category}` : ''}
          </div>
        </div>
        <div className="list-amount">
          <div className="amount">{money(e.amount, currency)}</div>
          <div className={`small balance ${myNet > 0.004 ? 'pos' : myNet < -0.004 ? 'neg' : 'zero'}`}>
            {myNet > 0.004 ? `+${money(myNet, currency)}` : myNet < -0.004 ? `-${money(-myNet, currency)}` : 'δεν σας αφορά'}
          </div>
        </div>
      </button>
    </li>
  );
}
