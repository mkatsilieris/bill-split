/**
 * Import of a Splitwise CSV export into one group.
 *
 * Runs either at API startup (IMPORT_SPLITWISE_* environment, see config.ts) or from the command
 * line (import-cli.ts). The parsing and the reconstruction of payer / shares live in lib/splitwise.ts;
 * this file maps the people of the file to members of the group and writes everything in one
 * transaction. An `imports` row records the file (sha256) so the same export is never applied twice,
 * and every expense / settlement carries its import_id so the import can be undone later:
 *
 *   UPDATE expenses    SET deleted_at = now() WHERE import_id = <id>;
 *   UPDATE settlements SET deleted_at = now() WHERE import_id = <id>;
 *   UPDATE imports     SET deleted_at = now() WHERE id = <id>;
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pool, withTransaction } from './db.js';
import { loadMembers, type MemberRow } from './lib/membership.js';
import { fromCents, splitByWeight, splitEqually } from './lib/money.js';
import { parseSplitwiseCsv, planImport, type ImportPlan } from './lib/splitwise.js';

export interface ImportOptions {
  /** path of the CSV export */
  file: string;
  /** group id or exact group name; may be omitted when there is exactly one group */
  group?: string;
  /** "Person in file=email, Other person=email"; omitted = match people to members by name / e-mail */
  users?: string;
  /** e-mail of the member recorded as creator of the rows; default: the group owner */
  by?: string;
  /** check and report, write nothing */
  dryRun?: boolean;
}

export interface ImportSummary {
  source: 'splitwise';
  dry_run: boolean;
  import_id: number | null;
  file: string;
  sha256: string;
  group: { id: number; name: string; split_mode: string; existing_expenses: number; existing_settlements: number };
  people: { name: string; user_id: number; email: string; user_name: string }[];
  created_by: { user_id: number; email: string };
  expenses: number;
  settlements: number;
  skipped: ImportPlan['skipped'];
  total_expenses: number;
  first_date: string | null;
  last_date: string | null;
  /** the balance the imported rows produce per person (positive = the others owe them) */
  balance: { name: string; user_id: number; net: number }[];
  /** the "Total balance" footer of the file, if any */
  file_total_balance: number[] | null;
  /** true when the imported rows reproduce the balances of the file exactly */
  consistent: boolean;
  split: { group_default: number; exact: number };
}

interface GroupInfo {
  id: number;
  name: string;
  split_mode: 'equal' | 'percentage';
  expenses: number;
  settlements: number;
  members: MemberRow[];
}

async function describeGroups(): Promise<GroupInfo[]> {
  const { rows } = await pool.query<Omit<GroupInfo, 'members'>>(
    `SELECT g.id, g.name, g.split_mode,
            (SELECT count(*)::int FROM expenses e WHERE e.group_id = g.id AND e.deleted_at IS NULL) AS expenses,
            (SELECT count(*)::int FROM settlements s WHERE s.group_id = g.id AND s.deleted_at IS NULL) AS settlements
       FROM groups g
      WHERE g.deleted_at IS NULL
      ORDER BY g.id`,
  );
  return Promise.all(rows.map(async (g) => ({ ...g, members: await loadMembers(g.id) })));
}

function memberLine(m: MemberRow): string {
  return `${m.name} <${m.email}>${m.role === 'owner' ? ' (owner)' : ''}`;
}

function groupLine(g: GroupInfo): string {
  return `#${g.id} "${g.name}" (${g.split_mode}, ${g.expenses} έξοδα, ${g.settlements} εξοφλήσεις): ${g.members.map(memberLine).join(', ') || 'χωρίς μέλη'}`;
}

function resolveGroup(groups: GroupInfo[], wanted: string | undefined): GroupInfo {
  const list = groups.map(groupLine).join(' | ') || 'καμία';
  if (wanted === undefined || wanted === '') {
    if (groups.length === 1) return groups[0];
    throw new Error(`Διάλεξε ομάδα (IMPORT_SPLITWISE_GROUP = id ή όνομα). Ομάδες: ${list}`);
  }
  const byId = /^\d+$/.test(wanted) ? groups.find((g) => g.id === Number(wanted)) : undefined;
  const byName = groups.filter((g) => g.name.trim().toLowerCase() === wanted.trim().toLowerCase());
  const group = byId ?? (byName.length === 1 ? byName[0] : undefined);
  if (!group) throw new Error(`Δεν βρέθηκε ομάδα "${wanted}". Ομάδες: ${list}`);
  return group;
}

