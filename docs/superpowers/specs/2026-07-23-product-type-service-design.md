# Product Type: Standard vs Service — Design

**Date:** 2026-07-23
**Status:** Approved (pending implementation plan)

## Problem

Verdix POS treats every product as a stocked good. Every product row carries
`stock`, gets `inventory_batches` rows, participates in FIFO cost depletion, and
writes `stock_movements` on every sale.

Services (labor, delivery fees, repairs, setup fees) have none of that. Today the
only way to sell one is to create a fake standard product — see
`scripts/seed_actual_products_services.ts`, which flags services purely by
convention (`category = 'IT Services'`, `unit_of_measure = 'Service'`). Those
fake products go out of stock, appear in purchase orders and stock counts, and
distort inventory valuation reports.

## Solution Overview

Add a first-class `type` column to `products` with values `standard` and
`service`. Services are ordinary product rows — SKU, price, category, tax,
income account — that skip all stock machinery.

## 1. Data Model

New migration `101_add_product_type.ts`:

```sql
ALTER TABLE products
  ADD COLUMN type ENUM('standard','service') NOT NULL DEFAULT 'standard';
```

`down()` drops the column.

All existing rows become `'standard'` via the column default — no backfill
statement needed.

**Why ENUM over a boolean `is_service`:** leaves room for future types
(`bundle`, `non_inventory`) without another migration.

No other new tables.

### Existing services are NOT auto-converted

Products currently faking service behaviour (via `unit_of_measure = 'Service'`
or a "Services" category) stay `standard`. The user converts them manually.

Rationale: auto-detection by category/UoM string would catch genuinely stocked
products ("Service Kit", "Car Service Oil") and silently destroy their stock
tracking. A wrong guess here is a data-integrity bug; manual conversion is not.

## 2. Type Is Immutable After Creation

Type is selectable only in Add Product. In Edit Product it renders read-only
(visible but disabled).

To correct a mistake: create a new product with the right type and archive the
wrong one.

Rationale: `inventory_batches`, `stock_movements`, and the family-sync tree all
assume a product's stock behaviour is stable. Flipping type post-hoc leaves
orphaned batches and movement history that no longer reconciles against the
product.

## 3. Add Product Form

A segmented toggle sits above the tabs, not inside one — it changes the whole
form, not a single section:

```
Product Type:  [ Standard ]  [ Service ]
```

Defaults to `Standard`.

### Fields hidden when Service is selected

