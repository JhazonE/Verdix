# Inventory Selling Units — Design

**Date:** 2026-09-30
**Status:** Approved in conversation; implemented directly at the user's request.

## Scope

Bring selling units to three inventory surfaces: Stock Levels, Stock Counts, Repackaging.
`products.stock` stays a single figure in base units; nothing here adds stock columns.

## Shared helper — `lib/unit-quantity.ts` (pure)

- `splitIntoUnits(baseQty, units)` → largest-unit-first breakdown, e.g. 132 with Case(24)/Piece(1) → `[{Case,5},{Piece,12}]`. Fractional remainders stay on the base unit.
- `formatUnitBreakdown(...)` → `"5 Case + 12 Piece"`; products with only a base unit format as today's plain figure.
- `sumToBase(entries, units)` → base total of per-unit entries (counter enters 2 Case + 5 Piece).

## 1. Stock Levels

Product row/card shows the mixed-unit string. Expanding shows every selling unit with equivalent quantity, cost and price. Sorting, badges, reorder point stay on base units. Display only.

## 2. Stock Counts

Each count row gets one input per selling unit; the screen sums to base units and sends `counted_quantity` in base units, so the items PUT, completion route, movement-aware baseline and variance math are unchanged. Snapshot, counted and variance render in mixed-unit format; PDF/print likewise. The typed breakdown is not stored.

## 3. Repackaging

The two-product wizard is replaced by a single-product form: product + from-unit + qty + to-unit. Expected output = `qty × fromFactor ÷ toFactor`. Stock does not change (shared figure). The operation is logged in `repackaging_logs` (new columns `source_selling_unit_*`, `target_selling_unit_*` — id/name/factor snapshots) and honours the `REPACKAGING` approval setting. Optional **actual pieces obtained**: a shortfall vs expected is written off as a shrinkage stock adjustment with a stock movement. Old logs and `breakPack` stay in place, unreachable from the page.

## Non-goals

Transfers, adjustments, bulk adjustment, batch board, POS, dropping `parent_id`/`conversion_factors`.

## Testing

Unit tests for the helper; e2e for a repackaging break-down and a mixed-unit stock count.
