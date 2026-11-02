import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../api';
import { deltaPercent, money, monthLabel, monthShort } from '../format';
import type { Group, Member, MonthStats } from '../types';
import { Empty, ErrorBox, Spinner } from './ui';

interface Props {
  group: Group;
  members: Member[];
  currentUserId: number;
  version: number;
}

/** Months shown in the chart (the selected one and the ones before it). */
const CHART_MONTHS = 12;
/** Months that make the "average" the selected month is compared with. */
const AVERAGE_MONTHS = 6;

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Fills the months without expenses between the first and the last, so comparisons and the chart see gaps as 0. */
function contiguous(months: MonthStats[]): MonthStats[] {
  if (months.length === 0) return [];
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const asc = [...byMonth.keys()].sort();
  const out: MonthStats[] = [];
  for (let m = asc[0]; m <= asc[asc.length - 1]; m = nextMonth(m)) {
    out.push(byMonth.get(m) ?? { month: m, count: 0, total: 0, by_category: [], by_member: [] });
  }
  return out.reverse(); // newest first, like the API
}

export function StatsTab({ group, members, currentUserId, version }: Props) {
  const [raw, setRaw] = useState<MonthStats[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ months: MonthStats[] }>(`/groups/${group.id}/expenses/months`)
      .then((r) => {
        setRaw(r.months);
        setSelected((s) => (s && r.months.some((m) => m.month === s) ? s : (r.months[0]?.month ?? null)));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [group.id, version]);

  const months = useMemo(() => contiguous(raw ?? []), [raw]);

  if (error) return <ErrorBox error={error} />;
  if (raw === null) return <Spinner />;
  if (months.length === 0 || !selected) return <Empty title="Δεν υπάρχουν έξοδα για στατιστικά ακόμη" />;

  const idx = months.findIndex((m) => m.month === selected);
  const current = months[idx];
  const previous = months[idx + 1] ?? null;
  const baseline = months.slice(idx + 1, idx + 1 + AVERAGE_MONTHS);
  const average = baseline.length ? baseline.reduce((s, m) => s + m.total, 0) / baseline.length : null;
  const chartMonths = months.slice(idx, idx + CHART_MONTHS).reverse(); // oldest → newest for drawing
  const currency = group.currency;
  const nameOf = (id: number) => members.find((m) => m.user_id === id)?.name ?? `#${id}`;

  // categories of the selected month next to the previous one
  const catKey = (c: string | null) => c ?? '';
  const prevCats = new Map((previous?.by_category ?? []).map((c) => [catKey(c.category), c.total]));
  const categories = [
    ...current.by_category.map((c) => ({ category: c.category, count: c.count, total: c.total, previous: prevCats.get(catKey(c.category)) ?? 0 })),
    ...(previous?.by_category ?? [])
      .filter((c) => !current.by_category.some((x) => catKey(x.category) === catKey(c.category)))
      .map((c) => ({ category: c.category, count: 0, total: 0, previous: c.total })),
  ].sort((a, b) => b.total - a.total || b.previous - a.previous);

  return (
    <div className="stack">
      <div className="row between wrap">
        <h2>{monthLabel(current.month)}</h2>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Μήνας">
          {months.map((m) => (
            <option key={m.month} value={m.month}>
              {monthLabel(m.month)}
            </option>
          ))}
        </select>
      </div>

      <div className="stat-grid">
        <Tile label="Σύνολο μήνα" value={money(current.total, currency)} sub={`${current.count} έξοδα`} />
        <Tile
          label={previous ? `Σε σχέση με ${monthShort(previous.month)}` : 'Προηγούμενος μήνας'}
          value={previous ? <Delta current={current.total} previous={previous.total} currency={currency} /> : '—'}
          sub={previous ? `${monthShort(previous.month)}: ${money(previous.total, currency)}` : 'δεν υπάρχει'}
        />
        <Tile
          label={`Σε σχέση με μ.ό. ${baseline.length} μηνών`}
          value={average !== null ? <Delta current={current.total} previous={average} currency={currency} /> : '—'}
          sub={average !== null ? `μ.ό.: ${money(average, currency)}` : 'δεν υπάρχει'}
        />
        <Tile
          label="Μέσο έξοδο"
          value={current.count ? money(current.total / current.count, currency) : '—'}
          sub={previous?.count ? `${monthShort(previous.month)}: ${money(previous.total / previous.count, currency)}` : ''}
        />
      </div>

      <section className="card stack">
        <h2>Ανά μήνα</h2>
        <BarChart months={chartMonths} selected={selected} average={average} currency={currency} onSelect={setSelected} />
        <ChartCaption average={average} currency={currency} />
      </section>

      <section className="card stack">
        <h2>Ανά κατηγορία</h2>
        {categories.length === 0 ? (
          <p className="muted">Χωρίς έξοδα αυτόν τον μήνα.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Κατηγορία</th>
                <th className="num">{monthShort(current.month)}</th>
                {previous && <th className="num">{monthShort(previous.month)}</th>}
                {previous && <th className="num">Διαφορά</th>}
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={catKey(c.category)}>
                  <td>
                    {c.category ?? <span className="muted">Χωρίς κατηγορία</span>}
                    {c.count > 0 && <span className="muted small"> · {c.count}</span>}
                  </td>
                  <td className="num">{money(c.total, currency)}</td>
                  {previous && <td className="num muted">{money(c.previous, currency)}</td>}
                  {previous && (
                    <td className="num">
                      <Delta current={c.total} previous={c.previous} currency={currency} compact />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card stack">
        <h2>Ανά μέλος</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Μέλος</th>
              <th className="num">Πλήρωσε</th>
              <th className="num">Αναλογία</th>
              <th className="num">Διαφορά</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const row = current.by_member.find((x) => x.user_id === m.user_id) ?? { paid: 0, share: 0 };
              const net = row.paid - row.share;
              return (
                <tr key={m.user_id}>
                  <td>
                    {m.name}
                    {m.user_id === currentUserId && <span className="muted"> (εγώ)</span>}
                  </td>
                  <td className="num">{money(row.paid, currency)}</td>
                  <td className="num">{money(row.share, currency)}</td>
                  <td className={`num balance ${net > 0.004 ? 'pos' : net < -0.004 ? 'neg' : 'zero'}`}>
                    {net > 0.004 ? '+' : net < -0.004 ? '−' : ''}
                    {money(Math.abs(net), currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">Πληρωμές, διορθώσεις και μεταφορές χρεών δεν μετρούν εδώ, μόνο τα έξοδα του μήνα.</p>
      </section>

      <details className="card deleted-items">
        <summary>Όλοι οι μήνες ({months.length})</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Μήνας</th>
              <th className="num">Έξοδα</th>
              <th className="num">Σύνολο</th>
              <th className="num">Διαφορά</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => {
              const prev = months[i + 1];
              return (
                <tr key={m.month} className={m.month === selected ? 'selected' : undefined} onClick={() => setSelected(m.month)}>
                  <td>{monthLabel(m.month)}</td>
                  <td className="num">{m.count}</td>
                  <td className="num">{money(m.total, currency)}</td>
                  <td className="num">{prev ? <Delta current={m.total} previous={prev.total} currency={currency} compact /> : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub muted">{sub}</div>}
    </div>
  );
}

/** Spending went up → red, down → green. `compact` shows only the amount with its sign. */
function Delta({ current, previous, currency, compact = false }: { current: number; previous: number; currency: string; compact?: boolean }) {
  const diff = current - previous;
  if (Math.abs(diff) < 0.005) return <span className="delta zero">{compact ? '=' : 'ίδια'}</span>;
  const pct = deltaPercent(current, previous);
  const cls = diff > 0 ? 'delta up' : 'delta down';
  return (
    <span className={cls}>
      {diff > 0 ? '▲' : '▼'} {money(Math.abs(diff), currency)}
      {!compact && pct && <span className="small"> ({pct})</span>}
    </span>
  );
}

/**
 * One series of monthly totals. Thin bars with rounded tops, a dashed average line, hover tooltip,
 * tap to select a month. Colors come from the app tokens so light and dark both work.
 */
function BarChart({
  months,
  selected,
  average,
  currency,
  onSelect,
}: {
  months: MonthStats[];
  selected: string;
  average: number | null;
  currency: string;
  onSelect: (month: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { top: 16, right: 12, bottom: 28, left: 48 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = Math.max(1, ...months.map((m) => m.total), average ?? 0);
  // a "nice" top for the axis: 1, 2, 2.5, 5 × 10^n above the max
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= max) ?? max;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const slot = innerW / months.length;
  const barW = Math.max(6, Math.min(28, slot - 8));
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const fmtAxis = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));

  const barPath = (x: number, v: number) => {
    const yTop = y(v);
    const yBase = pad.top + innerH;
    const r = Math.min(4, barW / 2, Math.max(0, yBase - yTop));
    return `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yBase} Z`;
  };

  const tip = hover !== null ? months[hover] : null;

  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Σύνολο εξόδων ανά μήνα">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} />
            <text x={pad.left - 6} y={y(t) + 3} textAnchor="end">
              {fmtAxis(t)}
            </text>
          </g>
        ))}
        {average !== null && <line className="avg" x1={pad.left} x2={W - pad.right} y1={y(average)} y2={y(average)} />}
        {months.map((m, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          return (
            <g key={m.month}>
              <path className={`bar ${m.month === selected ? 'selected' : ''} ${hover === i ? 'hover' : ''}`} d={barPath(x, m.total)} />
              {/* hit target wider than the bar */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(m.month)}
              >
                <title>{`${monthLabel(m.month)}: ${money(m.total, currency)}`}</title>
              </rect>
              {(months.length <= 12 || i % 2 === 0) && (
                <text x={pad.left + i * slot + slot / 2} y={H - 10} textAnchor="middle">
                  {monthShort(m.month)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.left + hover * slot + slot / 2) / W) * 100}%`, top: `${(y(tip.total) / H) * 100}%` }}>
          <strong>{monthLabel(tip.month)}</strong>
          <br />
          {money(tip.total, currency)} · {tip.count} έξοδα
        </div>
      )}
    </div>
  );
}

function ChartCaption({ average, currency }: { average: number | null; currency: string }) {
  return (
    <>
      {average !== null && (
        <p className="muted small">
          Διακεκομμένη γραμμή: μέσος όρος των {AVERAGE_MONTHS} μηνών πριν από τον επιλεγμένο ({money(average, currency)}). Πατήστε μια μπάρα για να
          αλλάξετε μήνα.
        </p>
      )}
    </>
  );
}
