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
