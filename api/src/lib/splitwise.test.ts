import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCategory, parseCsv, parseSplitwiseCsv, planImport } from './splitwise.ts';

const sample = `Date,Description,Category,Cost,Currency,ninblack nib,Stavroula Papalouka

2022-08-23,Άγνωστες συναλλαγές ,General,117.00,EUR,117.00,-117.00
2022-08-26,Σούπερ μάρκετ ,Groceries,24.00,EUR,12.00,-12.00
2022-09-06,Κωστής ,General,200.00,EUR,-50.00,50.00
2023-02-19,Stavroula P. paid ninblack n.,Payment,300.00,EUR,-300.00,300.00
2024-02-03,Συναυλία ,General,51.00,EUR,34.17,-34.17
2025-04-04,"Leylim ley, krepa, neropistolo",Dining out,70.00,EUR,-35.00,35.00
2025-06-28,ninblack n. paid Stavroula P.,Payment,800.00,EUR,800.00,-800.00

2026-11-02,Total balance, , ,EUR,578.17,-578.17
`;

test('parseCsv handles quotes, embedded commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e""",f\r\n1,2,3,4\n'), [
    ['a', 'b, c', 'd "e"', 'f'],
    ['1', '2', '3', '4'],
  ]);
});

test('parseSplitwiseCsv reads people, rows and the footer', () => {
  const data = parseSplitwiseCsv(sample);
  assert.deepEqual(data.people, ['ninblack nib', 'Stavroula Papalouka']);
  assert.equal(data.rows.length, 7);
  assert.equal(data.rows[0].description, 'Άγνωστες συναλλαγές');
  assert.equal(data.rows[0].costCents, 11700);
  assert.deepEqual(data.rows[0].netCents, [11700, -11700]);
  assert.equal(data.rows[5].description, 'Leylim ley, krepa, neropistolo');
  assert.deepEqual(data.totalBalanceCents, [57817, -57817]);
});

test('parseSplitwiseCsv rejects other files', () => {
  assert.throws(() => parseSplitwiseCsv('id,amount\n1,2\n'), /Splitwise/);
});

test('planImport reconstructs payer and shares from the balance columns', () => {
  const plan = planImport(parseSplitwiseCsv(sample));
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.expenses.length, 5);
  assert.equal(plan.settlements.length, 2);

  // whole amount owed by the other person
  const unknown = plan.expenses[0];
  assert.equal(unknown.paidBy, 0);
  assert.deepEqual([...unknown.shares], [[1, 11700]]);

  // plain half-half
  const groceries = plan.expenses[1];
  assert.equal(groceries.category, 'Σούπερ μάρκετ');
  assert.deepEqual(new Map(groceries.shares), new Map([[0, 1200], [1, 1200]]));

  // the other person paid 200, we owe 50 → they keep 150
  const kostis = plan.expenses[2];
  assert.equal(kostis.paidBy, 1);
  assert.deepEqual(new Map(kostis.shares), new Map([[0, 5000], [1, 15000]]));

  // odd cents are kept exactly
  const concert = plan.expenses[3];
  assert.deepEqual(new Map(concert.shares), new Map([[0, 1683], [1, 3417]]));

  // payments: the positive column paid the negative one
  assert.deepEqual(plan.settlements[0], {
    line: 6,
    date: '2023-02-19',
    note: 'Stavroula P. paid ninblack n.',
    amountCents: 30000,
    fromPerson: 1,
    toPerson: 0,
  });
  assert.equal(plan.settlements[1].fromPerson, 0);

  // what we will insert produces exactly the balances of the file
  assert.deepEqual(plan.plannedNetCents, plan.fileNetCents);
  assert.deepEqual(plan.plannedNetCents, [57817, -57817]);
  assert.equal(plan.currency, 'EUR');
  assert.equal(plan.firstDate, '2022-08-23');
  assert.equal(plan.lastDate, '2025-06-28');
});

test('planImport skips rows it cannot represent instead of failing', () => {
  const text = `Date,Description,Category,Cost,Currency,A,B,C
2024-01-01,two payers,General,30.00,EUR,10.00,10.00,-20.00
2024-01-02,nothing,General,30.00,EUR,0.00,0.00,0.00
2024-01-03,does not add up,General,30.00,EUR,10.00,-5.00,0.00
2024-01-04,fine,General,30.00,EUR,20.00,-10.00,-10.00
`;
  const plan = planImport(parseSplitwiseCsv(text));
  assert.equal(plan.expenses.length, 1);
  assert.equal(plan.skipped.length, 3);
  assert.deepEqual(
    plan.skipped.map((s) => s.line),
    [2, 3, 4],
  );
  assert.deepEqual(new Map(plan.expenses[0].shares), new Map([[0, 1000], [1, 1000], [2, 1000]]));
});

test('mapCategory', () => {
  assert.equal(mapCategory('General'), null);
  assert.equal(mapCategory(''), null);
  assert.equal(mapCategory('Groceries'), 'Σούπερ μάρκετ');
  assert.equal(mapCategory('TV/Phone/Internet'), 'Λογαριασμοί');
  assert.equal(mapCategory('Pets'), 'Άλλο');
});
