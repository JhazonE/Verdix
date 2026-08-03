# Bulk Price Update — Design

**Date:** 2026-08-03
**Status:** Approved for planning

## Summary

Add two ways to change **selling price, cost, markup%, and/or price-level prices** for many products at once, scoped to one warehouse at a time:

1. **"Bulk Update Price" drawer** — opened from the Products page. Filter/select products, pick an adjustment type (percentage, fixed amount, set exact value, or recalculate from markup%) and a target field, preview old→new values, submit.
2. **"Upload Price List" screen** — a dedicated page. Download an Excel template pre-filled with the chosen warehouse's SKU/barcode/name/current price/cost/markup%, edit it, re-upload. Rows are matched by SKU (falling back to barcode), diffed, and previewed the same way as the drawer.

Both funnel into one submission pipeline that reuses the app's existing generic multi-level approval engine (`approval_queue` / `approval_workflows` / `approval_history`, `lib/approvals.ts`) as a new `PRICE_UPDATE` transaction type — gated by a new `require_price_update_confirmation` toggle in `pos_settings`, exactly like `PRODUCT_CREATE`, `REPACKAGING`, `SHELF_TRANSFER`, etc. When the toggle is off (default) or no workflow is configured for the type, changes apply immediately — the existing safe fallback shared by every transaction type, no special-casing needed.

**No new database tables.** `approval_queue.transaction_data` (JSON) holds the batch of {productId, sku, name, field, oldValue, newValue} rows, the same way `PRODUCT_CREATE`/`STOCK_ADJUSTMENT` already store their payloads.

## Decisions

| Question | Decision |
|---|---|
| Scope | Both a manual drawer and an Excel upload path, sharing one submission/approval pipeline. |
| Fields | Selling price, cost, markup%, and price levels (tiered/wholesale pricing). **Note:** products have no persisted `markup` column (`lib/types.ts:1-16` — only `price` and `cost`); "markup%" is a computation mode that derives a new `price` from the product's current `cost`, not a stored field of its own. Category/brand/subcategory `markupPercentage` columns are unrelated defaults used elsewhere (add/edit product forms) and are not touched by this feature. |
| Approval | New `PRICE_UPDATE` transaction type in the existing approval engine, gated by a new `require_price_update_confirmation` master switch (same pattern as `PRODUCT_CREATE`). Both entry points feed the **same** approval queue/type. |
| Warehouse scope | Bulk price update operates on **one warehouse at a time** (products are per-warehouse rows in this app — matches existing behavior elsewhere). |
| Family-linked products | **No cascade.** Family sync (`lib/family-sync.ts`) is stock-only today; bulk price update stays that way. A parent and its children must each be selected/uploaded explicitly if both need updating. |
| Excel template columns | SKU/Barcode + selling price + cost + markup% only. **Price levels are drawer-only** for v1 — a spreadsheet row doesn't map cleanly onto a variable-length list of price-level entries per product. Blank cells in the template mean "no change to that field." |
| Excel upload UI | A **new purpose-built screen**, not the existing Guided Import Wizard (`components/import-wizard/ImportWizard.tsx`). The wizard is built for creating/updating raw product records, not for showing an old→new diff that feeds an approval batch. |
| Computation formula | `price = cost * (1 + markup / 100)`, rounded to 2 decimals — identical to the formula already used in add/edit product forms (`app/(app)/products/add-product/use-add-product-form.ts:364`), so results match single-product editing. |
| Computation timing | Preview at submission time uses live data at that moment. **The actual change is recomputed server-side against live product data again at approval time** (not the submission-time snapshot) — cost can drift between submit and approve (e.g. a new PO lands), and markup-based recalculation should use current cost. The approval card shows a drift warning if live values differ from what was originally previewed. |
| Partial-batch failures | Invalid/unmatched rows (Excel) are **skipped, not blocking** — the rest of the batch proceeds. Skipped rows are listed with a reason at preview time. Matches how bulk stock adjustment already treats per-line failures. |

## Existing pattern being followed

The codebase already runs this exact flow for product creation, repackaging, and shelf transfers:

