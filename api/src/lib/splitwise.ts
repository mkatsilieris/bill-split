/**
 * Splitwise CSV export → import plan. Pure functions, no database.
 *
 * The export has one line per expense or payment:
 *
 *   Date,Description,Category,Cost,Currency,<Person A>,<Person B>,...
 *   2024-02-25,Εκδρομή,General,258.00,EUR,129.00,-129.00
 *   2024-02-25,A paid B,Payment,200.00,EUR,-200.00,200.00
 *   ...
 *   2026-11-02,Total balance, , ,EUR,-495.45,495.45
 *
 * Each person column is that person's balance change for the line: what they paid minus their
 * share. A positive number = the others owe them. Splitwise does not export who paid or the exact
 * shares, so we reconstruct the only single-payer expense that produces the same balances: the
 * person with the positive column paid everything, each negative column is that person's share,
 * and the payer keeps the rest. For a payment line the person with the positive column paid the
 * one with the negative column.
 */

export interface SplitwiseRow {
  /** 1-based line number in the file, for messages */
  line: number;
  date: string; // YYYY-MM-DD
  description: string;
  category: string;
  costCents: number;
  currency: string;
  /** balance change per person, in cents, same order as `people` */
  netCents: number[];
}

export interface SplitwiseExport {
  people: string[];
  rows: SplitwiseRow[];
  /** the "Total balance" footer, if present (cents per person) */
  totalBalanceCents?: number[];
}

export interface PlannedExpense {
  line: number;
  date: string;
  description: string;
  /** app category (see CATEGORY_MAP), null = none */
  category: string | null;
  sourceCategory: string;
  amountCents: number;
  /** index into people */
  paidBy: number;
  /** person index → share in cents (only non-zero shares) */
  shares: Map<number, number>;
}

export interface PlannedSettlement {
  line: number;
  date: string;
  note: string;
  amountCents: number;
  fromPerson: number;
  toPerson: number;
}

export interface SkippedRow {
  line: number;
  description: string;
  reason: string;
}

export interface ImportPlan {
  people: string[];
  currency: string | null;
  expenses: PlannedExpense[];
  settlements: PlannedSettlement[];
  skipped: SkippedRow[];
  /** per person: the balance the planned rows produce (paid - owed + settled out - settled in) */
  plannedNetCents: number[];
  /** per person: the sum of the file's columns over all rows (what Splitwise says) */
  fileNetCents: number[];
  totalBalanceCents?: number[];
  firstDate: string | null;
  lastDate: string | null;
}

/** Splitwise category → category of the app's expense form. Unknown ones become 'Άλλο'. */
export const CATEGORY_MAP: Record<string, string | null> = {
  General: null,
  Groceries: 'Σούπερ μάρκετ',
  'Household supplies': 'Σούπερ μάρκετ',
  'Dining out': 'Φαγητό',
  'Food and drink': 'Φαγητό',
  'Food and drink - Other': 'Φαγητό',
  Liquor: 'Φαγητό',
  Rent: 'Ενοίκιο',
  Mortgage: 'Ενοίκιο',
  Electricity: 'Λογαριασμοί',
  'Heat/gas': 'Λογαριασμοί',
  Water: 'Λογαριασμοί',
  Trash: 'Λογαριασμοί',
  'TV/Phone/Internet': 'Λογαριασμοί',
  'Utilities - Other': 'Λογαριασμοί',
  Taxi: 'Μεταφορικά',
  Parking: 'Μεταφορικά',
  Car: 'Μεταφορικά',
  'Gas/fuel': 'Μεταφορικά',
  'Bus/train': 'Μεταφορικά',
  Plane: 'Μεταφορικά',
  Bicycle: 'Μεταφορικά',
  'Transportation - Other': 'Μεταφορικά',
  Hotel: 'Διαμονή',
  Movies: 'Διασκέδαση',
  Games: 'Διασκέδαση',
  Music: 'Διασκέδαση',
  Sports: 'Διασκέδαση',
  'Entertainment - Other': 'Διασκέδαση',
  'Medical expenses': 'Υγεία',
  Childcare: 'Παιδιά',
  'Baby supplies': 'Παιδιά',
};

export function mapCategory(splitwiseCategory: string): string | null {
  const key = splitwiseCategory.trim();
  if (!key) return null;
  if (key in CATEGORY_MAP) return CATEGORY_MAP[key];
  return 'Άλλο';
}

