/**
 * The Warehouses chip multi-select is ONE control over TWO form fields:
 * `warehouse` (the primary row, which owns the scannable barcode) and
 * `additionalWarehouses` (a sibling products row each, with its own opening
 * stock). This covers that split, mirroring `setWarehouseSelection` in
 * app/(app)/products/add-product/tabs/inventory-tab.tsx.
 *
 * Two things can go wrong and neither is visible in the UI until it is too
 * late: the head of the list silently deciding which warehouse owns the
 * barcode, and a rebuild discarding opening quantities already typed.
 */

type Row = { warehouseId: string; stock?: number };
type Split = { warehouse: string; additionalWarehouses: Row[] };

function setWarehouseSelection(existing: Row[], ids: string[]): Split {
  const [first, ...rest] = ids;
  return {
    warehouse: first ?? '',
    additionalWarehouses: rest.map(
      (id) => existing.find((r) => r?.warehouseId === id) ?? { warehouseId: id, stock: 0 },
    ),
  };
}

function selectionOf(warehouse: string, extras: Row[]): string[] {
  return [
    ...(warehouse ? [warehouse] : []),
    ...extras.map((r) => r?.warehouseId).filter(Boolean),
  ];
}

const cases: { name: string; run: () => void }[] = [];
function ctest(name: string, run: () => void) {
  cases.push({ name, run });
}
function assertEqual(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}\n  expected: ${e}\n  actual:   ${a}`);
}

ctest('the first pick becomes the primary warehouse', () => {
  assertEqual(
    setWarehouseSelection([], ['wh_a']),
    { warehouse: 'wh_a', additionalWarehouses: [] },
    'single pick',
  );
});

ctest('later picks become additional warehouses, not the primary', () => {
  assertEqual(
    setWarehouseSelection([], ['wh_a', 'wh_b', 'wh_c']),
    {
      warehouse: 'wh_a',
      additionalWarehouses: [
        { warehouseId: 'wh_b', stock: 0 },
        { warehouseId: 'wh_c', stock: 0 },
      ],
    },
    'three picks',
  );
});

ctest('clearing every chip leaves no primary', () => {
  assertEqual(
    setWarehouseSelection([{ warehouseId: 'wh_b', stock: 9 }], []),
    { warehouse: '', additionalWarehouses: [] },
    'empty selection',
  );
});

ctest('typed quantities survive ticking another warehouse', () => {
  const existing: Row[] = [{ warehouseId: 'wh_b', stock: 150 }];
  assertEqual(
    setWarehouseSelection(existing, ['wh_a', 'wh_b', 'wh_c']).additionalWarehouses,
    [
      { warehouseId: 'wh_b', stock: 150 },
      { warehouseId: 'wh_c', stock: 0 },
    ],
    'wh_b keeps 150 when wh_c is added',
  );
});

ctest('typed quantities survive unticking a different warehouse', () => {
  const existing: Row[] = [
    { warehouseId: 'wh_b', stock: 150 },
    { warehouseId: 'wh_c', stock: 24 },
  ];
  assertEqual(
    setWarehouseSelection(existing, ['wh_a', 'wh_c']).additionalWarehouses,
    [{ warehouseId: 'wh_c', stock: 24 }],
    'wh_c keeps 24 when wh_b is removed',
  );
});

ctest('an explicit zero is preserved, not rebuilt as missing', () => {
  const existing: Row[] = [{ warehouseId: 'wh_b', stock: 0 }];
  assertEqual(
    setWarehouseSelection(existing, ['wh_a', 'wh_b']).additionalWarehouses[0],
    { warehouseId: 'wh_b', stock: 0 },
    'zero row reused',
  );
});

ctest('unticking the primary promotes the next warehouse to primary', () => {
  // The consequence that matters: the barcode moves with it. The head of the
  // list is load-bearing, which is why order is preserved rather than sorted.
  const existing: Row[] = [{ warehouseId: 'wh_b', stock: 150 }];
  assertEqual(
    setWarehouseSelection(existing, ['wh_b']),
    { warehouse: 'wh_b', additionalWarehouses: [] },
    'wh_b promoted after wh_a is unticked',
  );
});

ctest('the same warehouse is never both primary and extra', () => {
  const out = setWarehouseSelection([], ['wh_a', 'wh_b']);
  const dupes = out.additionalWarehouses.filter((r) => r.warehouseId === out.warehouse);
  assertEqual(dupes, [], 'no extra row repeats the primary');
});

ctest('reading the split back yields the same chip list', () => {
  const ids = ['wh_a', 'wh_b', 'wh_c'];
  const out = setWarehouseSelection([], ids);
  assertEqual(
    selectionOf(out.warehouse, out.additionalWarehouses),
    ids,
    'round-trips, so chips do not reorder themselves on re-render',
  );
});

ctest('a form with no warehouse yet shows no chips', () => {
  assertEqual(selectionOf('', []), [], 'empty form');
});

let failed = 0;
for (const c of cases) {
  try {
    c.run();
    console.log(`  ok  ${c.name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${c.name}`);
    console.error(`        ${(err as Error).message}`);
  }
}
console.log(
  failed === 0
    ? `\npassed: ${cases.length}/${cases.length}`
    : `\nFAILED: ${failed} of ${cases.length}`,
);
if (failed > 0) process.exitCode = 1;

/**
 * Opening stock is typed on each warehouse's row inside the picker, but it
 * still lands in TWO different form fields: the primary's figure is the
 * product row's own `stock` column, each extra's is its additionalWarehouses
 * row. Routing it to the wrong one would silently stock the wrong warehouse.
 */
type Form = { warehouse: string; stock?: number; additionalWarehouses: Row[] };

function stockFor(f: Form, id: string): number | undefined {
  if (id === f.warehouse) return f.stock;
  return f.additionalWarehouses.find((r) => r?.warehouseId === id)?.stock;
}

function setStockFor(f: Form, id: string, raw: string): Form {
  const parsed = raw === '' ? undefined : parseInt(raw, 10) || 0;
  if (id === f.warehouse) return { ...f, stock: parsed };
  const index = f.additionalWarehouses.findIndex((r) => r?.warehouseId === id);
  if (index < 0) return f;
  const rows = f.additionalWarehouses.slice();
  rows[index] = { ...rows[index], stock: parsed };
  return { ...f, additionalWarehouses: rows };
}

const routing: { name: string; run: () => void }[] = [];
function rtest(name: string, run: () => void) { routing.push({ name, run }); }

const base: Form = {
  warehouse: 'wh_a',
  stock: undefined,
  additionalWarehouses: [{ warehouseId: 'wh_b', stock: 0 }],
};

rtest('the primary row writes the product stock column, not an extra row', () => {
  const out = setStockFor(base, 'wh_a', '24');
  assertEqual(out.stock, 24, 'primary stock');
  assertEqual(out.additionalWarehouses, base.additionalWarehouses, 'extras untouched');
});

rtest('an extra row writes its own row, not the product stock column', () => {
  const out = setStockFor(base, 'wh_b', '150');
  assertEqual(out.stock, undefined, 'product stock untouched');
  assertEqual(out.additionalWarehouses, [{ warehouseId: 'wh_b', stock: 150 }], 'extra row');
});

rtest('each warehouse reads back the figure typed on its own row', () => {
  let f = setStockFor(base, 'wh_a', '24');
  f = setStockFor(f, 'wh_b', '150');
  assertEqual([stockFor(f, 'wh_a'), stockFor(f, 'wh_b')], [24, 150], 'round-trip');
});

rtest('clearing a field leaves it undefined, so the schema can default it', () => {
  const f = setStockFor(setStockFor(base, 'wh_a', '24'), 'wh_a', '');
  assertEqual(f.stock, undefined, 'cleared primary');
});

rtest('a warehouse that is not selected is ignored, never appended', () => {
  const out = setStockFor(base, 'wh_zzz', '99');
  assertEqual(out, base, 'unchanged');
});

rtest('typing zero is kept as zero, not dropped as blank', () => {
  assertEqual(setStockFor(base, 'wh_a', '0').stock, 0, 'explicit zero');
});

let rfailed = 0;
for (const c of routing) {
  try { c.run(); console.log(`  ok  ${c.name}`); }
  catch (err) { rfailed++; console.error(`  FAIL  ${c.name}`); console.error(`        ${(err as Error).message}`); }
}
console.log(rfailed === 0 ? `passed: ${routing.length}/${routing.length} (stock routing)` : `FAILED: ${rfailed} of ${routing.length}`);
if (rfailed > 0) process.exitCode = 1;
