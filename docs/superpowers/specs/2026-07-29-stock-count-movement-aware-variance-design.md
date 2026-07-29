# Stock Count — Movement-Aware Variance

**Date:** 2026-07-29
**Status:** Approved design, ready for planning

## Problem

A stock count freezes `snapshot_quantity` when the count is created, then computes
variance at completion time as `counted − snapshot`. Any POS sale, purchase receipt,
or transfer that happens between snapshot and count is treated as variance and
applied a second time to live stock.

Current behaviour, [`CompleteStockCountUseCase.ts:19-20`](../../../src/core/inventory/application/CompleteStockCountUseCase.ts):

```ts
if (item.snapshotQuantity !== item.countedQuantity) {
  const quantityChange = item.countedQuantity - item.snapshotQuantity;
```

The resulting delta is applied via `addFamilyStock` / `deductFamilyStock`.

### Worked example of the bug

| Time | Event | Live stock |
|---|---|---|
| 09:00 | Snapshot taken | 100 |
| 09:00–11:00 | POS sells 10 | 90 |
| 11:00 | Counter counts the shelf, finds 90 (correct) | 90 |
| 11:00 | Variance computed as `90 − 100 = −10` | |
| 11:00 | Delta applied | **80** ❌ |

Ten units vanish that were never missing — deducted once by the sale, once as
"variance." The mirror case (receiving stock mid-count) over-adds.

## Operating context

The store counts by **entering quantities directly at the shelf** on a device.
The counted number is near-real-time as of the moment it is saved, not as of the
snapshot. Movements continue during counting; the POS is not closed.

## Solution — baseline shifting

Compare the counted quantity against **what the system believed was on hand at the
moment the count was entered**, not against the stale snapshot:

```
expectedAtCountTime = snapshotQuantity + netMovements(snapshotAt → countedAt)
trueVariance        = countedQuantity − expectedAtCountTime
```

`trueVariance` is applied as a delta to live stock, exactly as today. Movements that
land *after* `countedAt` are already reflected in live stock and need no special
handling — applying a delta (rather than setting an absolute value) is what makes
this safe.

Re-running the example: `expectedAtCountTime = 100 + (−10) = 90`, so
`trueVariance = 90 − 90 = 0`. Live stock stays 90. Correct.

If 3 units were genuinely missing, the counter finds 87:
`trueVariance = 87 − 90 = −3`, live stock becomes 87. Also correct.

## Components

### 1. Migration — timestamps and numeric precision

New migration `103_stock_count_movement_aware_variance.ts`.

**`stock_count_items.counted_at TIMESTAMP NULL`** — when this line's quantity was
entered. Deliberately *not* `updated_at`: that column moves on any UPDATE, including
ones unrelated to counting, so it cannot anchor the baseline window.

**`stock_counts.snapshot_at TIMESTAMP NULL`** — lower bound of the window,
backfilled from `created_at`. Making it explicit avoids overloading `created_at`
with meaning it may not keep.

**`snapshot_quantity` and `counted_quantity`: `INT` → `DECIMAL(15,4)`.**
`family-sync` divides by `factorToRoot` and works in fractional root units, so
integer columns silently truncate counts of repacked goods. In scope because it is
the same correctness defect in the same code path.

Backfill for existing rows: `counted_at = updated_at` where `counted_quantity IS NOT
NULL`. Imperfect for historical rows but only affects counts that are still
`in_progress` at deploy time; completed counts never re-read it.

### 2. `lib/stock-count-baseline.ts` — new module

One job: net stock movement for a product within a window.

```ts
export async function getNetMovementSince(
  productId: string,
  from: Date,
  to: Date,
  excludeReferenceId: string,
  connection: PoolConnection
): Promise<number>
```

Paired with a pure companion that holds all the decision logic, so it can be
tested without a database — this repo's unit tests never open a connection:

```ts
export function computeTrueVariance(input: {
  snapshotQuantity: number;
  countedQuantity: number;
  liveStock: number;
  netMovementToCount: number;
  netMovementToNow: number;
}): { variance: number; baseline: number; usedFallback: boolean }
```

Sums `quantity_change` from `stock_movements` where `product_id = ?` and
`created_at > from AND created_at <= to`.

**Excludes movements whose `reference_id` is the stock count itself**, so a count
that is completed twice (or completed after a partial failure) cannot fold its own
adjustments into the baseline.