/** Minimal RFC 4180 parser: commas, double quotes, doubled quotes inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseCents(raw: string, what: string, line: number): number {
  const s = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Γραμμή ${line}: μη έγκυρο ποσό για ${what}: "${raw}"`);
  return Math.round(Number(s) * 100);
}

export function parseSplitwiseCsv(text: string): SplitwiseExport {
  const lines = parseCsv(text);
  const header = lines[0]?.map((h) => h.trim());
  const expected = ['Date', 'Description', 'Category', 'Cost', 'Currency'];
  if (!header || expected.some((h, i) => header[i] !== h) || header.length < 6) {
    throw new Error('Δεν μοιάζει με export του Splitwise (αναμένεται Date,Description,Category,Cost,Currency,<άτομα>)');
  }
  const people = header.slice(5).filter((p) => p !== '');
  const rows: SplitwiseRow[] = [];
  let totalBalanceCents: number[] | undefined;

  for (let idx = 1; idx < lines.length; idx++) {
    const cells = lines[idx];
    const line = idx + 1;
    if (cells.every((c) => c.trim() === '')) continue;
    const [date, description, category, cost, currency, ...nets] = cells;
    if (description.trim() === 'Total balance') {
      totalBalanceCents = people.map((_, i) => parseCents(nets[i] ?? '0', 'υπόλοιπο', line));
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) throw new Error(`Γραμμή ${line}: μη έγκυρη ημερομηνία "${date}"`);
    if (nets.length < people.length) throw new Error(`Γραμμή ${line}: λείπουν στήλες ατόμων`);
    rows.push({
      line,
      date: date.trim(),
      description: description.trim(),
      category: category.trim(),
      costCents: parseCents(cost, 'κόστος', line),
      currency: currency.trim(),
      netCents: people.map((_, i) => parseCents(nets[i], people[i], line)),
    });
  }
  return { people, rows, totalBalanceCents };
}

export function planImport(data: SplitwiseExport): ImportPlan {
  const n = data.people.length;
  const expenses: PlannedExpense[] = [];
  const settlements: PlannedSettlement[] = [];
  const skipped: SkippedRow[] = [];
  const plannedNet = new Array<number>(n).fill(0);
  const fileNet = new Array<number>(n).fill(0);
  const currencies = new Set<string>();

  for (const row of data.rows) {
    row.netCents.forEach((c, i) => (fileNet[i] += c));
    if (row.currency) currencies.add(row.currency);
    const skip = (reason: string) => skipped.push({ line: row.line, description: row.description, reason });

    const sum = row.netCents.reduce((a, b) => a + b, 0);
    if (sum !== 0) {
      skip(`οι στήλες των ατόμων δεν αθροίζουν σε 0 (${(sum / 100).toFixed(2)})`);
      continue;
    }
    const positives = row.netCents.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
    const negatives = row.netCents.map((c, i) => (c < 0 ? i : -1)).filter((i) => i >= 0);
    if (positives.length === 0) {
      skip('κανένα υπόλοιπο δεν αλλάζει (όλα 0)');
      continue;
    }
    if (positives.length !== 1) {
      skip('πάνω από ένας πληρωτής, δεν αντιστοιχεί σε ένα έξοδο');
      continue;
    }
    const payer = positives[0];

    if (row.category === 'Payment') {
      if (negatives.length !== 1 || row.netCents[payer] !== row.costCents) {
        skip('πληρωμή που δεν είναι από ένα άτομο σε ένα άλλο για ολόκληρο το ποσό');
        continue;
      }
      settlements.push({
        line: row.line,
        date: row.date,
        note: row.description,
        amountCents: row.costCents,
        fromPerson: payer,
        toPerson: negatives[0],
      });
      plannedNet[payer] += row.costCents;
      plannedNet[negatives[0]] -= row.costCents;
      continue;
    }

    if (row.costCents <= 0) {
      skip('μηδενικό ή αρνητικό κόστος');
      continue;
    }
    const shares = new Map<number, number>();
    let owedByOthers = 0;
    for (const i of negatives) {
      shares.set(i, -row.netCents[i]);
      owedByOthers += -row.netCents[i];
    }
    const payerShare = row.costCents - owedByOthers;
    if (payerShare < 0) {
      skip('οι άλλοι χρωστούν περισσότερα από το κόστος');
      continue;
    }
    if (payerShare > 0) shares.set(payer, payerShare);
    expenses.push({
      line: row.line,
      date: row.date,
      description: row.description || '(χωρίς περιγραφή)',
      category: mapCategory(row.category),
      sourceCategory: row.category,
      amountCents: row.costCents,
      paidBy: payer,
      shares,
    });
    plannedNet[payer] += row.costCents;
    for (const [i, cents] of shares) plannedNet[i] -= cents;
  }

  const dates = data.rows.map((r) => r.date).sort();
  return {
    people: data.people,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    expenses,
    settlements,
    skipped,
    plannedNetCents: plannedNet,
    fileNetCents: fileNet,
    totalBalanceCents: data.totalBalanceCents,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
