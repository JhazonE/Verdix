# Retire products.sku — Sub-project C: Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire every remaining `products.sku` read across the 9 report areas named in the root design spec (`sales/by-product`, `purchases/by-product`, `profit-margin`, `top-sales`, `top-volume`, `velocity`, `expiring-soon`, `cost-vs-retail`, `batch-profit`) and their API routes — Sub-projects A and B already retired `sku` from every product form and every inventory/POS UI surface; this is the last user-facing sub-project before the final cleanup migration drops the column.

**Architecture:** These 9 pages are backed by 7 distinct API route files (4 of the 9 pages — `sales/by-product`, `top-sales`, `top-volume`, `profit-margin` — call the exact same route, `app/api/sales/by-product/route.ts`, and are otherwise near-byte-identical page files). None of the 7 routes currently joins `product_selling_units`, so each gets its own new `LEFT JOIN ... AND is_base = 1` (or, for the routes where `sku` is confirmed dead in the UI, the column is simply removed rather than replaced). Every page uses its own locally-declared TypeScript interface — none import the shared `Product` type from `lib/types.ts` — so each interface needs its own edit; there is no shared type to fix once. Effort varies sharply by report: `velocity` and `cost-vs-retail` have a `sku` field that is fetched, typed, and otherwise completely unused (search, render, and export all skip it) — pure removal. `sales/by-product` (and its 3 clones) and `purchases/by-product` already display a **legacy `products.barcode`** column correctly-looking on screen and in exports — their fix is swapping that display source to the base-unit barcode, not adding a new display. `batch-profit` uses `sku` only in a client-side search filter. `expiring-soon` is the only report with literal "SKU" text (2 table headers, 1 Excel export header, 1 search placeholder) and needs a real rename to "Barcode", matching the pattern the Products/Inventory pages already used in Sub-project B (Cluster 2).

**Tech Stack:** Next.js 16 App Router, React, TypeScript, raw `mysql2/promise` via `lib/mysql.ts`, no automated test covers any of these files (manual-only, same as every prior cluster of this effort).

**Spec:** `docs/superpowers/specs/2026-09-22-retire-product-sku-design.md` (Sub-project C section, lines 128-134). Sub-projects A and B are already merged.

## Global Constraints

- Every touched query reads the base selling unit's barcode via `LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1` (or the query's own existing alias convention where a `p`-equivalent alias differs — check each file), falling back to the legacy `products.barcode` column where a fallback already exists in that site's current display. `product_selling_units` has NO database-level constraint enforcing exactly one `is_base = 1` row per product — this is an accepted, pre-existing risk already present elsewhere in this codebase (`app/(app)/products/actions.ts:951`), not something this plan needs to newly defend against.
- Every touched client-side search filter that currently checks `record.sku` or `record.product.sku` either has that check removed entirely (routes where `sku` was never displayed) or swapped to check the new base-unit-barcode field (routes where a barcode value is already searched, so the base-unit barcode should be searchable the same way the legacy barcode already is).
- **Three-way distinction between reports, confirmed during planning — treat each report according to which bucket it's in, do not apply the same fix shape to all nine:**
  1. **Dead-field removal** (`velocity`, `cost-vs-retail`): `sku` is selected by the API and typed in the page's interface, but never rendered, filtered, or exported. Fix: delete the SQL column, delete the `GROUP BY`/response reference, delete the type field. Do NOT add a `baseUnitBarcode` field to these two reports — there is nothing that would read it, and adding an unused field would be the same kind of dead code this fix is removing.
  2. **Display-source swap** (`sales/by-product`, `top-sales`, `top-volume`, `profit-margin`, `purchases/by-product`): these already show a "Barcode" column/export-header sourced from the legacy `products.barcode` column (not `sku` — `sku` is only in a client-side search filter here, invisible on screen). Fix: add the base-unit-barcode join, add a `baseUnitBarcode` field to the type, change the display source from `record.product.barcode`/`record.barcode` to `record.product.baseUnitBarcode || record.product.barcode` (or the flat equivalent for `purchases/by-product`), and change the search filter from checking `.sku` to also checking the new field instead. No "SKU" text exists anywhere in these 5 reports' UI — this is a silent source swap, not a rename.
  3. **Search-filter-only removal** (`batch-profit`): `sku` is fetched, typed, and used only in the client search filter (never rendered, never exported). Fix: same as the display-source-swap bucket's filter treatment (swap the filter to the new field) but there is no on-screen "Barcode" column already correctly displaying the legacy column here for this task to match against — check the actual file before assuming which sub-pattern applies.
  4. **Real rename** (`expiring-soon`): the only report with literal "SKU" text — 2 table headers, 1 Excel export column header, 1 search placeholder. Fix: full rename to "Barcode" plus the base-unit-barcode join/type/render/export swap, matching the pattern Sub-project B's Cluster 2 already used for the Products/Inventory listing pages.
