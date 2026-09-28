# Purchase Order Selling Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a purchase order line be entered and received in any of a product's selling units (e.g. "2 Case" instead of "48 pcs"), with cost/price entered in that unit's own terms, while `inventory_batches`, `products.stock`, `products.cost`/`.price`, and price levels keep receiving base-unit (piece) values exactly as they do today.

**Architecture:** Add `selling_unit_id`/`selling_unit_name`/`selling_unit_factor` to `purchase_order_items` (denormalized snapshot, same pattern as `sale_items`). Extend the PO product search to list one suggestion row per selling unit (mirroring POS's `expandToUnitSuggestions`/`rankMatches`), seed new PO lines from that unit's own cost/price, and insert one conversion step at the two places (`calculatePurchaseCosts`, `processPurchaseOrderReceipt`) where PO-entered values cross into base-unit-contracted tables.

**Tech Stack:** Next.js 16 (App Router), TypeScript, MySQL 8 (raw `mysql2/promise`), React Hook Form + Zod, Playwright e2e (port 3100, `verdix_test` DB).

**Spec:** [docs/superpowers/specs/2026-09-28-purchase-order-selling-units-design.md](../specs/2026-09-28-purchase-order-selling-units-design.md)

## Global Constraints

- No unit test framework is wired up for `lib/*.ts` in this repo — all verification of `lib/purchase-utils.ts` and `lib/purchase-actions.ts` logic goes through Playwright e2e tests hitting the real API against `verdix_test`, matching `tests/e2e/purchase-order.spec.ts`'s existing convention.
- `inventory_batches`, `products.stock`, FIFO deduction (`lib/batch-deduction.ts`), and stock movements (`lib/stock-movements.ts`) are NEVER given unit/factor awareness — they only ever receive already-converted base-unit numbers.
- New `purchase_order_items` columns are nullable in schema but a backfill migration must leave no existing row NULL (spec requires backfill-to-base-unit, NOT the "NULL means base" convention migration 120 used for `sale_items` — do not copy that pattern here).
- "No computed multiples": a selling unit's cost/price is always read from its own `product_selling_units` row (or its own PO-line snapshot), never derived by multiplying the base unit's cost/price by a factor.
- POS's cart/checkout code (`app/(app)/pos/**`) is out of scope — do not modify it. Bad Orders' product selector (`app/(app)/purchases/bad-orders/**`) is out of scope.
- Follow existing migration conventions: `registerMigration`, `up()`/`down()`, guard with an `INFORMATION_SCHEMA.COLUMNS` existence check before `ALTER TABLE` (see `scripts/migrations/120_add_selling_unit_to_line_items.ts`).

## Review Focus

- **Product with only a base selling unit** (the overwhelmingly common case today): search must still show exactly one suggestion row, `handleAddProduct` must still seed cost/price from `product.cost`/`product.price` unchanged, and the receiving math must produce byte-identical results to before this feature (factor 1 is a no-op).
- **Scanning a non-base unit's own barcode** (e.g. a printed Case barcode) in the PO search box: must resolve directly to that unit via `handleScanOrPunch`, not fall through to the base unit or "no match."
- **Editing an existing PO** (`editOrder` path) created before this feature shipped: its items have no `sellingUnitId` in the DB; the edit form must treat that as base unit (factor 1) without crashing or mis-seeding cost/price from `undefined`.
- **Receiving a PO with a fractional-quantity Case line and a shipping fee**: landed cost allocation must still sum correctly across mixed-unit lines on the same PO (e.g. one Piece line + one Case line), since `calculatePurchaseCosts` divides shipping by line count, not by base-unit quantity.
- **The read-only Print/View PO table** (`po-items-table.tsx`) hardcodes `"pc"` as the unit label and does not pass `sellingUnitFactor` into its landed-cost preview — a Case-priced PO would silently show a wrong landed cost and a misleading unit label if this isn't fixed alongside the write path.

---

## File Structure

**New files:**
- `scripts/migrations/131_add_selling_unit_to_purchase_order_items.ts` — schema migration
- `scripts/migrations/132_backfill_purchase_order_items_selling_unit.ts` — backfill migration

**Modified files:**
- `lib/purchase-utils.ts` — `PurchaseItem` type + `calculatePurchaseCosts` conversion
- `lib/purchase-actions.ts` — `processPurchaseOrderCreation` (insert columns), `processPurchaseOrderReceipt` (conversion + insert)
- `app/api/purchase-orders/route.ts` — GET list: select + map new columns
- `app/api/purchase-orders/[id]/route.ts` — PUT: insert new columns
- `app/(app)/purchases/actions.ts` — `getPurchaseCostDetails`: select new column
- `lib/types.ts` — `Product['sellingUnits']` (no change needed, already present), `PurchaseOrder['items']` — add 3 fields
- `app/(app)/purchases/add-purchase-order/purchase-order-schema.ts` — Zod schema: add 3 fields
- `app/(app)/purchases/add-purchase-order/product-selector.tsx` — per-unit suggestions + scan matching
- `app/(app)/purchases/add-purchase-order/use-add-purchase-order.ts` — `handleAddProduct` signature + seeding, edit/reorder mapping
- `app/(app)/purchases/add-purchase-order/add-purchase-order-dialog.tsx` — pass selected unit through to `handleAddProduct`, show unit name in Product column
- `app/(app)/purchases/view-purchase-order/po-items-table.tsx` — real unit label + factor-aware landed cost
- `tests/e2e/fixtures/test-data.ts` — new fixture product with a Case selling unit
- `tests/e2e/setup/prepare-test-db.ts` — seed the new fixture's Case selling unit row
- `tests/e2e/purchase-order.spec.ts` — new test: order/receive by non-base selling unit

---

### Task 1: Schema migration — add selling unit columns to `purchase_order_items`

**Files:**
- Create: `scripts/migrations/131_add_selling_unit_to_purchase_order_items.ts`

**Interfaces:**
- Produces: `purchase_order_items.selling_unit_id VARCHAR(100) NULL`, `.selling_unit_name VARCHAR(100) NULL`, `.selling_unit_factor DECIMAL(12,4) NULL` — consumed by every later task that reads/writes this table.

- [ ] **Step 1: Write the migration**

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Records which selling unit a PO line was ordered/received in (e.g. Case
 * vs Piece), mirroring migration 120's sale_items columns. Unlike 120,
 * existing rows here are backfilled to the base unit in migration 132
 * rather than left NULL — a PO's landed-cost/receiving math needs a
 * concrete factor to convert by, so "NULL means base" would require every
 * consumer to re-derive that fallback instead of reading it once.
 */
async function hasColumn(column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_items' AND COLUMN_NAME = ?`,
    [column],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '131_add_selling_unit_to_purchase_order_items',
  timestamp: '2026-09-28_09-00-00',

  async up(): Promise<void> {
    if (await hasColumn('selling_unit_id')) {
      console.log('⏭️  purchase_order_items already has selling unit columns, skipping');
      return;
    }
    await query(`
      ALTER TABLE purchase_order_items
        ADD COLUMN selling_unit_id     VARCHAR(100)  NULL,
        ADD COLUMN selling_unit_name   VARCHAR(100)  NULL,
        ADD COLUMN selling_unit_factor DECIMAL(12,4) NULL
    `);
    console.log('✅ purchase_order_items: added selling unit columns');
  },

  async down(): Promise<void> {
    if (!(await hasColumn('selling_unit_id'))) return;
    await query(`
      ALTER TABLE purchase_order_items
        DROP COLUMN selling_unit_id,
        DROP COLUMN selling_unit_name,
        DROP COLUMN selling_unit_factor
    `);
    console.log('✅ purchase_order_items: dropped selling unit columns');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Run the migration against the dev DB**

Run: `npm run migrate`
Expected: Output includes `✅ purchase_order_items: added selling unit columns`

- [ ] **Step 3: Verify the columns exist**

Run (PowerShell, adjust credentials to your `.env`): `mysql -u root -p verdix -e "DESCRIBE purchase_order_items;"`
Expected: `selling_unit_id`, `selling_unit_name`, `selling_unit_factor` present, all nullable.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/131_add_selling_unit_to_purchase_order_items.ts
git commit -m "migrate: add selling unit columns to purchase_order_items"
```

---

### Task 2: Backfill migration — set existing rows to their product's base unit

**Files:**
- Create: `scripts/migrations/132_backfill_purchase_order_items_selling_unit.ts`

**Interfaces:**
- Consumes: `purchase_order_items.selling_unit_id/name/factor` (Task 1), `product_selling_units` (existing table, `is_base = 1` rows from migration 119).
- Produces: every existing `purchase_order_items` row has non-NULL `selling_unit_factor` when its product has a base selling unit.

- [ ] **Step 1: Write the migration**

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Backfills existing purchase_order_items to their product's base selling
 * unit. Every pre-existing row's quantity/cost was always implicitly a
 * base-unit (factor 1) value, so this only fills metadata — no quantity or
 * cost value changes.
 *
 * A product with no base selling unit row (would predate migration 119,
 * or the product was hard-deleted after the PO was placed) is left NULL;
 * every downstream reader treats NULL factor as 1, so this is safe.
 */
const migration: Migration = {
  name: '132_backfill_purchase_order_items_selling_unit',
  timestamp: '2026-09-28_09-05-00',

  async up(): Promise<void> {
    const result: any = await query(`
      UPDATE purchase_order_items poi
      JOIN product_selling_units psu
        ON psu.product_id = poi.product_id AND psu.is_base = 1
      SET
        poi.selling_unit_id = psu.id,
        poi.selling_unit_name = psu.name,
        poi.selling_unit_factor = psu.factor
      WHERE poi.selling_unit_id IS NULL
    `);
    console.log(`✅ backfilled ${result.affectedRows ?? 0} purchase_order_items rows to base selling unit`);
  },

  async down(): Promise<void> {
    await query(`
      UPDATE purchase_order_items
      SET selling_unit_id = NULL, selling_unit_name = NULL, selling_unit_factor = NULL
    `);
    console.log('✅ cleared purchase_order_items selling unit backfill');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Run the migration**

Run: `npm run migrate`
Expected: Output includes `✅ backfilled N purchase_order_items rows to base selling unit` (N ≥ 0).

- [ ] **Step 3: Verify no existing row is left NULL where a base unit exists**

Run: `mysql -u root -p verdix -e "SELECT COUNT(*) FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id JOIN product_selling_units psu ON psu.product_id = p.id AND psu.is_base = 1 WHERE poi.selling_unit_id IS NULL;"`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/132_backfill_purchase_order_items_selling_unit.ts
git commit -m "migrate: backfill purchase_order_items selling unit to base unit"
```

---

### Task 3: `calculatePurchaseCosts` — factor-aware landed cost

**Files:**
- Modify: `lib/purchase-utils.ts:8-119`
- Test: `tests/e2e/purchase-order.spec.ts` (new test added in Task 9 exercises this; no standalone unit test file per Global Constraints)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `PurchaseItem.sellingUnitFactor?: number`; `CalculatedPurchaseDetails.items[].landedCostPerUnit` is now expressed **per base unit** (divided by factor) while `lineTotal`/`shippingAllocation`/`landedCostTotal` stay in as-entered (selling-unit) terms. Consumed by Task 4 (`processPurchaseOrderReceipt`) and Task 8 (`po-items-table.tsx`).

- [ ] **Step 1: Add `sellingUnitFactor` to `PurchaseItem` and convert `landedCostPerUnit`**

Edit `lib/purchase-utils.ts`:

```typescript
export interface PurchaseItem {
  productId: string;
  productName: string;
  quantity: number;
  cost: number;
  discount?: number;
  discountType?: 'amount' | 'percentage';
  vatSubject?: boolean;
  /** Base units per selling unit this line was entered in. Defaults to 1 (base unit) when absent. */
  sellingUnitFactor?: number;
}
```

Then, inside `calculatePurchaseCosts`, in the `itemsWithLandedCost` map (replace the existing block):

```typescript
  const itemsWithLandedCost = processedItems.map(item => {
    let shippingAllocation = 0;

    if (numericShippingFee > 0) {
      if (allocationStrategy === 'proportional' && subtotal > 0) {
        // Allocation method: Proportional to line total / subtotal
        shippingAllocation = (item.lineTotal / subtotal) * numericShippingFee;
      } else {
        // Allocation method: Divided equally by the number of item lines (not total quantity).
        shippingAllocation = numLines > 0 ? numericShippingFee / numLines : 0;
      }
    }

    const landedCostTotal = item.lineTotal + shippingAllocation;
    // landedCostPerUnit must land in BASE-UNIT terms: inventory_batches.unit_cost
    // and products.cost are both contractually per-piece, so a Case-priced line's
    // per-Case landed cost is divided by its factor before this field is used
    // anywhere downstream (see processPurchaseOrderReceipt). lineTotal and
    // landedCostTotal are deliberately left in as-entered (per-Case) terms since
    // they reconcile against subtotal/grandTotal, which are also as-entered.
    const factor = toSafeNumber((item as any).sellingUnitFactor) || 1;
    const landedCostPerUnit = item.quantity > 0 ? (landedCostTotal / item.quantity) / factor : 0;

    return {
      ...item,
      shippingAllocation,
      landedCostTotal,
      landedCostPerUnit,
    };
  });
```

- [ ] **Step 2: Manually verify with a quick script**

Run (PowerShell): `npx tsx -e "const {calculatePurchaseCosts} = require('./lib/purchase-utils'); console.log(calculatePurchaseCosts([{productId:'p1',productName:'Case Item',quantity:2,cost:1200,sellingUnitFactor:24}], 0).items[0].landedCostPerUnit)"`
Expected: `50` (₱1200/Case ÷ 24 pcs/Case = ₱50/pc)

- [ ] **Step 3: Verify factor-1 (no selling unit) is unchanged**

Run: `npx tsx -e "const {calculatePurchaseCosts} = require('./lib/purchase-utils'); console.log(calculatePurchaseCosts([{productId:'p1',productName:'Piece Item',quantity:5,cost:18}], 0).items[0].landedCostPerUnit)"`
Expected: `18` (unchanged from pre-existing behavior)

- [ ] **Step 4: Commit**

```bash
git add lib/purchase-utils.ts
git commit -m "feat: make calculatePurchaseCosts convert landed cost to base-unit terms"
```

---

### Task 4: `processPurchaseOrderReceipt` — convert quantity/price at the receiving boundary

**Files:**
- Modify: `lib/purchase-actions.ts:91-125` (item insert in `processPurchaseOrderCreation`), `lib/purchase-actions.ts:142-262` (`processPurchaseOrderReceipt`)

**Interfaces:**
- Consumes: `calculatePurchaseCosts` (Task 3) — `landedCostPerUnit` already per-piece.
- Produces: `inventory_batches.quantity_in`/`.quantity_remaining` receive `quantity × factor`; `inventory_batches.selling_price`, `products.cost`/`.price`, and the default price-level write all receive per-piece values. This is the boundary Task 9's e2e test asserts against.

- [ ] **Step 1: Persist the new columns on item creation**

In `lib/purchase-actions.ts`, update the insert query and loop inside `processPurchaseOrderCreation`:

```typescript
    const insertItemQuery = `
      INSERT INTO purchase_order_items (
        id, purchase_order_id, product_id, product_name, quantity, cost,
        selling_price, discount, discount_type, vat_subject, subtotal,
        selling_unit_id, selling_unit_name, selling_unit_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const item of items) {
      const itemId = `poi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const quantity = toSafeNumber(item.quantity);
      const cost = toSafeNumber(item.cost);
      const discount = toSafeNumber(item.discount);
      const discountType = item.discountType || 'amount';

      let itemSubtotal = quantity * cost;
      if (discountType === 'percentage') {
        itemSubtotal = itemSubtotal - (itemSubtotal * (discount / 100));
      } else {
        itemSubtotal = itemSubtotal - discount;
      }

      await connection.query(insertItemQuery, [
        itemId,
        orderId,
        item.productId,
        item.productName,
        quantity,
        cost,
        item.sellingPrice ? toSafeNumber(item.sellingPrice) : null,
        discount,
        discountType,
        item.vatSubject ? 1 : 0,
        itemSubtotal,
        item.sellingUnitId || null,
        item.sellingUnitName || null,
        item.sellingUnitFactor ? toSafeNumber(item.sellingUnitFactor) : null,
      ]);
    }
```

- [ ] **Step 2: Select the new columns for landed-cost recalculation**

In `processPurchaseOrderReceipt`, update the item-fetch query:

```typescript
    const [itemRows]: any = await connection.query(
      'SELECT product_id as productId, product_name as productName, quantity, cost, selling_price as sellingPrice, discount, discount_type as discountType, vat_subject as vatSubject, selling_unit_factor as sellingUnitFactor FROM purchase_order_items WHERE purchase_order_id = ?',
      [orderId]
    );
```

- [ ] **Step 3: Convert quantity and selling price at the receiving boundary**

Replace the body of the per-item loop's quantity/price handling in `processPurchaseOrderReceipt` (the block starting at `const quantityAdded = ...`):

```typescript
      const factor = toSafeNumber(receivedItem.sellingUnitFactor ?? itemRows.find((i: any) => i.productId === receivedItem.productId)?.sellingUnitFactor) || 1;

      // Convert once, at the boundary into base-unit-contracted tables
      // (inventory_batches, products.stock/cost/price, price levels).
      // Everything past this point is unchanged from before this feature.
      const quantityAdded = toSafeNumber(receivedItem.quantity) * factor;
      if (quantityAdded <= 0) continue;

      const landedCost = toSafeNumber(calculatedItem.landedCostPerUnit); // already per-piece (Task 3)
      const rawSellingPrice = toSafeNumber(receivedItem.sellingPrice || itemRows.find((i: any) => i.productId === receivedItem.productId)?.sellingPrice);
      const sellingPrice = rawSellingPrice / factor;
```

- [ ] **Step 4: Verify `sellingUnitFactor` reaches `calculatePurchaseCosts` unmodified via the existing spread**

The existing call a few lines above (`const calculations = calculatePurchaseCosts(itemRows.map((i: any) => ({ ...i, vatSubject: i.vatSubject === 1 })), shipping, 12, allocationStrategy || 'equal');`) does NOT need to change: `itemRows` now includes `sellingUnitFactor` from Step 2's updated SELECT, and the `{ ...i, vatSubject: ... }` spread carries every field of `i` through untouched — including `sellingUnitFactor` — into what `calculatePurchaseCosts` (Task 3) reads as `item.sellingUnitFactor`. Confirm this by reading the spread line and Task 3's `PurchaseItem.sellingUnitFactor` field name match exactly (`sellingUnitFactor`, camelCase) — a mismatched alias here would silently make every Case-priced receipt compute its landed cost as if factor were 1.

- [ ] **Step 5: Verify no other reads of `quantity`/`sellingPrice` in this function bypass the conversion**

Read through `processPurchaseOrderReceipt` end-to-end after the edit (`lib/purchase-actions.ts`) and confirm:
- The `products` UPDATE (`cost`, `price`) uses `finalCost`/`finalPrice`, which are `Math.max(existing, landedCost)` / `Math.max(existing, sellingPrice)` — both already-converted per-piece values. No change needed there beyond the upstream `landedCost`/`sellingPrice` now being correct.
- The `inventory_batches` INSERT uses `quantityAdded` and `landedCost` and `sellingPrice` — all now converted.
- `updateStockAndRecordMovement` receives `quantityAdded` — converted.
- The default price-level write uses `finalPrice` — already converted upstream.

Expected: no other line in the function reads `receivedItem.quantity` or `receivedItem.sellingPrice` directly.

- [ ] **Step 6: Commit**

```bash
git add lib/purchase-actions.ts
git commit -m "feat: convert PO selling-unit quantity/price to base units at receipt"
```

---

### Task 5: API routes — persist and return the new columns

**Files:**
- Modify: `app/api/purchase-orders/route.ts:79-129` (GET list)
- Modify: `app/api/purchase-orders/[id]/route.ts:137-163` (PUT update)
- Modify: `app/(app)/purchases/actions.ts:24-41` (`getPurchaseCostDetails`)

**Interfaces:**
- Consumes: `purchase_order_items.selling_unit_id/name/factor` (Task 1).
- Produces: `PurchaseOrder.items[].sellingUnitId/sellingUnitName/sellingUnitFactor` available to the frontend (Task 6), and `PurchaseItem.sellingUnitFactor` fed correctly into `calculatePurchaseCosts` from the view-PO cost-preview action.

- [ ] **Step 1: GET list — select and map the new columns**

In `app/api/purchase-orders/route.ts`, update the `itemsQuery`:

```sql
        const itemsQuery = `
          SELECT
            poi.id,
            poi.product_id,
            poi.product_name,
            poi.quantity,
            poi.cost,
            poi.selling_price,
            poi.discount,
            poi.discount_type,
            poi.vat_subject,
            poi.selling_unit_id,
            poi.selling_unit_name,
            poi.selling_unit_factor,
            p.barcode,
            p.stock as current_stock,
            poi.subtotal
          FROM purchase_order_items poi
          LEFT JOIN products p ON poi.product_id = p.id
          WHERE poi.purchase_order_id = ?
          ORDER BY poi.created_at ASC
        `;
```

And the `items.map(...)`:

```typescript
          items: items.map((item: any) => ({
            productId: item.product_id,
            productName: item.product_name,
            quantity: toSafeNumber(item.quantity),
            cost: toSafeNumber(item.cost),
            sellingPrice: item.selling_price ? toSafeNumber(item.selling_price) : undefined,
            discount: item.discount ? toSafeNumber(item.discount) : 0,
            discountType: item.discount_type || 'amount',
            vatSubject: item.vat_subject === 1,
            barcode: item.barcode || undefined,
            currentStock: toSafeNumber(item.current_stock),
            sellingUnitId: item.selling_unit_id || undefined,
            sellingUnitName: item.selling_unit_name || undefined,
            sellingUnitFactor: item.selling_unit_factor ? toSafeNumber(item.selling_unit_factor) : undefined,
          })),
```

- [ ] **Step 2: PUT update — persist the new columns**

In `app/api/purchase-orders/[id]/route.ts`, update the insert:

```typescript
        const insertItemQuery = `
          INSERT INTO purchase_order_items (
            id, purchase_order_id, product_id, product_name, quantity, cost,
            selling_price, discount, discount_type, vat_subject, expiration_date,
            selling_unit_id, selling_unit_name, selling_unit_factor
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const item of items) {
          const itemId = `poi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await connection.query(insertItemQuery, [
            itemId,
            id,
            item.productId,
            item.productName,
            toSafeNumber(item.quantity),
            toSafeNumber(item.cost),
            item.sellingPrice ? toSafeNumber(item.sellingPrice) : null,
            toSafeNumber(item.discount),
            item.discountType || 'amount',
            item.vatSubject ? 1 : 0,
            item.expirationDate ? new Date(item.expirationDate).toISOString().slice(0, 10) : null,
            item.sellingUnitId || null,
            item.sellingUnitName || null,
            item.sellingUnitFactor ? toSafeNumber(item.sellingUnitFactor) : null,
          ]);
        }
```

- [ ] **Step 3: `getPurchaseCostDetails` — select the factor for cost-preview recalculation**

In `app/(app)/purchases/actions.ts`, update the items query:

```typescript
    const itemsResult = await query(
      `SELECT 
        product_id as productId, 
        product_name as productName, 
        quantity, 
        cost, 
        discount, 
        discount_type as discountType, 
        vat_subject as vatSubject,
        selling_unit_factor as sellingUnitFactor
      FROM purchase_order_items 
      WHERE purchase_order_id = ?`,
      [orderId]
    );
```

- [ ] **Step 4: Restart dev server and manually verify the API returns the new fields**

Run: `npm run dev` (if not already running), then in another terminal: `curl "http://localhost:3000/api/purchase-orders?limit=1"`
Expected: JSON response's `data[0].items[0]` includes `sellingUnitId`/`sellingUnitName`/`sellingUnitFactor` keys (values may be `undefined`/omitted for pre-backfill rows, or a base-unit id/name/`1` for backfilled rows).

- [ ] **Step 5: Commit**

```bash
git add app/api/purchase-orders/route.ts app/api/purchase-orders/[id]/route.ts "app/(app)/purchases/actions.ts"
git commit -m "feat: thread selling unit columns through PO read/write API routes"
```

---

### Task 6: Types and Zod schema — add selling unit fields

**Files:**
- Modify: `lib/types.ts:186-201` (`PurchaseOrder['items']`)
- Modify: `app/(app)/purchases/add-purchase-order/purchase-order-schema.ts:3-17` (`purchaseOrderItemSchema`)

**Interfaces:**
- Produces: `PurchaseOrder.items[].sellingUnitId?: string`, `.sellingUnitName?: string`, `.sellingUnitFactor?: number`; `PurchaseOrderFormValues.items[].sellingUnitId?/sellingUnitName?/sellingUnitFactor?` — consumed by Tasks 7 and 8.

- [ ] **Step 1: Extend the `PurchaseOrder` type**

In `lib/types.ts`, inside the `PurchaseOrder.items` array type (around line 191-201), add:

```typescript
  items: {
    productId: string;
    productName: string;
    quantity: number;
    cost: number;
    sellingPrice?: number;
    discount?: number;
    discountType?: 'amount' | 'percentage';
    vatSubject?: boolean;
    expirationDate?: string;
    barcode?: string;
    currentStock?: number;
    /** Selling unit this line was ordered/received in, snapshotted at order time. Absent/1 means base unit. */
    sellingUnitId?: string;
    sellingUnitName?: string;
    sellingUnitFactor?: number;
  }[];
```

(Keep whatever fields already exist after `barcode?: string;` — this adds three new optional fields without removing any existing ones. Check the current file contents at that line range before editing, since fields beyond line 201 were truncated in this plan's research and must be preserved as-is.)

- [ ] **Step 2: Extend the Zod item schema**

In `app/(app)/purchases/add-purchase-order/purchase-order-schema.ts`:

```typescript
export const purchaseOrderItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  cost: z.coerce.number().nonnegative(),
  sellingPrice: z.coerce.number().nonnegative().optional(),
  discount: z.coerce.number().nonnegative().optional(),
  discountType: z.enum(['amount', 'percentage']).optional(),
  vatSubject: z.boolean().optional(),
  barcode: z.string().optional(),
  currentStock: z.coerce.number().optional(),
  avgDailySales: z.coerce.number().optional(),
  reorderPoint: z.coerce.number().optional(),
  expirationDate: z.string().optional(),
  sellingUnitId: z.string().optional(),
  sellingUnitName: z.string().optional(),
  sellingUnitFactor: z.coerce.number().positive().optional(),
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No new errors introduced (existing pre-existing errors from the red baseline, if any, are unrelated — compare against a `git stash` baseline if unsure).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts "app/(app)/purchases/add-purchase-order/purchase-order-schema.ts"
git commit -m "feat: add selling unit fields to PurchaseOrder type and PO item schema"
```

---

### Task 7: Product search — one suggestion row per selling unit

**Files:**
- Modify: `app/(app)/purchases/add-purchase-order/product-selector.tsx` (whole file)

**Interfaces:**
- Consumes: `Product.sellingUnits[]` (existing type, `lib/types.ts:53-63`).
- Produces: `onSelectProduct(product: Product, unit?: Product['sellingUnits'][number]): void` — new second parameter consumed by Task 8.

- [ ] **Step 1: Add unit-expansion and unit-aware matching helpers**

Add above the `ProductSelector` function in `product-selector.tsx`:

```typescript
type SellingUnit = NonNullable<Product['sellingUnits']>[number];

// Mirrors POS's expandToUnitSuggestions (app/(app)/pos/pos-content/use-pos.ts):
// a product with more than one selling unit renders as one row per unit so a
// Case and a Piece are two distinct, individually-priced choices instead of
// one ambiguous row that always adds the base unit.
function expandToUnitSuggestions(products: Product[]): { product: Product; unit?: SellingUnit }[] {
  const rows: { product: Product; unit?: SellingUnit }[] = [];
  for (const product of products) {
    const units = product.sellingUnits || [];
    if (units.length > 1) {
      for (const unit of units) rows.push({ product, unit });
    } else {
      rows.push({ product, unit: units[0] });
    }
  }
  return rows;
}

// Mirrors POS's matchesProductOrUnitCode: an exact scan/enter match also
// checks every non-base selling unit's own barcode, so scanning a Case's
// printed barcode resolves straight to that unit.
function findExactUnitMatch(products: Product[], code: string): { product: Product; unit?: SellingUnit } | undefined {
  const needle = code.toLowerCase();
  for (const product of products) {
    const units = product.sellingUnits || [];
    const baseUnit = units.find((u) => u.isBase);
    if (
      product.barcode?.toLowerCase() === needle ||
      baseUnit?.barcode?.toLowerCase() === needle ||
      product.name.toLowerCase() === needle
    ) {
      return { product, unit: baseUnit };
    }
    const nonBaseMatch = units.find((u) => !u.isBase && u.barcode?.toLowerCase() === needle);
    if (nonBaseMatch) return { product, unit: nonBaseMatch };
  }
  return undefined;
}
```

- [ ] **Step 2: Update `onSelectProduct` prop type and the scan/select call sites**

```typescript
export function ProductSelector({
  onSelectProduct,
  supplierId,
}: {
  onSelectProduct: (product: Product, unit?: SellingUnit) => void;
  supplierId?: string;
}) {
```

Replace `handleScanOrPunch`'s match logic:

```typescript
  const handleScanOrPunch = async () => {
    const code = inputValue.trim();
    if (!code) return;
    setIsScanning(true);
    try {
      const params = new URLSearchParams({ search: code, limit: '25' });
      if (supplierId) params.append('supplierId', supplierId);
      const res = await fetch(getApiUrl(`/products?${params.toString()}`), { cache: 'no-store' });
      const result = await res.json();
      if (!result.success) return;
      const matches: Product[] = (result.data || [])
        .map(mapApiProduct)
        .filter((p: Product) => p.type !== 'service');

      const match = findExactUnitMatch(matches, code);
      if (match) {
        onSelectProduct(match.product, match.unit);
        setInputValue('');
        setSuggestionsOpen(false);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const selectProduct = (product: Product, unit?: SellingUnit) => {
    onSelectProduct(product, unit);
    setInputValue('');
    setSuggestionsOpen(false);
  };
```

- [ ] **Step 3: Render one row per selling unit in the suggestion list**

Replace the `CommandGroup` rendering block:

```tsx
                <CommandEmpty>No products found.</CommandEmpty>
                <CommandGroup>
                  {expandToUnitSuggestions(products).map(({ product, unit }) => (
                    <CommandItem
                      key={unit ? `${product.id}:${unit.id}` : product.id}
                      value={unit ? `${product.id}:${unit.id}` : product.id}
                      onSelect={() => selectProduct(product, unit)}
                    >
                      <div className="flex flex-col w-full">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-foreground">
                            {product.name}
                            {unit && !unit.isBase && (
                              <span className="ml-1.5 text-xs font-semibold text-blue-600">— {unit.name}</span>
                            )}
                          </span>
                          {unit && (
                            <span className="font-mono text-xs text-muted-foreground shrink-0">
                              ₱{Number(unit.cost ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground font-medium">
                          Barcode: {unit?.barcode || product.sellingUnits?.find((u) => u.isBase)?.barcode || product.barcode || 'N/A'} | Stock:{' '}
                          {formatQuantity(product.stock)}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
```

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: No new errors in `product-selector.tsx`.

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`, navigate to Purchases → Add New Purchase Order, select a supplier, and search for a product known to have both a base and a non-base selling unit (or create one via Edit Product → Selling Units tab first). Confirm the dropdown shows two distinct rows, each with its own cost.
Expected: two rows visible, e.g. "ProductName" and "ProductName — Case", each showing a different ₱ cost.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/purchases/add-purchase-order/product-selector.tsx"
git commit -m "feat: expand PO product search to one suggestion row per selling unit"
```

---

### Task 8: PO line seeding — carry the selected unit into the form

**Files:**
- Modify: `app/(app)/purchases/add-purchase-order/use-add-purchase-order.ts:260-357` (`handleAddProduct`, edit/reorder mapping)
- Modify: `app/(app)/purchases/add-purchase-order/add-purchase-order-dialog.tsx` (call site + Product column display)

**Interfaces:**
- Consumes: `ProductSelector`'s `onSelectProduct(product, unit)` (Task 7); `PurchaseOrderFormValues.items[].sellingUnitId/Name/Factor` (Task 6).
- Produces: `handleAddProduct(product: Product, unit?: SellingUnit): void` — the dialog's only call site is updated in this task, so no other consumer exists.

- [ ] **Step 1: Update `handleAddProduct` to accept and seed from a selling unit**

In `use-add-purchase-order.ts`, replace `handleAddProduct`:

```typescript
  function handleAddProduct(product: Product, unit?: NonNullable<Product['sellingUnits']>[number]) {
    const resolvedUnit = unit ?? product.sellingUnits?.find((u) => u.isBase);
    const existingItemIndex = fields.findIndex(
      (field) => field.productId === product.id && (field.sellingUnitId || undefined) === (resolvedUnit?.id || undefined),
    );
    if (existingItemIndex !== -1) {
      const existingItem = fields[existingItemIndex];
      update(existingItemIndex, { ...existingItem, quantity: existingItem.quantity + 1 });
    } else {
      append({
        productId: product.id,
        productName: product.name,
        quantity: 1,
        // "No computed multiples": a unit's own cost/price is used as-is,
        // never derived from the base unit's cost/price times its factor.
        cost: resolvedUnit?.cost ?? product.cost ?? 0,
        sellingPrice: resolvedUnit?.price ?? product.price ?? 0,
        discount: 0,
        discountType: 'amount',
        vatSubject: product.vatStatus === 'Vatable' || product.vatStatus === 'Yes' || false,
        barcode: resolvedUnit?.barcode || product.barcode || '',
        currentStock: product.stock || 0,
        avgDailySales: product.avgDailySales || 0,
        reorderPoint: product.reorderPoint || 0,
        expirationDate: '',
        sellingUnitId: resolvedUnit?.id,
        sellingUnitName: resolvedUnit?.name,
        sellingUnitFactor: resolvedUnit?.factor ?? 1,
      });
    }
  }
```

- [ ] **Step 2: Carry the historical unit forward on edit/reorder**

In the `editOrder` items-mapping block (`form.reset({ ..., items: editOrder.items.map(...) })`), add the three fields from the historical PO row (not re-resolved from current product state, per the spec's edge-case note):

```typescript
        items: editOrder.items.map((item) => {
          const currentProduct = products.find((p) => p.id === item.productId);
          return {
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            cost: item.cost,
            sellingPrice: (item as any).sellingPrice ?? currentProduct?.price ?? 0,
            discount: item.discount || 0,
            discountType: 'amount' as const,
            vatSubject: false,
            expirationDate: '',
            currentStock: currentProduct ? currentProduct.stock : 0,
            barcode: currentProduct ? currentProduct.barcode : '',
            sellingUnitId: (item as any).sellingUnitId,
            sellingUnitName: (item as any).sellingUnitName,
            sellingUnitFactor: (item as any).sellingUnitFactor ?? 1,
          };
        }),
```

And the same three fields in the `reorderData` items-mapping block just below it:

```typescript
      const updatedItems = reorderData.items.map((item) => {
        const currentProduct = products.find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          cost: item.cost,
          sellingPrice: currentProduct ? currentProduct.price : 0,
          discount: item.discount || 0,
          discountType: (item.discountType as 'amount' | 'percentage') || 'amount' as const,
          vatSubject: false,
          expirationDate: '',
          currentStock: currentProduct ? currentProduct.stock : 0,
          barcode: currentProduct ? currentProduct.barcode : '',
          sellingUnitId: (item as any).sellingUnitId,
          sellingUnitName: (item as any).sellingUnitName,
          sellingUnitFactor: (item as any).sellingUnitFactor ?? 1,
        };
      });
```

- [ ] **Step 3: Update the dialog's call site and Product column display**

In `add-purchase-order-dialog.tsx`, update the `ProductSelector` usage:

```tsx
                <ProductSelector
                  onSelectProduct={handleAddProduct}
                  supplierId={form.watch('supplierId')}
                />
```

(If the existing call site already passes `onSelectProduct={handleAddProduct}` with matching arity, no change is needed beyond the type update — `handleAddProduct`'s new optional second parameter is backward compatible with a single-argument caller. Verify by reading the current call site before editing; only change it if the prop is wrapped in an arrow function that drops the second argument, e.g. `onSelectProduct={(p) => handleAddProduct(p)}`, in which case change it to `onSelectProduct={handleAddProduct}` or `onSelectProduct={(p, u) => handleAddProduct(p, u)}`.)

In the Product column cell (around line 396-401), show the unit name when it isn't the base unit:

```tsx
                                <TableCell className="font-medium pl-4 py-2 border-r">
                                  <span className="font-bold text-sm text-foreground">
                                    {field.productName}
                                    {field.sellingUnitName && field.sellingUnitFactor !== 1 && (
                                      <span className="ml-1.5 text-xs font-semibold text-blue-600">— {field.sellingUnitName}</span>
                                    )}
                                  </span>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="font-mono font-bold">{field.barcode || '-'}</span>
                                  </div>
                                </TableCell>
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, add a Case-unit suggestion row from Task 7 to a new PO. Confirm the table row shows "ProductName — Case" and the Cost/Sell Price inputs are prefilled with the Case's own cost/price (not the base unit's).
Expected: matches description above.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/purchases/add-purchase-order/use-add-purchase-order.ts" "app/(app)/purchases/add-purchase-order/add-purchase-order-dialog.tsx"
git commit -m "feat: seed PO lines from the selected selling unit's own cost/price"
```

---

### Task 9: Fix the read-only Print/View PO table's unit label and landed cost

**Files:**
- Modify: `app/(app)/purchases/view-purchase-order/po-items-table.tsx`

**Interfaces:**
- Consumes: `PurchaseOrder.items[].sellingUnitName/Factor` (Task 6), `calculatePurchaseCosts` (Task 3, already factor-aware once `sellingUnitFactor` is passed through).

- [ ] **Step 1: Pass `sellingUnitFactor` into the cost calculation and replace the hardcoded "pc" label**

Replace the relevant parts of `po-items-table.tsx`:

```tsx
          {order.items.map((item, index) => {
            const product = products.find((p) => p.id === item.productId);
            const currentStock = product ? product.stock : (item.currentStock || 0);
            const results = calculatePurchaseCosts(
              order.items.map((i) => ({ ...i, sellingUnitFactor: (i as any).sellingUnitFactor })) as any,
              order.shippingFee || 0,
            );
            const landedCost = results.items[index]?.landedCostPerUnit || 0;
            const unitLabel = (item as any).sellingUnitName || 'pc';

            return (
              <TableRow key={index} className="hover:bg-zinc-50 border-zinc-300">
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm text-zinc-900">{item.productName}</span>
                    <div className="flex items-center gap-2 text-xs text-zinc-700">
                      <span className="font-mono font-bold">{item.barcode || '-'}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center text-zinc-900 font-bold">
                  <span className={currentStock <= 0 ? 'text-destructive font-black' : ''}>
                    {formatQuantity(currentStock)}
                  </span>
                </TableCell>
                <TableCell className="text-right text-zinc-900 font-bold">
                  ₱{item.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right text-zinc-900 font-bold">
                  {formatQuantity(item.quantity)} <span className="text-xs text-zinc-700">{unitLabel}</span>
                </TableCell>
```

(Leave the remaining cells — Landed Cost, Total, Qty Recv — unchanged; `landedCost` and `item.cost * item.quantity` already compute correctly once `results` is factor-aware and `item.cost` is understood as "per the displayed unit.")

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors.

- [ ] **Step 3: Manual verification**

Open a PO containing a Case line in the View Purchase Order screen (or Print view). Confirm the Qty column shows "— Case" instead of "pc", and the Landed Cost column shows a per-piece figure consistent with Task 3's conversion (cross-check against the value computed manually: `(cost × qty + shippingAllocation) / qty / factor`).
Expected: matches description above.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/purchases/view-purchase-order/po-items-table.tsx"
git commit -m "fix: show real selling unit label and factor-aware landed cost in PO view table"
```

---

### Task 10: E2E test — order and receive a product by a non-base selling unit

**Files:**
- Modify: `tests/e2e/fixtures/test-data.ts` — new fixture product + Case unit constant
- Modify: `tests/e2e/setup/prepare-test-db.ts` — seed the Case selling unit row
- Modify: `tests/e2e/purchase-order.spec.ts` — new test

**Interfaces:**
- Consumes: everything from Tasks 1-5 (schema, receiving conversion, API routes).

- [ ] **Step 1: Add the fixture product and its Case unit constant**

In `tests/e2e/fixtures/test-data.ts`, after `PO_PRODUCT` (around line 359):

```typescript
/**
 * Product para sa selling-unit PO test: naay Case unit (factor 24) ibabaw sa
 * iyang base Piece unit, aron ma-verify nga ang pag-order/receive per-Case
 * mo-convert og husto padulong sa base-unit (piece) figures.
 */
export const PO_CASE_PRODUCT = {
  id: 'test-po-case-product-1',
  name: 'PO Case Item',
  sku: 'PO-CASE-001',
  price: 5, // per-piece price (base unit)
  cost: 3,  // per-piece cost (base unit)
  stock: 0,
  supplierId: TEST_SUPPLIER.id,
};

export const PO_CASE_UNIT = {
  id: 'psu_case_test-po-case-product-1',
  name: 'Case',
  factor: 24,
  cost: 60,   // ₱60/Case = ₱2.50/pc — deliberately different from base unit's own cost
  price: 100, // ₱100/Case = ~₱4.17/pc
};
```

- [ ] **Step 2: Seed the fixture product and its Case selling unit**

In `tests/e2e/setup/prepare-test-db.ts`, add the product insert next to the existing `PO_PRODUCT` insert (around line 308-313):

```typescript
  // Product para sa selling-unit PO test (naay Case unit ibabaw sa base Piece).
  await conn.query(
    `INSERT INTO products (id, name, price, cost, stock, sku, supplier_id, availability)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Available')`,
    [PO_CASE_PRODUCT.id, PO_CASE_PRODUCT.name, PO_CASE_PRODUCT.price, PO_CASE_PRODUCT.cost, PO_CASE_PRODUCT.stock, PO_CASE_PRODUCT.sku, PO_CASE_PRODUCT.supplierId],
  );
```

Then, **after** the existing base-selling-units backfill block (after the `INSERT INTO product_selling_units ... SELECT ... FROM products p WHERE NOT EXISTS (...)` statement, since that statement gives `PO_CASE_PRODUCT` its base Piece unit automatically), add the Case unit row:

```typescript
  // Case unit for PO_CASE_PRODUCT, on top of the base Piece unit it just got above.
  await conn.query(
    `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 0)`,
    [PO_CASE_UNIT.id, PO_CASE_PRODUCT.id, PO_CASE_UNIT.name, PO_CASE_UNIT.factor, PO_CASE_UNIT.cost, PO_CASE_UNIT.price],
  );
```

Add `PO_CASE_PRODUCT, PO_CASE_UNIT` to the existing `import { ... } from '../fixtures/test-data'` list at the top of the file.

- [ ] **Step 3: Write the e2e tests**

In `tests/e2e/purchase-order.spec.ts`, add both tests below (after the existing "highest wins" test, update the import line to include `PO_CASE_PRODUCT, PO_CASE_UNIT`):

```typescript
  test('Receive PO by selling unit: Case quantity/cost convert to base-unit pieces', async ({ request }) => {
    const reference = `PO-CASE-E2E-${Date.now()}`;

    const res = await request.post('/api/purchase-orders', {
      data: {
        supplierId: TEST_SUPPLIER.id,
        supplierName: TEST_SUPPLIER.name,
        date: new Date().toISOString(),
        paymentMethod: TEST_PAYMENT_METHOD.name,
        purchaseType: 'Receive',
        status: 'Received',
        reference,
        receiveToWarehouse: TEST_WAREHOUSE.id,
        receiveToWarehouseName: TEST_WAREHOUSE.name,
        shipping: 0,
        orderedBy: DEFAULT_ADMIN.displayName,
        items: [
          {
            productId: PO_CASE_PRODUCT.id,
            productName: PO_CASE_PRODUCT.name,
            quantity: 2, // 2 Cases
            cost: PO_CASE_UNIT.cost, // ₱60/Case
            sellingPrice: PO_CASE_UNIT.price, // ₱100/Case
            discount: 0,
            discountType: 'amount',
            vatSubject: false,
            sellingUnitId: PO_CASE_UNIT.id,
            sellingUnitName: PO_CASE_UNIT.name,
            sellingUnitFactor: PO_CASE_UNIT.factor,
          },
        ],
      },
    });
    expect(res.ok(), 'PO received').toBeTruthy();
    expect((await res.json()).success).toBeTruthy();

    // 2 Cases * factor 24 = 48 pieces landed in base-unit stock.
    const listRes = await request.get(`/api/products?search=${PO_CASE_PRODUCT.sku}&limit=5`);
    const listBody = await listRes.json();
    const prod = (listBody.data ?? []).find((p: any) => p.id === PO_CASE_PRODUCT.id);
    expect(prod, 'product makita sa list').toBeTruthy();
    expect(Number(prod.stock)).toBe(48);

    // ₱60/Case ÷ 24 = ₱2.50/pc landed cost. Starting cost was ₱3 (PO_CASE_PRODUCT.cost),
    // so "highest wins" keeps the higher existing cost of ₱3 rather than dropping to ₱2.50.
    expect(Number(prod.cost)).toBe(PO_CASE_PRODUCT.cost);

    // ₱100/Case ÷ 24 ≈ ₱4.17/pc, lower than the existing price of ₱5 — highest wins keeps ₱5.
    expect(Number(prod.price)).toBe(PO_CASE_PRODUCT.price);
  });

  test('Receive PO with mixed base-unit and Case lines: shipping splits per line, not per piece', async ({ request }) => {
    // Two lines on one PO, one Piece (PO_PRODUCT) and one Case (PO_CASE_PRODUCT),
    // with a shipping fee. calculatePurchaseCosts splits shipping "equally by
    // number of item lines" (2 lines -> ₱10 each), regardless of how many base
    // units each line resolves to — this must survive the factor conversion.
    const reference = `PO-MIXED-E2E-${Date.now()}`;
    const shipping = 20;

    const res = await request.post('/api/purchase-orders', {
      data: {
        supplierId: TEST_SUPPLIER.id,
        supplierName: TEST_SUPPLIER.name,
        date: new Date().toISOString(),
        paymentMethod: TEST_PAYMENT_METHOD.name,
        purchaseType: 'Receive',
        status: 'Received',
        reference,
        receiveToWarehouse: TEST_WAREHOUSE.id,
        receiveToWarehouseName: TEST_WAREHOUSE.name,
        shipping,
        orderedBy: DEFAULT_ADMIN.displayName,
        items: [
          {
            productId: PO_PRODUCT.id,
            productName: PO_PRODUCT.name,
            quantity: 1,
            cost: PO_PRODUCT.cost, // ₱18/pc, no selling unit -> factor defaults to 1
            sellingPrice: PO_PRODUCT.price,
            discount: 0,
            discountType: 'amount',
            vatSubject: false,
          },
          {
            productId: PO_CASE_PRODUCT.id,
            productName: PO_CASE_PRODUCT.name,
            quantity: 1, // 1 Case
            cost: PO_CASE_UNIT.cost, // ₱60/Case
            sellingPrice: PO_CASE_UNIT.price,
            discount: 0,
            discountType: 'amount',
            vatSubject: false,
            sellingUnitId: PO_CASE_UNIT.id,
            sellingUnitName: PO_CASE_UNIT.name,
            sellingUnitFactor: PO_CASE_UNIT.factor,
          },
        ],
      },
    });
    expect(res.ok(), 'PO received').toBeTruthy();
    expect((await res.json()).success).toBeTruthy();

    // Piece line: ₱18 cost + ₱10 shipping (half of ₱20, split by line count) = ₱28/pc landed.
    // Case line: (₱60 cost + ₱10 shipping) / 24 pcs-per-Case = ₱2.9166.../pc landed.
    // Both starting product costs (₱18 and ₱3) are lower than these landed costs,
    // so "highest wins" lets both rise to their new landed cost.
    const pieceListRes = await request.get(`/api/products?search=${PO_PRODUCT.sku}&limit=5`);
    const pieceProd = ((await pieceListRes.json()).data ?? []).find((p: any) => p.id === PO_PRODUCT.id);
    expect(pieceProd, 'piece product makita sa list').toBeTruthy();
    expect(Number(pieceProd.cost)).toBeCloseTo(28, 2);

    const caseListRes = await request.get(`/api/products?search=${PO_CASE_PRODUCT.sku}&limit=5`);
    const caseProd = ((await caseListRes.json()).data ?? []).find((p: any) => p.id === PO_CASE_PRODUCT.id);
    expect(caseProd, 'case product makita sa list').toBeTruthy();
    expect(Number(caseProd.cost)).toBeCloseTo(70 / 24, 2);
  });
```

- [ ] **Step 4: Reset and re-seed the test DB, then run the new tests**

Run: `npm run test:e2e:db`
Run: `npx playwright test tests/e2e/purchase-order.spec.ts -g "selling unit"`
Run: `npx playwright test tests/e2e/purchase-order.spec.ts -g "mixed base-unit"`
Expected: both report 1 passed.

- [ ] **Step 5: Run the full purchase-order spec to confirm no regression**

Run: `npx playwright test tests/e2e/purchase-order.spec.ts`
Expected: all tests in the file pass (5 total after this addition).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/fixtures/test-data.ts tests/e2e/setup/prepare-test-db.ts tests/e2e/purchase-order.spec.ts
git commit -m "test: add e2e coverage for ordering/receiving a PO by selling unit"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: No new errors compared to the pre-existing red baseline (see `verification-before-completion` guidance: diff against a clean `main` checkout's typecheck output if the baseline is already red, and confirm this branch introduces zero additional errors).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: No new errors in files touched by this plan.

- [ ] **Step 3: Full e2e purchase-order suite**

Run: `npm run test:e2e -- tests/e2e/purchase-order.spec.ts`
Expected: all pass.

- [ ] **Step 4: Broader e2e smoke (products/POS untouched but shares fixtures file)**

Run: `npm run test:e2e`
Expected: no new failures beyond the pre-existing flaky/known baseline (see memory: `flaky-approval-e2e-test` — bulk-price-update.spec.ts:87 is known-flaky and unrelated to this change).

- [ ] **Step 5: Manual smoke in the browser**

Run: `npm run dev`. Create a PO with one base-unit line and one Case-unit line on the same order, with a nonzero shipping fee. Submit as "Receive". Confirm:
- Both lines show correct unit labels.
- `products.stock` for the Case product increased by `quantity × 24`.
- The View Purchase Order print screen shows "Case" (not "pc") for that line and a landed cost consistent with the per-piece conversion.

Expected: matches description above; no console errors.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-28-purchase-order-selling-units.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Subagent-driven**, because the tasks form a tight interface chain (schema → conversion math → API plumbing → search UI → form seeding → display), a mistake in the middle (e.g. Task 3's factor direction) would silently corrupt `products.stock`/`.cost` for every future Case-unit receipt, and independent per-task review catches that kind of error before it compounds into later tasks rather than only at the end.
