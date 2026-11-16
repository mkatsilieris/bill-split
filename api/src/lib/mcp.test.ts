import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, type McpContext } from '../mcp/protocol.js';
import { ToolError, isDay, keptSplit, todayIn, tools, type ApiCall } from '../mcp/tools.js';

type Call = { method: string; path: string; body: unknown };
function ctx(scope: 'read' | 'write', answer: (c: Call) => unknown = () => ({})): McpContext & { calls: Call[] } {
  const calls: Call[] = [];
  const api: ApiCall = async (method, path, body) => {
    calls.push({ method, path, body });
    return answer({ method, path, body });
  };
  return { scope, api, calls };
}
const rpc = (method: string, params?: unknown, id: number | undefined = 1) => ({ jsonrpc: '2.0', id, method, params });
const result = (r: any) => r.result;
const call = (name: string, args: unknown, c: McpContext) => handleMessage(rpc('tools/call', { name, arguments: args }), c).then(result);

test('initialize answers with a protocol version the client knows, and tools only', async () => {
  const r = result(await handleMessage(rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} }), ctx('write')));
  assert.equal(r.protocolVersion, '2025-03-26');
  assert.deepEqual(Object.keys(r.capabilities), ['tools']);
  assert.equal(r.serverInfo.name, 'bill-split');
  const unknown = result(await handleMessage(rpc('initialize', { protocolVersion: '1999-01-01' }), ctx('write')));
  assert.equal(unknown.protocolVersion, '2025-06-18');
});

test('notifications get no answer; bad messages and unknown methods get JSON-RPC errors', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx('write')), null);
  assert.equal(((await handleMessage({ hello: 1 }, ctx('write'))) as any).error.code, -32600);
  assert.equal(((await handleMessage(rpc('resources/list'), ctx('write'))) as any).error.code, -32601);
  assert.deepEqual(result(await handleMessage(rpc('ping'), ctx('write'))), {});
});

test('every tool has a unique name, an object schema, and says whether it changes data', async () => {
  const list = result(await handleMessage(rpc('tools/list'), ctx('write'))).tools;
  assert.equal(list.length, tools.length);
  assert.equal(new Set(list.map((t: any) => t.name)).size, list.length);
  for (const t of list) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(t.description.length > 20, t.name);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name);
  }
});

test('a tool that looks only sends GET, so the route would let a read token through', async () => {
  for (const tool of tools.filter((t) => !t.write)) {
    const c = ctx('read', () => ({ user: { id: 1 }, months: [] }));
    await tool.run({ group_id: 1, expense_id: 2, debtor: 3, creditor: 4, kind: 'expense', limit: 50, offset: 0, last_months: 12 }, c.api);
    assert.ok(c.calls.length > 0, tool.name);
    assert.ok(c.calls.every((x) => x.method === 'GET'), tool.name);
  }
});

test('a read-only token sees and can call only the tools that look', async () => {
  const c = ctx('read');
  const list = result(await handleMessage(rpc('tools/list'), c)).tools;
  assert.ok(list.length > 0);
  assert.ok(list.every((t: any) => t.annotations.readOnlyHint));
  const r = await call('add_expense', { group_id: 1, description: 'x', amount: 1 }, c);
  assert.ok(r.isError);
  assert.match(r.content[0].text, /read-only/);
  assert.equal(c.calls.length, 0);
});

