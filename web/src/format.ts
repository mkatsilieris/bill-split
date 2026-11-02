const formatters = new Map<string, Intl.NumberFormat>();

export function money(amount: number, currency = 'EUR'): string {
  let f = formatters.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat('el-GR', { style: 'currency', currency });
    } catch {
      f = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatters.set(currency, f);
  }
  return f.format(amount);
}

export function date(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function percent(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** 'YYYY-MM' → 'Νοέμβριος 2026' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });
}

/** 'YYYY-MM' → 'Νοε' (with the year when it is not the current one: 'Νοε 25') */
export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString('el-GR', { month: 'short' }).replace('.', '');
  return y === new Date().getFullYear() ? label : `${label} ${String(y).slice(2)}`;
}

/** Signed percentage change, e.g. '+12%' or '−8%'; null when there is no base to compare with. */
export function deltaPercent(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}