/** "ninblack nib" ~ "ninblack.nib" ~ "Ninblack Nib": letters and digits only, no accents, lower case */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function parseUserMapping(spec: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (spec ?? '').split(/[,;]/)) {
    if (!part.trim()) continue;
    const eq = part.indexOf('=');
    if (eq < 0) throw new Error(`Μη έγκυρη αντιστοίχιση "${part.trim()}" (αναμένεται "Όνομα στο αρχείο=email")`);
    map.set(normalizeName(part.slice(0, eq)), part.slice(eq + 1).trim().toLowerCase());
  }
  return map;
}

/** Maps every person column of the file to a current member of the group. */
function resolvePeople(people: string[], members: MemberRow[], spec: string | undefined): MemberRow[] {
  const explicit = parseUserMapping(spec);
  const memberList = members.map(memberLine).join(', ');
  const result: MemberRow[] = [];
  for (const person of people) {
    const key = normalizeName(person);
    let match: MemberRow | undefined;
    if (explicit.has(key)) {
      const email = explicit.get(key)!;
      match = members.find((m) => m.email.toLowerCase() === email);
      if (!match) throw new Error(`Το "${person}" αντιστοιχίστηκε στο ${email}, που δεν είναι μέλος της ομάδας. Μέλη: ${memberList}`);
    } else {
      const candidates = members.filter(
        (m) => normalizeName(m.name) === key || normalizeName(m.email.split('@')[0]) === key,
      );
      if (candidates.length !== 1) {
        throw new Error(
          `Δεν μπόρεσα να αντιστοιχίσω το "${person}" σε μέλος της ομάδας. Μέλη: ${memberList}. ` +
            `Δώσε IMPORT_SPLITWISE_USERS="${person}=email, ..."`,
        );
      }
      match = candidates[0];
    }
    if (result.includes(match)) throw new Error(`Δύο άτομα του αρχείου αντιστοιχούν στο ίδιο μέλος (${memberLine(match)})`);
    result.push(match);
  }
  return result;
}

function defaultShares(amountCents: number, group: GroupInfo): Map<number, number> {
  if (group.split_mode === 'percentage') {
    return splitByWeight(
      amountCents,
      group.members.map((m) => ({ userId: m.user_id, weight: m.share_percent ?? 0 })),
    );
  }
  return splitEqually(
    amountCents,
    group.members.map((m) => m.user_id),
  );
}

function sameShares(a: Map<number, number>, b: Map<number, number>): boolean {
  const az = [...a].filter(([, c]) => c > 0);
  const bz = [...b].filter(([, c]) => c > 0);
  return az.length === bz.length && az.every(([u, c]) => b.get(u) === c);
}

/** created_at inside the import: the day of the row at 12:00 UTC, later rows of the file later. */
function stamp(date: string, seq: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0) + seq * 1000);
}