test('add_expense fills in who paid, today and the group split, and goes through the expenses route', async () => {
  const c = ctx('write', ({ path }) => (path === '/auth/me' ? { user: { id: 7 } } : { expense: { id: 31 } }));
  const r = await call('add_expense', { group_id: 3, description: 'Σούπερ μάρκετ', amount: 42.5 }, c);
  assert.ok(!r.isError);
  assert.deepEqual(JSON.parse(r.content[0].text), { expense: { id: 31 } });
  const { method, path, body } = c.calls[1] as { method: string; path: string; body: any };
  assert.deepEqual([method, path], ['POST', '/groups/3/expenses']);
  assert.match(body.spent_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual([body.description, body.amount, body.paid_by, body.category, body.split], ['Σούπερ μάρκετ', 42.5, 7, null, { type: 'group' }]);

  const given = ctx('write');
  await call('add_expense', { group_id: 3, description: 'x', amount: 10, paid_by: 9, split: { type: 'equal', shares: [{ user_id: 9 }, { user_id: 7 }] } }, given);
  assert.equal(given.calls.length, 1, 'no lookup of the account when paid_by is given');
  assert.equal((given.calls[0].body as any).paid_by, 9);
});

test('wrong or unknown arguments come back as a tool error and reach no route', async () => {
  const c = ctx('write');
  const bad = [
    { group_id: 1, description: 'x', amount: -5 },
    { group_id: 1, description: 'x', amount: 10, colour: 'red' },
    { group_id: 1, description: 'x', amount: 10, spent_at: '2026-02-31' },
    { group_id: 0, description: 'x', amount: 10 },
    {},
  ];
  for (const args of bad) {
    const r = await call('add_expense', args, c);
    assert.ok(r.isError, JSON.stringify(args));
    assert.match(r.content[0].text, /Invalid arguments/);
  }
  assert.equal(c.calls.length, 0);
  assert.ok((await call('nope', {}, c)).isError);
});

test('a refusal of the route is passed on as the tool error; a crash is an internal error without details', async () => {
  const refuse = ctx('write', () => {
    throw new ToolError('Δεν είστε μέλος αυτής της ομάδας');
  });
  const r = await call('get_balances', { group_id: 99 }, refuse);
  assert.ok(r.isError);
  assert.equal(r.content[0].text, 'Δεν είστε μέλος αυτής της ομάδας');

  const crash = ctx('write', () => {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
  });
  const e = (await handleMessage(rpc('tools/call', { name: 'list_groups', arguments: {} }), crash)) as any;
  assert.deepEqual(e.error, { code: -32603, message: 'Internal error' });
});

test('update_expense sends back what stays, including the way the expense was split', async () => {
  const saved = {
    id: 5,
    description: 'Ρεύμα',
    amount: 90,
    paid_by: 1,
    category: 'Λογαριασμοί',
    spent_at: '2026-11-02',
    split_type: 'equal',
    shares: [
      { user_id: 1, amount: 45 },
      { user_id: 2, amount: 45 },
    ],
  };
  const c = ctx('write', () => ({ expense: saved }));
  await call('update_expense', { group_id: 3, expense_id: 5, amount: 100, category: null }, c);
  assert.deepEqual(c.calls[0], { method: 'GET', path: '/groups/3/expenses/5', body: undefined });
  assert.deepEqual(c.calls[1], {
    method: 'PUT',
    path: '/groups/3/expenses/5',
    body: { description: 'Ρεύμα', amount: 100, paid_by: 1, spent_at: '2026-11-02', category: null, split: { type: 'equal', shares: [{ user_id: 1 }, { user_id: 2 }] } },
  });
});

test('the kept split: group stays group, exact needs new amounts when the total changes, percents sum to 100', () => {
  const base = { description: 'x', paid_by: 1, category: null, spent_at: '2026-01-01' };
  assert.deepEqual(keptSplit({ ...base, amount: 10, split_type: 'group', shares: [{ user_id: 1, amount: 10 }] }, 20), { type: 'group' });

  const exact = { ...base, amount: 10, split_type: 'exact' as const, shares: [{ user_id: 1, amount: 7 }, { user_id: 2, amount: 3 }] };
  assert.deepEqual(keptSplit(exact, 10), { type: 'exact', shares: [{ user_id: 1, value: 7 }, { user_id: 2, value: 3 }] });
  assert.throws(() => keptSplit(exact, 12), ToolError);

  const thirds = { ...base, amount: 100, split_type: 'percentage' as const, shares: [1, 2, 3].map((u) => ({ user_id: u, amount: u === 1 ? 33.34 : 33.33 })) };
  const kept = keptSplit(thirds, 250);
  assert.equal(kept.type, 'percentage');
  assert.equal(Math.round(kept.shares!.reduce((s, x) => s + (x.value ?? 0), 0) * 100), 10000);
});

test('list_expenses turns the filters into the query of the route', async () => {
  const c = ctx('read');
  await call('list_expenses', { group_id: 2, month: '2026-10', query: 'σουπερ', categories: ['Φαγητό'], without_category: true, limit: 20 }, c);
  const url = new URL(`http://x${c.calls[0].path}`);
  assert.equal(url.pathname, '/groups/2/expenses');
  assert.deepEqual(Object.fromEntries(url.searchParams), { month: '2026-10', q: 'σουπερ', categories: 'Φαγητό,_none', limit: '20', offset: '0' });
});

test('deleted items: the group kind needs no group, the others do', async () => {
  const c = ctx('write');
  await call('list_deleted', { kind: 'group' }, c);
  await call('restore_deleted', { kind: 'debt_change', group_id: 4, id: 9 }, c);
  assert.deepEqual(c.calls.map((x) => `${x.method} ${x.path}`), ['GET /groups/deleted', 'POST /groups/4/debt-changes/9/restore']);
  const r = await call('list_deleted', { kind: 'expense' }, c);
  assert.ok(r.isError);
  assert.match(r.content[0].text, /group_id/);
});

test('get_monthly_stats keeps only the latest months asked for', async () => {
  const months = Array.from({ length: 30 }, (_, i) => ({ month: i }));
  const c = ctx('read', () => ({ months }));
  const r = JSON.parse((await call('get_monthly_stats', { group_id: 1, last_months: 3 }, c)).content[0].text);
  assert.deepEqual(r.months.map((m: any) => m.month), [0, 1, 2]);
});

test('calendar days', () => {
  assert.ok(isDay('2026-02-28'));
  assert.ok(!isDay('2026-02-31'));
  assert.ok(!isDay('26-2-1'));
  assert.equal(todayIn('Europe/Athens', new Date('2026-11-15T22:30:00Z')), '2026-11-16');
  assert.equal(todayIn('UTC', new Date('2026-11-15T22:30:00Z')), '2026-11-15');
});
