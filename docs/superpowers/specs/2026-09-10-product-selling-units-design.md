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

**No name-encoded product is merged automatically.** Deciding that "Nescafe … 1cs 60s" is a selling
unit of "Nescafe …" rather than its own product is a judgement about the user's catalogue, and a
wrong guess merges two products' stock irreversibly.

Per §5.1 the catalogue is too large to convert by hand, so this happens through the **bulk Excel
import** — but as an explicit, previewed operation the user reviews and confirms, never as a side
effect of the schema migration. The migration itself only creates one `is_base` unit per existing
product; it never merges two products.

Duplicate barcodes must be reported before the `UNIQUE` index is added, with the offending rows
listed, so the user resolves them deliberately.

## 5. Answered: the three open questions

The user answered these on 2026-09-10. They are requirements now, not open points.

### 5.1 Scope — effectively the whole catalogue

*"naa sa 15981 ka producto peru kini na data is sample palang ni."* Nearly every product needs
selling units, and the present 15,987 rows are only sample data — the real catalogue is larger.

This kills the by-hand conversion floated in §4. One-at-a-time does not survive 15,000+ products,
let alone a bigger production set. **Selling units must be creatable in bulk**, through the existing
Excel import path (`lib/price-list-import.ts` already handles 15,000-row uploads at ~18s), and the
schema must assume most products carry more than one unit.

It also makes the base-unit backfill non-optional: **every product needs an `is_base = 1` row on day
one**, or checkout has nothing to resolve. That is a migration over the entire table, not a nudge to
4 rows.

### 5.2 Names stay exactly as they are

*"magpabili lang ni nga ngalan."* "Nescafe Classic Refill 20g 1cs 60s" keeps that name. The migration
rewrites no product names, and no report or receipt changes wording.

This is the safest of the available answers — nothing already printed or filed shifts — and it
removes the biggest risk in the original draft. It does allow a product's name and its selling-unit
label to disagree (a row named "… 1cs 60s" holding a "Piece" unit); that is accepted, because the
name is what staff already recognise.

### 5.3 Sell in units, deduct in base — and the ledger must record which

*"sa sales report 1case ni siya peru pagabot sa inventory 60 ka piraso ang maminus."*

One case sells as **1 case** on the sales report and deducts **60 pieces** from inventory. This is
the sharpest of the three requirements, and it exposes something the original draft missed.

**`pos_transaction_items` records `product_id`, `quantity`, and `unit_price` — but no selling unit.**
I checked the live schema. Without a new column, "1 case" and "1 piece" are indistinguishable in
sales history, so the report cannot honour this requirement even when the deduction is correct.

The line-item tables therefore gain a nullable `selling_unit_id`, plus a denormalised
`selling_unit_name` and `factor` captured **at sale time** — so later editing a unit's factor cannot
retroactively change what a past receipt meant. Reports group by the recorded unit; inventory keeps
moving in base units.

Affected: `pos_transaction_items`, `sale_items`, `sales_invoice_items`, `sales_order_items`. Existing
rows stay `NULL`, meaning "base unit", so no historical sale changes meaning.

---

## 6. What §5's answers changed about the shape of this work

The three answers did not just fill blanks — two of them made the work bigger, and one made it
safer. Recorded here so the implementation plan starts from the real size.

**Bigger, from 5.1:** the original draft assumed a small conversion (4 families, plus optional
hand-conversion of ~6,000). The answer is "effectively all of them, and this is only sample data".
So the plan needs a full-table base-unit backfill and a bulk import path for units — not a dialog
someone clicks 15,000 times.

**Bigger, from 5.3:** the line-item tables need new columns, including two BIR-facing ones
(`sales_invoice_items`, `sale_items`). The original draft touched no sales tables at all. Capturing
`factor` at sale time is what keeps a past receipt's meaning fixed when a unit is later edited —
without it, editing a factor silently rewrites history.

**Safer, from 5.2:** names are untouched, so no printed or filed document changes. This removes the
riskiest part of the original draft.

## 7. Why this is not being implemented in the same session as the spec

Three plans shipped in this session already (the parent/child reorg, membership management, and
conversion editing). This work is larger than all three combined and, unlike them, it edits POS
checkout and returns — logic `CLAUDE.md` marks as BIR-significant, where a mistake shows up in tax
filings rather than in a test.

The specific risks a fresh session should hold full context for:

- A full-table migration that must add an `is_base` row per product without touching `products.stock`.
- Adding `UNIQUE (barcode)` when `products.barcode` has no unique index today — duplicates must be
  reported for the user to resolve, never auto-merged.
- The `-624` stock row (§4) carried across unchanged rather than quietly corrected.
- Deleting `lib/family-sync.ts` and rewriting twelve call sites that currently cascade through it.

**Recommendation:** start the implementation plan in a new session, from this spec. Nothing here is
blocked — the three shipped plans are committed, working, and unaffected by waiting.