export async function importSplitwise(opts: ImportOptions): Promise<ImportSummary> {
  const text = readFileSync(opts.file, 'utf8');
  const sha256 = createHash('sha256').update(text).digest('hex');
  const plan = planImport(parseSplitwiseCsv(text));

  const group = resolveGroup(await describeGroups(), opts.group);
  const people = resolvePeople(plan.people, group.members, opts.users);
  const userIds = people.map((m) => m.user_id);

  let creator: MemberRow | undefined;
  if (opts.by) {
    creator = group.members.find((m) => m.email.toLowerCase() === opts.by!.trim().toLowerCase());
    if (!creator) throw new Error(`Ο ${opts.by} δεν είναι μέλος της ομάδας "${group.name}"`);
  } else {
    creator = group.members.find((m) => m.role === 'owner') ?? group.members[0];
  }
  if (!creator) throw new Error(`Η ομάδα "${group.name}" δεν έχει μέλη`);

  const previous = await pool.query<{ id: number; created_at: Date }>(
    'SELECT id, created_at FROM imports WHERE group_id = $1 AND file_sha256 = $2 AND deleted_at IS NULL',
    [group.id, sha256],
  );
  if (previous.rows[0]) {
    throw new Error(
      `Το ίδιο αρχείο έχει ήδη εισαχθεί στην ομάδα "${group.name}" (import #${previous.rows[0].id}, ${previous.rows[0].created_at.toISOString()})`,
    );
  }

  // Shares in user ids; an expense that matches the group's default split is stored as such
  const expenses = plan.expenses.map((e) => {
    const shares = new Map<number, number>();
    for (const [person, cents] of e.shares) shares.set(userIds[person], cents);
    const splitType = sameShares(shares, defaultShares(e.amountCents, group)) ? 'group' : 'exact';
    return { ...e, shares, splitType, paidByUser: userIds[e.paidBy] };
  });
  const groupDefault = expenses.filter((e) => e.splitType === 'group').length;

  const footer = plan.totalBalanceCents ?? null;
  const consistent =
    plan.plannedNetCents.every((c, i) => c === plan.fileNetCents[i]) &&
    (footer === null || footer.every((c, i) => c === plan.plannedNetCents[i]));

  const summary: ImportSummary = {
    source: 'splitwise',
    dry_run: Boolean(opts.dryRun),
    import_id: null,
    file: basename(opts.file),
    sha256,
    group: {
      id: group.id,
      name: group.name,
      split_mode: group.split_mode,
      existing_expenses: group.expenses,
      existing_settlements: group.settlements,
    },
    people: plan.people.map((name, i) => ({
      name,
      user_id: people[i].user_id,
      email: people[i].email,
      user_name: people[i].name,
    })),
    created_by: { user_id: creator.user_id, email: creator.email },
    expenses: expenses.length,
    settlements: plan.settlements.length,
    skipped: plan.skipped,
    total_expenses: fromCents(expenses.reduce((s, e) => s + e.amountCents, 0)),
    first_date: plan.firstDate,
    last_date: plan.lastDate,
    balance: plan.people.map((name, i) => ({ name, user_id: userIds[i], net: fromCents(plan.plannedNetCents[i]) })),
    file_total_balance: footer ? footer.map(fromCents) : null,
    consistent,
    split: { group_default: groupDefault, exact: expenses.length - groupDefault },
  };
  if (opts.dryRun) return summary;

  summary.import_id = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO imports (group_id, source, file_name, file_sha256, created_by, summary)
       VALUES ($1, 'splitwise', $2, $3, $4, $5) RETURNING id`,
      [group.id, summary.file, sha256, creator.user_id, JSON.stringify(summary)],
    );
    const importId = rows[0].id;
    let seq = 0;
    for (const e of expenses) {
      const inserted = await tx.query<{ id: number }>(
        `INSERT INTO expenses (group_id, paid_by, description, amount, category, spent_at, split_type, created_by, created_at, import_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          group.id,
          e.paidByUser,
          e.description,
          fromCents(e.amountCents),
          e.category,
          e.date,
          e.splitType,
          creator.user_id,
          stamp(e.date, seq++),
          importId,
        ],
      );
      const shares = [...e.shares];
      await tx.query(
        `INSERT INTO expense_shares (expense_id, user_id, amount)
         SELECT $1, u, a FROM unnest($2::int[], $3::numeric[]) AS t(u, a)`,
        [inserted.rows[0].id, shares.map(([u]) => u), shares.map(([, c]) => fromCents(c))],
      );
    }
    for (const s of plan.settlements) {
      await tx.query(
        `INSERT INTO settlements (group_id, from_user, to_user, amount, note, settled_at, created_by, created_at, import_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          group.id,
          userIds[s.fromPerson],
          userIds[s.toPerson],
          fromCents(s.amountCents),
          s.note,
          s.date,
          creator.user_id,
          stamp(s.date, seq++),
          importId,
        ],
      );
    }
    return importId;
  });
  return summary;
}