1. `lib/approvals.ts` → `checkApprovalRequired(txType)` reads the master switch column from `pos_settings`, then checks a workflow is defined for that type.
2. The action takes an `isInternalFinalization` flag; when false and approval is required, it calls `submitToApprovalQueue(txType, txData, userId)` and returns `{ success: true, pendingApproval: true, queueId, message }` instead of applying the change.
3. `app/api/approvals/process/route.ts` dispatches on `transaction_type` at final approval and re-invokes the same action with `isInternalFinalization = true`.

`PRICE_UPDATE` slots into all three, following `PRODUCT_CREATE`'s migration/settings pattern (`scripts/migrations/097_add_product_approval_setting.ts`) as the direct template.

## Changes

### 1. Settings toggle

**Migration** `scripts/migrations/107_add_price_update_approval_setting.ts` (copy `097_add_product_approval_setting.ts`):
- `up()`: add `require_price_update_confirmation BOOLEAN NOT NULL DEFAULT FALSE` to `pos_settings`, guarded by an `INFORMATION_SCHEMA.COLUMNS` existence check.
- `down()`: drop the column, same guard.

**`app/api/pos-settings/route.ts`** — register alongside the other `require_*` toggles:
- Ensure-columns list (~line 31): `{ name: 'require_price_update_confirmation', type: 'BOOLEAN DEFAULT FALSE' }`
- SELECT alias (~line 146): `require_price_update_confirmation AS requirePriceUpdateConfirmation,`
- INSERT column list (~line 251): add `require_price_update_confirmation`
- POST body value (~line 307): `body.requirePriceUpdateConfirmation ?? false,`
- Save key-map (~line 382): `requirePriceUpdateConfirmation: 'require_price_update_confirmation',`

**`app/(app)/settings/pos-setup/pos-setup-types.ts`** — add `requirePriceUpdateConfirmation?: boolean` to `PosSettings` (~line 58) and its default `false` (~line 133).

**`app/(app)/settings/pos-setup/TransactionConfirmationsCard.tsx`** — add one entry to `CONFIRMATIONS` (~line 20):
```
{ key: 'requirePriceUpdateConfirmation', label: 'Bulk Price Update Approval',
  desc: 'Require multi-level approval before bulk price changes are applied' },
```

**`lib/approvals.ts`** — add to `settingsMap` (~line 16):
```
'PRICE_UPDATE': 'require_price_update_confirmation',
```

### 2. Shared submission helper

**New file `lib/price-update-actions.ts`**:

```ts
export interface PriceUpdateItem {
  productId: string;
  sku: string;
  barcode: string;
  productName: string;
  field: 'price' | 'cost' | 'priceLevel';
  priceLevelId?: string;      // only when field === 'priceLevel'
  oldValue: number;
  newValue: number;
  // For markup-recalc rows, carry enough to recompute at approval time:
  recalcFromMarkup?: { targetMarkupPct: number };
}

export async function submitPriceUpdateBatch(
  warehouseId: string,
  items: PriceUpdateItem[],
  userId: string,
  isInternalFinalization: boolean = false,
): Promise<{ success: boolean; pendingApproval?: boolean; queueId?: string | null; applied?: number; skipped?: { item: PriceUpdateItem; reason: string }[] }>
```

- When `!isInternalFinalization`: `checkApprovalRequired('PRICE_UPDATE')` → if required, `submitToApprovalQueue('PRICE_UPDATE', { warehouseId, items }, userId)` and return `{ pendingApproval: true, queueId }`.
- Otherwise (or when called with `isInternalFinalization = true` from the approval finalizer): for each item, **re-fetch the live product row**, recompute `newValue` for `recalcFromMarkup` items from live cost, skip the item (with a reason) if the product no longer exists/is archived, then apply all surviving updates inside a single `withTransaction`. Percentage/fixed/exact-value items apply their stored `newValue` directly since those aren't cost-dependent — no recompute needed for them.
- Price-level items update the relevant `product_price_levels` row (same table `ManagePriceLevelsDialog.tsx` already edits per-product).

### 3. Finalization dispatch

**`app/api/approvals/process/route.ts`** — add a branch alongside `SHELF_TRANSFER`/`PRODUCT_CREATE`:
```ts
} else if (item.transaction_type === 'PRICE_UPDATE') {
  const { submitPriceUpdateBatch } = await import('@/lib/price-update-actions');
  const puResult = await submitPriceUpdateBatch(txData.warehouseId, txData.items, item.created_by, true);
  result = { success: puResult.success, error: (puResult as any).error || '' };
}
```