- Do not touch `lib/report-print.ts` or `components/reports/ReportSearchInput.tsx` — confirmed during planning that neither references `sku` in any form; they are generic rendering helpers with no product-specific logic to fix.
- Do not touch `products.barcode` (legacy column, stays as a fallback only where one already exists), `supplier_product_mapping.supplier_sku`, bulk import/export, sales/purchase/PO product selectors, or e2e test files — all out of scope, belong to Sub-project D.
- Do not touch any file already covered by Sub-projects A or B (product forms, `lib/product-search.ts`, POS, Products/Inventory listing pages, inventory boards, repackaging, Stock Transfer/Break Pack dialogs) — all already merged.
- Dropping the `products.sku` column itself remains deferred to the final cleanup after Sub-project D.

---

### Task 1: `api/sales/by-product/route.ts` — the shared route backing 4 reports

**Files:**
- Modify: `app/api/sales/by-product/route.ts`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: the response's `data[].product` objects gain a `baseUnitBarcode: string | null` field, and `sku` is removed from that object entirely. Task 2 (all 4 consumer pages) depends on this exact field name and on `sku` being gone.

- [ ] **Step 1: Confirm the current file**

```bash
grep -n "p.sku\|sku:" "app/api/sales/by-product/route.ts"
```

Confirm the current state (already read during planning): `p.sku` appears in the terminal-filtered branch's SELECT (line 30), the unified branch's SELECT (line 135), the shared `GROUP BY` (line 184), the search `WHERE` clause in BOTH branches (lines 76 and 177), and the response mapper (line 237).

