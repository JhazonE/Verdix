# Product Selling Units — Design

**Date:** 2026-09-10
**Status:** Design approved in principle. **Not ready for implementation — see "Before this is built".**
**Supersedes:** the parent/child product family model (`2026-09-09-parent-child-reorg-design.md`,
`2026-09-09-child-units-membership-design.md`, `2026-09-10-child-units-conversion-editing-design.md`)

## The problem, measured

The catalogue holds **15,987 products**. Of those, **6,095 have packaging encoded in their name** —
"7 Up 1ltr 1cs 12s", "Nescafe Classic Refill 20g 1cs 60s" — while **15,985 are labelled
`unit_of_measure = 'Pieces'`**. Only **4 products** use the parent/child family feature at all.

The packaging is in the name because there has never been anywhere else to put it.

The consequence is visible in real data. "Nescafe Classic Refill 20g" exists as four separate
product rows:

| Name | Barcode | Price | Stock |
|---|---|---|---|
| Nescafe Classic Refill 20g | 4800361339186 | 27.05 | its own |
| Nescafe Classic Refill 20g 1cs 60s | 10000000026676 | 1591.50 | its own |
| Nescafe Classic Refill 20g 2s Free1 SkyFlakes 25g | 6302025003 | 54.60 | its own |
| Nescafe Classic Refill 20g 1s Save P3 | 4800361428675 | 23.90 | its own |

Each carries an independent stock count, and none knows about the others. **Selling one case does
not reduce the piece count.** Inventory for such an item is wrong the moment either row moves.

The parent/child family feature was built to solve this and did not: it requires a "parent" product,
hides members behind a dialog, and — critically — gives every member *its own* `stock` column that
`lib/family-sync.ts` must continuously reconcile. Five numbers that must agree is five chances to
disagree.

## The goal

One product. One stock figure. Many ways to sell it.

"Nescafe Classic Refill 20g" becomes a single product holding **1,200 pieces**, with three selling
units: 1 piece (₱27.05), a 60-piece case (₱1,591.50), a 2-piece promo (₱54.60) — each with its own
barcode. Scanning the case barcode sells one case and deducts 60 pieces.

## Non-goals

- No change to BIR invoice numbering, VAT computation, or Z/X-reading logic.
- No change to how costing works within a batch (`lib/batch-deduction.ts` still depletes FIFO).
- Promo bundles that mix *different* products ("3s + Free Rebisco Crkr") are **not** selling units of
  one product. They are out of scope and remain separate products.

---

## 1. The model

```sql
CREATE TABLE product_selling_units (
  id            VARCHAR(100) PRIMARY KEY,
  product_id    VARCHAR(50)  NOT NULL,
  name          VARCHAR(100) NOT NULL,   -- 'Piece', 'Case of 60'
  barcode       VARCHAR(100) NULL,
  factor        DECIMAL(12,4) NOT NULL,  -- base units per one of these
  cost          DECIMAL(12,4) NULL,
  price         DECIMAL(12,4) NOT NULL,
  is_base       TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_barcode (barcode),
  UNIQUE KEY uniq_product_unit (product_id, name),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
```

**`products.stock` remains the single stock figure, always in base units.** No selling unit carries
stock. This is the whole point: there is nothing to synchronise, so nothing can fall out of sync.
`lib/family-sync.ts` is deleted rather than reworked.

Exactly one unit per product has `is_base = 1` and `factor = 1`. Selling a unit deducts
`quantity × factor` from `products.stock`.

**`barcode` is UNIQUE across the table** — a scan must resolve to exactly one selling unit.
`products.barcode` has no unique index today, so the migration must surface duplicates rather than
fail halfway (see §4).

## 2. What this replaces

`products.parent_id`, `conversion_factors`, and `lib/family-sync.ts` all go. So does the child-units
dialog and the membership work built on it.

That is roughly three plans' worth of shipped code. It is the right call anyway: that machinery
serves 4 products, and this serves 6,095. But it is not a small deletion, and §5 says why this spec
should not be implemented immediately.

## 3. Blast radius

`parent_id` / family-sync are consumed by at least twelve modules:

`app/api/pos/checkout/route.ts`, `app/api/pos/void-transaction/route.ts`,
`app/api/sales/returns/route.ts`, `app/api/sales/invoices/[id]/void/route.ts`,
`app/api/sales/orders/[id]/route.ts`, `app/api/sales/orders/[id]/deliver/route.ts`,
`app/api/inventory/adjust/bulk/route.ts`, `app/api/inventory/transfer/bulk/route.ts`,
`app/api/stock-adjustments/route.ts`, `app/(app)/inventory/history/actions.ts`,
`app/(app)/products/actions.ts`, `lib/bad-order-actions.ts`.

Each currently cascades a stock change through a family. Each becomes a single
`stock -= quantity × factor`.

**Every one of those paths is simpler afterward.** That is the argument for doing this: the change
removes a subsystem rather than adding one. It is also why it cannot be done piecemeal — the two
models cannot both own stock at once.

**POS checkout and returns touch BIR-significant totals.** Per `CLAUDE.md`, that logic is legally
significant. The migration must not alter any recorded sale, and Z-reading output must be
byte-identical before and after for the same data.

## 4. Migration

The 4 existing families convert mechanically: the root becomes the product, each child becomes a
selling unit carrying its `barcode`/`cost`/`price` and the `conversion_factors` factor. One of the
4 currently holds `stock = -624`; negative stock must be carried across unchanged, not silently
corrected — an inventory number nobody explained is not this migration's to fix.

**The 6,095 name-encoded products are NOT migrated automatically.** Deciding that "Nescafe … 1cs 60s"
is a selling unit of "Nescafe …" and not its own product is a judgement about the user's catalogue,
and a wrong guess merges two products' stock irreversibly. Those are converted by hand, or by a
separate opt-in tool with a preview — never as a side effect of this migration.

Duplicate barcodes must be reported before the `UNIQUE` index is added, with the offending rows
listed, so the user resolves them deliberately.

## 5. Before this is built

**This spec should not go straight to an implementation plan.** Three things are unresolved, and
each changes the design:

1. **Which products actually need this.** 6,095 have packaging in their names, but that count comes
   from a name regex, not from the user. The real number — and whether promo bundles ("2s Free1
   SkyFlakes") count — decides whether the by-hand conversion in §4 is an afternoon or a month.
2. **What happens to the 6,095 names.** Does "Nescafe Classic Refill 20g 1cs 60s" keep its name as a
   selling unit label, or does the product become plain "Nescafe Classic Refill 20g" with a "Case of
   60" unit? This affects every report and receipt the user reads.
3. **How reporting should treat units.** Does a sales report show 1 case or 60 pieces? Both are
   defensible; the answer shapes the query layer.

It also touches POS checkout and returns, which are BIR-significant. That work deserves a fresh
session with a full context budget — not the tail end of one that has already shipped three plans.

**Recommendation:** confirm §5's three questions with the user, then write the implementation plan
in a new session.