| Tab | Hidden |
|---|---|
| Basic Info | Barcode becomes optional (services aren't scanned) |
| Inventory | Initial Stock, Reorder Point, Supplier, Warehouse, Shelf Location, Perishable/Expiry |
| Conversion | Entire tab — services have no family/repackaging |
| Price Levels | *(unchanged — still shown)* |
| Loyalty | *(unchanged — still shown)* |

### Fields retained on the Inventory tab

Unit of Measure, Cost, Price, VAT status, Availability, Income/Expense account,
Department, Category.

**Cost is required for services.** For standard products cost is optional
(`z.coerce.number().nonnegative().optional()`) because FIFO batches supply it.
Services have no batch fallback, so a blank cost would write `NULL` to
`cost_at_sale` and break profit reporting. The service branch of the schema
makes cost required and non-negative. Zero is permitted — a pure-margin service
with no input cost is legitimate; the requirement is that the user states it
explicitly rather than leaving it blank.

**Unit of Measure has no guaranteed default.** A `Service` UoM row exists only
in `scripts/seed_actual_products_services.ts`, which is scaffold data and may
not be present in the production database. Implementation must not assume it
exists. Either seed it as part of the migration, or leave the field to the
existing `InlineEditableSelect` (which already lets the user create a UoM
inline). Prefer the latter — fewer moving parts, and it matches how every other
lookup on this form behaves.

### Schema

`app/(app)/products/add-product/product-schema.ts` becomes a discriminated union
on `type`. The service branch:

- `stock: z.literal(0).default(0)`
- `parentId`, `conversionFactor`, `conversionFactors` — forbidden

This makes a service-with-stock unrepresentable even if the UI is bypassed.

### Backend

`POST /api/products` accepts and persists `type`. The product-approval flow
(new products go through an approval queue) carries `type` through to
finalisation. When `type = 'service'`, skip creating the initial
`inventory_batches` row.

## 4. Cost / COGS

Services use a **fixed cost** from `products.cost`, entered manually on the form
(e.g. ₱200 technician labour on a ₱500 service). This field is required for
services — see §3.

On sale, `sale_items.cost_at_sale` is populated from `products.cost` instead of
from a FIFO batch weighted average. `batch_source` is `null`.

Consequence: **profit and margin reports need no changes.** They read
`sale_items.cost_at_sale` and are agnostic about its origin. The journal entry
keeps the same shape, posting COGS against the product's expense account — only
the cost source differs.

## 5. Sales Paths

There are **two** call sites that deduct stock on sale. Both need the guard; a
guard on only one leaves a hole.

| Path | File | Line |
|---|---|---|
| POS checkout | `app/api/pos/checkout/route.ts` | 159 |
| Back-office sales | `app/api/sales/transactions/route.ts` | 342 |

### POS checkout changes

The product `SELECT` at line 193 currently runs *after* `deductFromBatches` at
line 159. To know whether an item is a service before deducting, that SELECT
must move above the batch-costing block.

1. Move the product `SELECT` (line 193) up, ahead of the batch-costing block
2. Add `p.type` to its selected columns — **no extra query**, the SELECT already
   runs per item for loyalty points and `parent_id`
3. When `service`: skip `deductFromBatches`; set `costAtSale` from
   `products.cost`, `batchSource = null`
4. When `service`: skip the entire `findUltimateRoot` / `deductFamilyStock`
   block
5. Loyalty points still apply — services earn points unless `earns_points` is off

Note: the checkout path calls `deductFamilyStock` and `findUltimateRoot` (from
`lib/family-sync.ts`), not `syncFamilyStock`.

### Back-office sales changes

Same pattern, but this route has no existing per-item product SELECT, so one
must be added.

### No stock check before sale

Services are never "out of stock" and must never trip `oversellBlock`,
regardless of the batch-costing setting.

## 6. Shared Helper

New `lib/product-type.ts` exporting `isService(product)`.

Keeps `type === 'service'` from scattering across the codebase and gives a
single place to change when another type is added.

## 7. Inventory & Reports Filtering

Services must be excluded from stock-oriented surfaces:

**Excluded from product pickers:**
- Purchase orders (nothing is ordered from a supplier)
- Stock adjustment, stock count, stock transfer, bad orders, repackaging

**Excluded from low-stock / out-of-stock alerts:**
- `app/api/reports/stats/route.ts`
- `app/api/reports/inventory/route.ts`

**Excluded from stock-valuation reports** — services have ₱0 stock value and
would skew totals.

**Included normally** in sales and profit reports.

**Inventory list:** shows a `Service` badge on the row, plus a new
`All / Standard / Service` filter.

## 8. Import / Export

`app/api/data-management/import/products/route.ts` must accept the `type`
column and skip `inventory_batches` creation for imported services.

This route *inserts* batches (line 74); it does not deduct. It is not a third
sales path.

## 9. Testing

Follows the existing E2E setup: Playwright, port 3100, `workers: 1`.

### New E2E spec — `tests/e2e/product-type-service.spec.ts`

1. Create a Service in Add Product — assert Stock/Reorder/Supplier/Warehouse/
   Conversion fields are absent
2. Sell the service at POS — assert stock unchanged, no `stock_movements` row,
   and `cost_at_sale` populated from `products.cost`
3. Sell 100 units of a service with no batches — assert no oversell block
4. Assert services are absent from low-stock alerts and the purchase-order
   product picker
5. Assert type is read-only in Edit Product

### Unit tests

`lib/product-type.ts` — small and pure, tested in isolation.

### Regression guard

Existing batch-deduction and family-sync tests must pass unchanged, proving the
standard path is untouched.

## 10. Risks and Boundaries

**Primary risk — missed call sites.** The two sales paths and the two low-stock
report routes were verified by reading the code. The remaining picker exclusions
in §7 (purchase orders, stock count, transfer, repackaging, bad orders) were
derived from architecture docs, not from reading each file; the true count
surfaces during implementation. Symptom of a miss: a service appears on a stock
screen where it makes no sense — annoying, not data-corrupting.

**Out of scope:**
- Bulk conversion of existing fake-service products (manual, per §1)
- Service capacity / booking slots
- Time-based pricing

## Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Service stock behaviour | No stock tracking at all | Services are never out of stock; fake stock distorts inventory reports |
| Service COGS | Manual fixed cost on `products.cost` | Keeps profit reports and journal entries unchanged |
| Cost required for services | Yes, zero allowed | No batch fallback; blank cost would write `NULL` to `cost_at_sale` |
| Existing services | Stay `standard`, convert manually | Auto-detection by string would corrupt genuinely stocked products |
| Type mutability | Locked after creation | Batches, movements, and family tree assume stable stock behaviour |
| Column shape | `ENUM('standard','service')` | Room for future types without another migration |