This file has a subtle structure: `baseQueryStr` (set inside an `if (terminalId...) {...} else {...}` block) is combined with `whereClause` into `fullQueryWithoutLimit`, which is then reused THREE times — for `countQuery`, `totalsQuery`, and `paginationQuery`. A `GROUP BY` addition only needs to happen once (it's part of `fullQueryWithoutLimit`), but the `LEFT JOIN` needs to be added inside BOTH branches' `baseQueryStr` (they are two independent SQL strings, not one shared one).

- [ ] **Step 2: Add the `LEFT JOIN` to the terminal-filtered branch**

Find (inside the `if (terminalId && terminalId !== 'all') {` block):

```typescript
           FROM sale_items si
           JOIN pos_transactions pt ON si.sale_id = pt.sale_id
           JOIN users u ON pt.user_id = u.id
           JOIN pos_transaction_items pti ON pti.sale_item_id = si.id
           JOIN products p ON si.product_id = p.id
           WHERE pt.terminal_id = ? 
           AND (pt.transaction_type = 'sale')
```

Replace with:

```typescript
           FROM sale_items si
           JOIN pos_transactions pt ON si.sale_id = pt.sale_id
           JOIN users u ON pt.user_id = u.id
           JOIN pos_transaction_items pti ON pti.sale_item_id = si.id
           JOIN products p ON si.product_id = p.id
           LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
           WHERE pt.terminal_id = ? 
           AND (pt.transaction_type = 'sale')
```

- [ ] **Step 3: Add the `LEFT JOIN` to the unified branch**

Find (inside the `else {` block, at the end of the `WITH all_sale_items AS (...)` CTE's main `SELECT`):

```typescript
          FROM all_sale_items asi
          INNER JOIN products p ON asi.product_id = p.id
          WHERE 1=1
```

Replace with:

```typescript
          FROM all_sale_items asi
          INNER JOIN products p ON asi.product_id = p.id
          LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
          WHERE 1=1
```

- [ ] **Step 4: Replace `p.sku` with the base-unit barcode in both SELECT clauses**

In the terminal-filtered branch's SELECT (the one containing `p.id as product_id,`), find:

```typescript
             p.id as product_id,
             p.name as product_name,
             p.sku,
             p.barcode,
```

Replace with:

```typescript
             p.id as product_id,
             p.name as product_name,
             su.barcode as base_unit_barcode,
             p.barcode,
```

In the unified branch's SELECT, find:

```typescript
            p.id as product_id,
            p.name as product_name,
            p.sku,
            p.barcode,
```

Replace with:

```typescript
            p.id as product_id,
            p.name as product_name,
            su.barcode as base_unit_barcode,
            p.barcode,
```

(`sku` is removed entirely, not kept alongside the new column — nothing downstream needs it once Task 2 lands, and this whole sub-project's goal is eliminating `.sku` reads, not adding a redundant one.)

- [ ] **Step 5: Update the `GROUP BY`**

Find:

```typescript
      GROUP BY p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit_of_measure
```

Replace with:

```typescript
      GROUP BY p.id, p.name, su.barcode, p.barcode, p.category, p.brand, p.unit_of_measure
```

(This one `GROUP BY` is shared by both branches via `fullQueryWithoutLimit` — a single edit covers both.)

- [ ] **Step 6: Update both search `WHERE` clauses**

Find (appears twice, once per branch — confirm both occurrences with `grep -n "p.sku LIKE" "app/api/sales/by-product/route.ts"` before editing):

```typescript
          whereClause += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
```

Replace with:

```typescript
          whereClause += ` AND (p.name LIKE ? OR su.barcode LIKE ? OR p.barcode LIKE ?)`;
```

And:

```typescript
            baseQueryStr += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
```

Replace with:

```typescript
            baseQueryStr += ` AND (p.name LIKE ? OR su.barcode LIKE ? OR p.barcode LIKE ?)`;
```

(Both search clauses already pass 3 bind params — `%${search}%` three times — this edit only changes which column the second one matches against, not the number of params, so no change is needed to the `params.push(...)` calls immediately below each.)

- [ ] **Step 7: Update the response mapper**

Find:

```typescript
      product: {
        id: row.product_id,
        name: row.product_name,
        sku: row.sku,
        barcode: row.barcode,
```

Replace with:

```typescript
      product: {
        id: row.product_id,
        name: row.product_name,
        baseUnitBarcode: row.base_unit_barcode,
        barcode: row.barcode,
```

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 — this codebase's current baseline as of Sub-project B's merge. No new errors (this route has no return-type annotation, so a mismatch here would not surface as a compile error — Task 2's own field-name match is what closes that gap).

- [ ] **Step 9: Manual verification**

Using the local dev DB, confirm the join resolves correctly:

```sql
SELECT p.id, p.sku, su.barcode AS base_unit_barcode
FROM products p
LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
WHERE p.type = 'standard' LIMIT 3;
```

Confirm `base_unit_barcode` is populated for standard products with a base selling unit. A full end-to-end UI check happens in Task 2 (this route has no UI of its own to check in isolation) and Task 9's regression pass.

- [ ] **Step 10: Commit**

```bash
git add "app/api/sales/by-product/route.ts"
git commit -m "feat: sales-by-product API exposes the base selling unit's barcode, not sku"
```

---

### Task 2: The 4 pages sharing that route — `sales/by-product`, `top-sales`, `top-volume`, `profit-margin`

**Files:**
- Modify: `app/(app)/reports/sales/by-product/page.tsx`
- Modify: `app/(app)/reports/sales/top-sales/page.tsx`
- Modify: `app/(app)/reports/sales/top-volume/page.tsx`
- Modify: `app/(app)/reports/sales/profit-margin/page.tsx`
- Test: manual

**Interfaces:**
- Consumes: `api/sales/by-product/route.ts`'s new `baseUnitBarcode` field (Task 1) — must be spelled exactly right in all 4 files, each of which independently declares its own `ProductSale` interface (confirmed during planning: byte-identical across all 4 files, but NOT a shared import — each is its own local declaration).
- Produces: nothing new exposed.

- [ ] **Step 1: Confirm all 4 files are still identical in the relevant ranges**

```bash
for f in "sales/by-product" "sales/top-sales" "sales/top-volume" "sales/profit-margin"; do
  echo "=== $f ==="
  sed -n '38,55p' "app/(app)/reports/$f/page.tsx"
done
```

Confirm each shows the same `interface ProductSale` (already read during planning):

```typescript
interface ProductSale {
  product: {
    id: string;
    name: string;
    sku: string;
    barcode: string;
    category: string;
    brand: string;
    unitOfMeasure: string;
  };
  unitsSold: number;
  totalRevenue: number;
  totalDiscount: number;
  totalCost: number;
  totalProfit: number;
  numberOfSales: number;
  avgPricePerUnit: number;
}
```

- [ ] **Step 2: Update the type in all 4 files**

In EACH of the 4 files, replace:

```typescript
    id: string;
    name: string;
    sku: string;
    barcode: string;
```

with:

```typescript
    id: string;
    name: string;
    baseUnitBarcode: string | null;
    barcode: string;
```

- [ ] **Step 3: Update the client-side search filter in all 4 files**

In EACH of the 4 files, confirm the current filter (already read during planning — identical in all 4):

```typescript
      record.product.name?.toLowerCase().includes(search) ||
      record.product.sku?.toLowerCase().includes(search) ||
      record.product.barcode?.toLowerCase().includes(search) ||
```

Replace with:

```typescript
      record.product.name?.toLowerCase().includes(search) ||
      record.product.baseUnitBarcode?.toLowerCase().includes(search) ||
      record.product.barcode?.toLowerCase().includes(search) ||
```

- [ ] **Step 4: Update the display source in all 4 files — 3 sites each (PDF export, Excel export, table cell)**

In EACH of the 4 files, find all occurrences of the display expression:

```bash
grep -n "r.product.barcode\|record.product.barcode" "app/(app)/reports/sales/by-product/page.tsx"
```

Confirm 3 occurrences per file (already read during planning): a PDF-export column (`{ header: 'Barcode', width: 25, cell: (r) => r.product.barcode || '-' }`), an Excel-export column (`{ header: 'Barcode', cell: (r) => r.product.barcode || '-' }`), and a table cell (`<TableCell className="py-2 px-2 text-muted-foreground">{record.product.barcode || '-'}</TableCell>`).

Replace each of the 3 sites' `r.product.barcode` / `record.product.barcode` reference:

```tsx
        { header: 'Barcode', width: 25, cell: (r) => r.product.barcode || '-' },
```
becomes:
```tsx
        { header: 'Barcode', width: 25, cell: (r) => r.product.baseUnitBarcode || r.product.barcode || '-' },
```

```tsx
        { header: 'Barcode', cell: (r) => r.product.barcode || '-' },
```
becomes:
```tsx
        { header: 'Barcode', cell: (r) => r.product.baseUnitBarcode || r.product.barcode || '-' },
```

```tsx
                      <TableCell className="py-2 px-2 text-muted-foreground">{record.product.barcode || '-'}</TableCell>
```
becomes:
```tsx
                      <TableCell className="py-2 px-2 text-muted-foreground">{record.product.baseUnitBarcode || record.product.barcode || '-'}</TableCell>
```

(The `'Barcode'` header TEXT is unchanged in all 3 sites — only the value source changes. This is a display-source swap, not a rename, per this plan's Global Constraints bucket 2.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/reports/sales/by-product`, `/reports/sales/top-sales`, `/reports/sales/top-volume`, `/reports/sales/profit-margin` in turn. Confirm each still loads, shows a "Barcode" column with values, and the search box still finds products when typing part of a barcode.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/reports/sales/by-product/page.tsx" \
        "app/(app)/reports/sales/top-sales/page.tsx" \
        "app/(app)/reports/sales/top-volume/page.tsx" \
        "app/(app)/reports/sales/profit-margin/page.tsx"
git commit -m "feat: sales-by-product family of reports shows the base selling unit's barcode, not sku"
```

---

### Task 3: `purchases/by-product` — route + page

**Files:**
- Modify: `app/api/reports/purchases/by-product/route.ts`
- Modify: `app/(app)/reports/purchases/by-product/page.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: the route's response rows gain a `baseUnitBarcode` field (spread via `...row`, so no explicit mapper change needed — see Step 3) and no longer include `sku`.

- [ ] **Step 1: Confirm the current query**

```bash
grep -n "p.sku\|LEFT JOIN products" "app/api/reports/purchases/by-product/route.ts"
```

Confirm (already read during planning):

```typescript
      SELECT 
        poi.product_id as productId,
        poi.product_name as productName,
        p.sku,
        p.barcode,
        p.category,
        p.brand,
        p.unit_of_measure as uom,
        SUM(poi.quantity) as totalQuantity,
        SUM(poi.quantity * COALESCE(ib.unit_cost, poi.cost)) as totalCost,
        AVG(COALESCE(ib.unit_cost, poi.cost)) as avgCost
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      LEFT JOIN inventory_batches ib ON poi.purchase_order_id = ib.purchase_order_id AND poi.product_id = ib.product_id
      LEFT JOIN products p ON poi.product_id = p.id
      WHERE 1=1
```

- [ ] **Step 2: Add the join and swap the SELECT column**

Replace:

```typescript
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      LEFT JOIN inventory_batches ib ON poi.purchase_order_id = ib.purchase_order_id AND poi.product_id = ib.product_id
      LEFT JOIN products p ON poi.product_id = p.id
      WHERE 1=1
```

with:

```typescript
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      LEFT JOIN inventory_batches ib ON poi.purchase_order_id = ib.purchase_order_id AND poi.product_id = ib.product_id
      LEFT JOIN products p ON poi.product_id = p.id
      LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
      WHERE 1=1
```

Replace:

```typescript
        poi.product_id as productId,
        poi.product_name as productName,
        p.sku,
        p.barcode,
```

with:

```typescript
        poi.product_id as productId,
        poi.product_name as productName,
        su.barcode as baseUnitBarcode,
        p.barcode,
```

(This route's mapper does `results.map((row: any) => ({ ...row, ... }))` — it spreads every SQL-aliased column straight through, so aliasing the new column as `baseUnitBarcode` directly in SQL, camelCase, means no separate mapper edit is needed the way Task 1's route needed one. Confirm this by re-reading the mapper before assuming — see Step 4.)

- [ ] **Step 3: Update the `GROUP BY` and search `WHERE`**

Find:

```typescript
    sql += ' GROUP BY poi.product_id, poi.product_name, p.sku, p.barcode, p.category, p.brand, p.unit_of_measure';
```

Replace with:

```typescript
    sql += ' GROUP BY poi.product_id, poi.product_name, su.barcode, p.barcode, p.category, p.brand, p.unit_of_measure';
```

Find:

```typescript
      sql += ' AND (poi.product_name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)';
```

Replace with:

```typescript
      sql += ' AND (poi.product_name LIKE ? OR su.barcode LIKE ? OR p.barcode LIKE ?)';
```

- [ ] **Step 4: Confirm the mapper needs no change**

```bash
grep -n "results.map" "app/api/reports/purchases/by-product/route.ts"
```

Confirm it reads:

```typescript
      data: results.map((row: any) => ({
        ...row,
        totalQuantity: parseInt(row.totalQuantity || '0'),
        totalCost: parseFloat(row.totalCost || '0'),
        avgCost: parseFloat(row.avgCost || '0'),
      }))
```

The `...row` spread means `baseUnitBarcode` (already camelCase from the SQL alias in Step 2) passes through automatically — no line to add here. If this mapper has changed since planning and no longer spreads `...row`, treat that as new information requiring an explicit `baseUnitBarcode: row.baseUnitBarcode,` line instead.

- [ ] **Step 5: Update the page's type**

```bash
grep -n "sku: string;" "app/(app)/reports/purchases/by-product/page.tsx"
```

Confirm (already read during planning), inside `interface ProductPurchase`:

```typescript
  sku: string;
  barcode: string;
```

Replace with:

```typescript
  baseUnitBarcode: string | null;
  barcode: string;
```

- [ ] **Step 6: Update the search filter**

Find:

```typescript
      record.productName?.toLowerCase().includes(search) ||
      record.sku?.toLowerCase().includes(search) ||
      record.barcode?.toLowerCase().includes(search) ||
```

Replace with:

```typescript
      record.productName?.toLowerCase().includes(search) ||
      record.baseUnitBarcode?.toLowerCase().includes(search) ||
      record.barcode?.toLowerCase().includes(search) ||
```

- [ ] **Step 7: Update the table-cell fallback display**

Find:

```tsx
                        <span className="text-xs text-muted-foreground">{record.barcode || record.sku || '-'}</span>
```

Replace with:

```tsx
                        <span className="text-xs text-muted-foreground">{record.baseUnitBarcode || record.barcode || '-'}</span>
```

(This site's original fallback order was `barcode` first, THEN `sku` — i.e. the LEGACY column already took priority over `sku` here, unlike every other site in this whole multi-cluster effort where the base-unit barcode goes first. Per this sub-project's own core principle — base-unit barcode is the real identifier now, legacy `products.barcode` is only a last-resort fallback — this task INVERTS that prior order: `baseUnitBarcode` now goes first, `barcode` second, `sku` dropped. This is a deliberate behavior change matching every other site fixed across this whole effort, not an oversight.)

- [ ] **Step 8: Confirm the PDF/Excel export columns need no change**

```bash
grep -n "header: 'Barcode'" "app/(app)/reports/purchases/by-product/page.tsx"
```

Confirm both occurrences (already read during planning) read `cell: (r) => r.barcode || '-'` — these use the LEGACY `products.barcode` column only, with no `sku` fallback at all, unlike the table cell in Step 7. Per this plan's Global Constraints, do not add a `baseUnitBarcode` fallback here unless you have a specific reason to believe it's needed — the spec names this report's fix as being about the `sku` reads, and these two export columns have no `sku` reference to retire. Leave them exactly as they are.

- [ ] **Step 9: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 10: Manual verification**

Run `npm run dev`, open `/reports/purchases/by-product`. Confirm the page loads, the sub-line under each product name shows a barcode-looking value, and search still finds products by barcode.

- [ ] **Step 11: Commit**

```bash
git add "app/api/reports/purchases/by-product/route.ts" \
        "app/(app)/reports/purchases/by-product/page.tsx"
git commit -m "feat: purchases-by-product report shows the base selling unit's barcode, not sku"
```

---

### Task 4: `velocity` — route + page (dead-field removal)

**Files:**
- Modify: `app/api/reports/velocity/route.ts`
- Modify: `app/(app)/reports/velocity/page.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new exposed — this task REMOVES a field, it does not add one, per this plan's Global Constraints bucket 1 (`sku` is confirmed dead in this report's UI: no search, no render, no export reads it).

- [ ] **Step 1: Confirm `sku` is genuinely unused in the page**

```bash
grep -n "\.sku\b\|sku:" "app/(app)/reports/velocity/page.tsx"
```

Expected: exactly one match, the type declaration (`sku: string;` inside `interface VelocityProduct`, confirmed during planning at line 34). If this grep returns more than one match, STOP — the "dead field" assumption this task's whole approach rests on no longer holds, and the fix should follow Task 3's swap pattern instead (report this to the controller as a blocker, do not guess which pattern to apply).

- [ ] **Step 2: Remove `sku` from the API route's SELECT clauses**

```bash
grep -n "p.sku" "app/api/reports/velocity/route.ts"
```

Confirm 2 occurrences (already read during planning) — one in the `type === 'none'` branch's `sqlSelect`, one in the `else` branch's `sqlSelect`:

```typescript
      sqlSelect = `
        SELECT 
          p.id,
          p.name,
          p.sku,
          p.barcode,
          p.category,
          p.stock,
          0 as total_sold,
          0 as total_revenue
      `;
```

Remove the `p.sku,` line, leaving:

```typescript
      sqlSelect = `
        SELECT 
          p.id,
          p.name,
          p.barcode,
          p.category,
          p.stock,
          0 as total_sold,
          0 as total_revenue
      `;
```

And:

```typescript
      sqlSelect = `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.barcode,
          p.category,
          p.stock,
          COALESCE(SUM(si.quantity * COALESCE(si.selling_unit_factor, 1)), 0) as total_sold,
          COALESCE(SUM(si.quantity * si.price), 0) as total_revenue
      `;
```

Remove the `p.sku,` line, leaving:

```typescript
      sqlSelect = `
        SELECT
          p.id,
          p.name,
          p.barcode,
          p.category,
          p.stock,
          COALESCE(SUM(si.quantity * COALESCE(si.selling_unit_factor, 1)), 0) as total_sold,
          COALESCE(SUM(si.quantity * si.price), 0) as total_revenue
      `;
```

- [ ] **Step 3: Remove `p.sku` from the shared `GROUP BY`**

Find:

```typescript
      GROUP BY p.id, p.name, p.sku, p.barcode, p.category, p.stock
```

Replace with:

```typescript
      GROUP BY p.id, p.name, p.barcode, p.category, p.stock
```

- [ ] **Step 4: Remove `sku` from the page's type**

```bash
grep -n "sku: string;" "app/(app)/reports/velocity/page.tsx"
```

Delete that line from `interface VelocityProduct`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/reports/velocity`. Confirm the page loads for all three tabs (Fast, Slow, Not Moving) exactly as before — this task removes a field nothing displayed, so there is no visible UI difference to check; this step confirms the query itself doesn't error.

- [ ] **Step 7: Commit**

```bash
git add "app/api/reports/velocity/route.ts" "app/(app)/reports/velocity/page.tsx"
git commit -m "feat: remove unused products.sku field from the Velocity report"
```

---

### Task 5: `cost-vs-retail` — route + page (dead-field removal)

**Files:**
- Modify: `app/api/reports/cost-vs-retail/route.ts`
- Modify: `app/(app)/reports/cost-vs-retail/page.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new exposed — same dead-field removal pattern as Task 4.

- [ ] **Step 1: Confirm `sku` is genuinely unused in the page**

```bash
grep -n "\.sku\b\|sku:" "app/(app)/reports/cost-vs-retail/page.tsx"
```

Expected: exactly one match, the type declaration (`sku: string;` inside `interface Row`, confirmed during planning at line 27). If more than one match, STOP and report as a blocker — do not guess.

- [ ] **Step 2: Remove `p.sku` from the API route's SELECT**

```bash
grep -n "p.sku" "app/api/reports/cost-vs-retail/route.ts"
```

Confirm (already read during planning):

```typescript
      SELECT
        p.id, p.name, p.sku, p.barcode, p.category, p.brand,
        p.stock, p.unit_of_measure, p.cost, p.price,
```

Replace with:

```typescript
      SELECT
        p.id, p.name, p.barcode, p.category, p.brand,
        p.stock, p.unit_of_measure, p.cost, p.price,
```

(This query has no `GROUP BY` at all — confirmed during planning — so there is no second site to update, unlike Task 4's velocity fix.)

- [ ] **Step 3: Remove `sku` from the page's type**

```bash
grep -n "sku: string;" "app/(app)/reports/cost-vs-retail/page.tsx"
```

Delete that line from `interface Row`.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open `/reports/cost-vs-retail`. Confirm the page loads exactly as before.

- [ ] **Step 6: Commit**

```bash
git add "app/api/reports/cost-vs-retail/route.ts" "app/(app)/reports/cost-vs-retail/page.tsx"
git commit -m "feat: remove unused products.sku field from the Cost vs Retail report"
```

---

### Task 6: `batch-profit` — route + page (search-filter-only)

**Files:**
- Modify: `app/api/sales/batch-analysis/route.ts`
- Modify: `app/(app)/reports/sales/batch-profit/page.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: the route's response objects gain a `baseUnitBarcode` field in place of `sku`.

- [ ] **Step 1: Confirm the current query**

```bash
grep -n "p.sku\|JOIN products" "app/api/sales/batch-analysis/route.ts"
```

Confirm (already read during planning):

```typescript
      FROM sale_items si
      JOIN sales_transactions st ON si.sale_id = st.id
      JOIN products p ON si.product_id = p.id
      WHERE DATE(st.created_at) BETWEEN ? AND ?
```

and the SELECT list includes `p.sku,` alongside `p.barcode,`.

- [ ] **Step 2: Add the join and swap the SELECT column**

Replace:

```typescript
      FROM sale_items si
      JOIN sales_transactions st ON si.sale_id = st.id
      JOIN products p ON si.product_id = p.id
      WHERE DATE(st.created_at) BETWEEN ? AND ?
```

with:

```typescript
      FROM sale_items si
      JOIN sales_transactions st ON si.sale_id = st.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
      WHERE DATE(st.created_at) BETWEEN ? AND ?
```

Replace:

```typescript
        p.name        AS productName,
        p.sku,
        p.barcode,
```

with:

```typescript
        p.name        AS productName,
        su.barcode    AS baseUnitBarcode,
        p.barcode,
```

- [ ] **Step 3: Update the response object construction**

```bash
grep -n "sku: row.sku" "app/api/sales/batch-analysis/route.ts"
```

Confirm (already read during planning), inside the `analysis.push({...})` block:

```typescript
          sku: row.sku,
          barcode: row.barcode,
```

Replace with:

```typescript
          baseUnitBarcode: row.baseUnitBarcode,
          barcode: row.barcode,
```

(The SQL alias in Step 2 is already camelCase `baseUnitBarcode`, so `row.baseUnitBarcode` reads it directly — no snake_case translation needed, matching how `row.productName`/`row.saleReference` etc. are already read elsewhere in this same block.)

- [ ] **Step 4: Update the page's type**

```bash
grep -n "sku: string;" "app/(app)/reports/sales/batch-profit/page.tsx"
```

Confirm inside `interface BatchAnalysisRecord`. Replace:

```typescript
  sku: string;
  barcode: string;
```

with:

```typescript
  baseUnitBarcode: string | null;
  barcode: string;
```

- [ ] **Step 5: Update the search filter**

```bash
grep -n "record.sku" "app/(app)/reports/sales/batch-profit/page.tsx"
```

Confirm (already read during planning), inside the client-side filter:

```typescript
      record.sku?.toLowerCase().includes(search) ||
```

Replace with:

```typescript
      record.baseUnitBarcode?.toLowerCase().includes(search) ||
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, open `/reports/sales/batch-profit`, run a date-range query. Confirm the page loads and search still filters correctly (this report never displayed `sku`/barcode as its own column, so there's no visible display to check — this step confirms the join doesn't break the query or the search box).

- [ ] **Step 8: Commit**

```bash
git add "app/api/sales/batch-analysis/route.ts" "app/(app)/reports/sales/batch-profit/page.tsx"
git commit -m "feat: batch-profit report search matches the base selling unit's barcode, not sku"
```

---

### Task 7: `expiring-soon` — route + page (the one real rename)

**Files:**
- Modify: `app/api/reports/expiring-soon/route.ts`
- Modify: `app/(app)/reports/expiring-soon/page.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: the route's `items[]` gain a `baseUnitBarcode` field; `sku` is removed. This is the only report in this whole plan with literal "SKU" UI text — every rename site is listed explicitly below.

- [ ] **Step 1: Confirm the current query**

```bash
grep -n "p.sku\|JOIN products" "app/api/reports/expiring-soon/route.ts"
```

Confirm (already read during planning):

```typescript
      SELECT
        b.id                  AS batchId,
        b.product_id          AS productId,
        p.name                AS productName,
        p.sku                 AS sku,
        b.quantity_remaining  AS quantityRemaining,
        DATE_FORMAT(b.expiration_date, '%Y-%m-%d') AS expirationDate,
        DATEDIFF(b.expiration_date, CURDATE())     AS daysUntilExpiry
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      WHERE b.expiration_date IS NOT NULL
```

- [ ] **Step 2: Add the join and swap the SELECT column**

Replace:

```typescript
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      WHERE b.expiration_date IS NOT NULL
```

with:

```typescript
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
      WHERE b.expiration_date IS NOT NULL
```

Replace:

```typescript
        p.name                AS productName,
        p.sku                 AS sku,
```

with:

```typescript
        p.name                AS productName,
        su.barcode            AS baseUnitBarcode,
```

- [ ] **Step 3: Update the page's type**

```bash
grep -n "sku: string" "app/(app)/reports/expiring-soon/page.tsx"
```

Confirm (already read during planning), inside `interface ExpiringBatch`:

```typescript
  sku: string | null;
```

Replace with:

```typescript
  baseUnitBarcode: string | null;
```

(This report has no `products.barcode` fallback anywhere in its current code — confirmed during planning, this report only ever read `sku`, never the legacy `barcode` column — so there is no `|| item.barcode` fallback to add; `baseUnitBarcode` alone, falling through to `'—'` where it's already rendered that way, matches this site's own existing null-handling convention.)

- [ ] **Step 4: Update the search filter**

```bash
grep -n "item.sku" "app/(app)/reports/expiring-soon/page.tsx"
```

Confirm (already read during planning):

```typescript
      item.sku?.toLowerCase().includes(search)
```

Replace with:

```typescript
      item.baseUnitBarcode?.toLowerCase().includes(search)
```

- [ ] **Step 5: Rename the Excel export column header and value**

Find:

```tsx
        { header: 'SKU', cell: (r) => r.sku || '—' },
```

Replace with:

```tsx
        { header: 'Barcode', cell: (r) => r.baseUnitBarcode || '—' },
```

- [ ] **Step 6: Rename the on-screen table cell value**

Find:

```tsx
        <TableCell className="text-xs font-mono text-muted-foreground">{item.sku || '—'}</TableCell>
```

Replace with:

```tsx
        <TableCell className="text-xs font-mono text-muted-foreground">{item.baseUnitBarcode || '—'}</TableCell>
```

- [ ] **Step 7: Rename the search input placeholder**

Find:

```tsx
            placeholder="Search product, SKU..."
```

Replace with:

```tsx
            placeholder="Search product, barcode..."
```

- [ ] **Step 8: Rename BOTH table headers**

```bash
grep -n "TableHead>SKU<" "app/(app)/reports/expiring-soon/page.tsx"
```

Confirm 2 occurrences (already read during planning — one in the "Already Expired" section, one in the "Expiring Soon" section, both textually identical):

```tsx
                      <TableHead>Product</TableHead><TableHead>SKU</TableHead>
```

Both occurrences are textually identical (confirmed during planning), so a find-and-replace tool that requires unique matches will reject a single-occurrence edit here — use a replace-all mode (e.g. `Edit` with `replace_all: true`, or two sequential edits disambiguated by surrounding context/line number) rather than editing one and getting stuck on the second. Replace BOTH occurrences with:

```tsx
                      <TableHead>Product</TableHead><TableHead>Barcode</TableHead>
```

- [ ] **Step 9: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 10: Manual verification**

Run `npm run dev`, open `/reports/expiring-soon`. Confirm both table sections (if populated) show a "Barcode" header, not "SKU". Confirm the search placeholder reads "Search product, barcode...". Confirm the Excel export button still works and its downloaded file's header reads "Barcode".

- [ ] **Step 11: Commit**

```bash
git add "app/api/reports/expiring-soon/route.ts" "app/(app)/reports/expiring-soon/page.tsx"
git commit -m "feat: Expiring Soon report shows Barcode, not SKU, in headers, search, and export"
```

---

### Task 8: Full regression pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 — same baseline as before Task 1. Never higher.

- [ ] **Step 2: Confirm no leftover `.sku` reference in any file this plan touched**

```bash
grep -rn "\.sku\b" "app/api/sales/by-product/route.ts" \
                    "app/(app)/reports/sales/by-product/page.tsx" \
                    "app/(app)/reports/sales/top-sales/page.tsx" \
                    "app/(app)/reports/sales/top-volume/page.tsx" \
                    "app/(app)/reports/sales/profit-margin/page.tsx" \
                    "app/api/reports/purchases/by-product/route.ts" \
                    "app/(app)/reports/purchases/by-product/page.tsx" \
                    "app/api/reports/velocity/route.ts" \
                    "app/(app)/reports/velocity/page.tsx" \
                    "app/api/reports/cost-vs-retail/route.ts" \
                    "app/(app)/reports/cost-vs-retail/page.tsx" \
                    "app/api/sales/batch-analysis/route.ts" \
                    "app/(app)/reports/sales/batch-profit/page.tsx" \
                    "app/api/reports/expiring-soon/route.ts" \
                    "app/(app)/reports/expiring-soon/page.tsx"
```

Expected: no matches.

- [ ] **Step 3: Confirm no leftover "SKU" text in `expiring-soon`**

```bash
grep -n "SKU" "app/(app)/reports/expiring-soon/page.tsx"
```

Expected: no matches (case-sensitive — confirms every literal "SKU" was renamed to "Barcode", not just the code references).

- [ ] **Step 4: Confirm `lib/report-print.ts` and `ReportSearchInput.tsx` were not touched**

```bash
git diff main --stat -- "lib/report-print.ts" "components/reports/ReportSearchInput.tsx"
```

Expected: no output — this plan never touches either file.

- [ ] **Step 5: Manual end-to-end walkthrough with a real divergence**

Using the same technique as every prior cluster of this effort (deliberately edit ONLY a dev-DB product's base selling unit barcode, leaving `products.sku`/`products.barcode` untouched, to prove each report reads the intended column):

```sql
UPDATE product_selling_units
SET barcode = 'TESTBARCODE992'
WHERE product_id = '<a standard product id with sales/purchase history>' AND is_base = 1;
```

1. `/reports/sales/by-product`, `/reports/sales/top-sales`, `/reports/sales/top-volume`, `/reports/sales/profit-margin`: for a date range covering that product's sales, confirm the Barcode column shows `TESTBARCODE992` and search for it finds the row.
2. `/reports/purchases/by-product`: for a date range covering a PO for that product, confirm the sub-line shows `TESTBARCODE992`.
3. `/reports/sales/batch-profit`: confirm searching `TESTBARCODE992` finds the product's batch rows (if that product has batch-tracked sale_items in the test range).
4. `/reports/expiring-soon`: if that product has an expiring batch, confirm the table shows `TESTBARCODE992` under the renamed "Barcode" header.
5. `/reports/velocity` and `/reports/cost-vs-retail`: no visible check possible (both removed the field entirely) — confirm both pages simply load without error for that product's data.
6. Revert the test value afterward:

```sql
UPDATE product_selling_units
SET barcode = '<original value>'
WHERE product_id = '<the id>' AND is_base = 1;
```

- [ ] **Step 6: No commit for this task** (verification only — if any step fails, return to the relevant task above and fix before proceeding)