Queries the **counted product's own** `product_id`, not the family root.
`addFamilyStock` / `deductFamilyStock` recurse and write a movement row per node
([`family-sync.ts:108,163`](../../../lib/family-sync.ts)), so each product's own
movements are complete on its own `product_id`.

Testable standalone — no stock count needed to exercise it.

### 3. `CompleteStockCountUseCase` — use the baseline

Replace the `counted − snapshot` computation. Per item:

1. Skip if `countedQuantity` is null (unchanged behaviour).
2. If `counted_at` is null, fall back to `snapshotQuantity` as the baseline — this
   is the current behaviour and is correct for a count entered with no intervening
   movements.
3. Otherwise compute `expectedAtCountTime` via `getNetMovementSince`.
4. `trueVariance = countedQuantity − expectedAtCountTime`; skip when zero.
5. Apply through the existing `findUltimateRoot` + `addFamilyStock` /
   `deductFamilyStock` path, unchanged.

The delta-application mechanism is already right; only its input was wrong.

**Safety net.** The baseline is only trustworthy if `stock_movements` recorded every
mutation of `products.stock`. Concretely, if the log is complete then

```
snapshotQuantity + netMovements(snapshotAt → now) == liveStock
```

must hold. Evaluate this at completion time per item. If the two sides differ by
more than a small epsilon (`0.0001`, for `DECIMAL` rounding), the log has gaps for
that product: fall back to `liveStock` as the baseline — matching today's
effective behaviour for that item — and log a warning naming the product and the
discrepancy.

`updateStockAndRecordMovement` is used consistently in the paths reviewed, but a
bypass elsewhere would otherwise corrupt the baseline silently.

### 4. `items` route — stamp `counted_at` only on real change

[`items/route.ts:27-32`](../../../app/api/inventory/stock-counts/[id]/items/route.ts)
must set `counted_at = NOW()`, but **only when the quantity actually changed**:

```sql
UPDATE stock_count_items
SET counted_quantity = ?,
    variance = (? - snapshot_quantity),
    counted_at = CASE
      WHEN counted_quantity IS NULL OR counted_quantity <> ? THEN NOW()
      ELSE counted_at
    END
WHERE id = ? AND stock_count_id = ?
```

**This guard is what makes the fix work at all.** The client resends *every* counted
item on each save, not just edited ones
([`use-count-detail.ts:64-66`](<../../../app/(app)/inventory/stock-counts/[id]/use-count-detail.ts>)),
and `handleComplete` PUTs all items immediately before completing
([`use-count-detail.ts:93-99`](<../../../app/(app)/inventory/stock-counts/[id]/use-count-detail.ts>)).
An unconditional `counted_at = NOW()` would stamp every line at completion time,
collapse every baseline window to zero, and reproduce the original bug exactly.

The `variance` column stays `counted − snapshot`. It is display-only; the *applied*
variance is derived at completion. Keeping it avoids touching the review UI.

### 5. Manual and user guide

Neither [`scripts/manual/content.ts`](../../../scripts/manual/content.ts) (Chapter 4,
"Running a stock count") nor [`docs/USER_GUIDE.md`](../../USER_GUIDE.md) says
anything about counting while the POS is live — the gap that prompted this work.
Both get a short note stating that counting during business hours is supported,
that movements during the count are excluded from variance, and that quantities
should be entered at the shelf rather than encoded from a paper tally hours later
(which would make the timestamps inaccurate).

## Out of scope

Surfacing "movements since count" in the review dialog. The user chose silent
auto-correction: staff work normally and the system reconciles. Revisit if managers
ask why an applied variance differs from the on-screen figure.

## Testing

**Unit — `getNetMovementSince`:** no movements; sale only; mixed sale + purchase;
movement outside the window on both edges; movement referencing the stock count
itself (must be excluded).

**Integration — the bug:** snapshot → simulate POS sale → enter count matching
physical reality → complete → assert live stock unchanged and no adjustment
movement written.

**Integration — regression:** snapshot → no movements → count with a genuine
variance → assert the variance still applies exactly as before.

**Integration — combined:** snapshot → sale of 10 → count 3 short of reality →
assert exactly −3 is applied, not −13.

**Fractional:** count a repacked child product with a non-integer factor to root;
assert no truncation now that columns are `DECIMAL`.

[`scripts/verify_stock_count_fix.ts`](../../../scripts/verify_stock_count_fix.ts) is
an HTTP smoke script that ends in a manual-verification prompt and asserts nothing
about final stock. It does not cover this bug and should not be relied on; the new
integration tests replace its role.