### 4. Approvals queue UI

**`app/(app)/approvals/page.tsx`** (and its card-rendering helpers) — add a `PRICE_UPDATE` case showing a table of `productName / sku` → old value → new value, grouped by field, with a count summary ("42 products, selling price"). Follows the existing per-type card pattern already used for `STOCK_ADJUSTMENT`/`PURCHASE_ORDER`. If any item's live value has drifted from what's stored in `transaction_data` (checked read-only at render time, not mutated), show a small "changed since submission" badge on that row.

### 5. Bulk Update Price drawer

New route/component under `app/(app)/products/bulk-price-update/` (sibling to the existing `add-product/`, `edit-product/`, `price-levels/` dialogs), opened from a toolbar button on `app/(app)/products/page.tsx`.

- Warehouse picker (defaults to current context if the app already has one selected elsewhere).
- Product filters (category, supplier, brand) + checkbox selection on the filtered list — reuses the existing products list/query, just adding checkboxes.
- Adjustment panel: target field (Selling Price / Cost / Markup% recalculation / a specific Price Level — markup-recalc option only shown when target is Selling Price), adjustment type (%, fixed ₱, exact value), value input.
- Client-side preview table (old → new, computed with the same formula as the server) before submit.
- Submit calls `submitPriceUpdateBatch(warehouseId, items, userId)`; shows "submitted for approval" vs. "applied" toast depending on `pendingApproval`.

### 6. Upload Price List screen

New route under `app/(app)/products/bulk-price-update/upload/` (or a tab within the same drawer/page — implementation detail for the plan).

- Warehouse picker → "Download Template" button generates an `.xlsx` via the existing `xlsx` package, columns: `sku, barcode, name (readonly), current_price (readonly), current_cost (readonly), current_markup_pct (readonly), new_price, new_cost, new_markup_pct` for that warehouse's active products.
- File upload (`<input type="file" accept=".xlsx,.xls,.csv">`, matching the existing plain-input pattern in `CsvImportExportSection.tsx`) → parsed with `lib/import/parse-file.ts`'s `parseFile()`.
- Server-side matching/validation endpoint (new `app/api/products/bulk-price-update/parse/route.ts`) returns matched rows (with old→new diff) and skipped rows (with reasons): unmatched SKU/barcode, non-numeric or negative values, duplicate SKU (last wins, earlier flagged superseded).
- Preview screen (same visual pattern as the drawer's preview table) lists matched changes and a collapsible "N rows skipped" section.
- Submit calls the same `submitPriceUpdateBatch`.

## Out of scope (YAGNI)

- Bulk price-level updates via Excel (drawer only, v1).
- Cascading price changes to family-linked products.
- Cross-warehouse matching in a single Excel upload (one file = one warehouse).
- A dedicated price-change history/audit table — `approval_queue` + `approval_history` already retain the who/when/what (old→new per item in `transaction_data`), which is sufficient; a separate audit table would duplicate that.
- Drag-and-drop upload (no existing pattern for it in the codebase; plain file input matches current conventions).

## Testing

- **Unit:**
  - `lib/price-update-actions.ts` adjustment-type formulas (%, fixed, exact, markup-recalc) + 2-decimal rounding, including negative-percentage and negative-fixed-amount cases.
  - Markup-recalc re-fetches live cost at finalization time rather than using the submission-time snapshot.
  - Excel row validation: unmatched SKU, unmatched barcode fallback, blank cells (no-op), non-numeric, negative, duplicate SKU.
- **Integration:**
  - Switch OFF → drawer/Excel submit applies immediately, no `approval_queue` row.
  - Switch ON, no workflow → applies immediately (existing `checkApprovalRequired` fallback).
  - Switch ON + workflow → submit returns `pendingApproval: true`; product prices unchanged until approved; approving applies all surviving items; a product deleted between submit and approve is skipped (not a hard failure).
  - Price-level items update `product_price_levels`, not the base product row.
- **E2E (Playwright):**
  - Toggle "Bulk Price Update Approval" ON → drawer: select products, apply +10%, submit → prices unchanged, item appears in Approvals → approve → prices updated.
  - Excel: download template, edit two rows (one valid, one with a bad SKU), upload → preview shows 1 matched + 1 skipped → submit → approve → only the valid row's price changed.
  - Toggle OFF → either path applies immediately with no approval-queue entry.
