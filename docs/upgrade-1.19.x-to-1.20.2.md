# Upgrading an old install (1.19.8) to 1.20.2

Written for whoever runs the update on the customer's machine.

This is a **406-commit, 33-migration** jump (migrations 114 → 146). The updater
handles the sequence itself — there is no need to step through 1.19.9, 1.19.10
and so on — but two properties of the update path make an unprepared run
dangerous:

1. **Migration 119 deliberately aborts** when two `products` rows share a
   barcode. On this schema that is normal data (one `products` row per
   warehouse, and `TransferStockService` copies the barcode onto the sibling),
   so any store that has ever transferred stock will hit it.
2. **There is no way back.** `run_update.bat` overwrites the app's files
   *before* migrations run, `migrateUp()` has no outer transaction and records
   each migration as it goes, and migration 121 drops `product_price_levels`
   with a `down()` that explicitly refuses to rebuild it. A mid-way failure
   leaves the new build on a half-migrated database.

So the order below is not optional: **check, back up, then update.**

---

## 1. Pre-flight check

From the repo, pointed at the customer's database (`.env` must have their
`DB_*` values):

```bash
npm run upgrade:preflight
```

It reports four things:

| Section | What it tells you |
|---|---|
| Migration state | How many migrations are pending, and their names in run order |
| Duplicate barcodes | Splits them into safe **warehouse siblings** and genuine **conflicts** |
| Table sizes | Row counts for the four tables migration 135 rewrites — sets your downtime |
| Behaviour changes | Whether *this* install loses sidebar pages, browser POS, or gets permissions merged |

The verdict line at the bottom is the gate:

- `CLEAR TO UPDATE: N migration(s) will run.` → proceed to step 2.
- `DO NOT UPDATE YET.` → there are genuine barcode conflicts. Go to step 1a.

### 1a. Resolving duplicate barcodes

The script already separated the two cases, because they need different
handling.

**Warehouse siblings** — the same item on another shelf. Safe to clear
automatically:

```bash
npm run upgrade:preflight -- --fix
```

This NULLs `products.barcode` on the sibling rows, keeping it on one row per
group. That is the same resolution `TransferStockService` already applies when
it inserts a sibling's base selling unit, and migration 126 later backfills a
base-unit barcode from `products.sku`, so no scan code is lost. Re-run without
`--fix` to confirm the groups are clear.

**Genuine conflicts** — different items sharing a barcode, or rows with no
warehouse. `--fix` will not touch these, and it should not: deciding which item
owns a barcode is a stock-keeping decision. Fix them by hand in the Products
list, then re-run the check.

---

## 2. Back up the database

Not optional, for the reasons at the top of this file.

```bash
mysqldump -u root -p --single-transaction --routines --triggers \
  verdix > verdix_pre_1.20.2_$(date +%Y%m%d).sql
```

**Verify the dump restores** into a scratch database before you continue. An
unverified dump is not a backup.

---

## 3. Run the updater

Build it (version comes from `package.json`):

```bash
npm run build:updater     # produces VendixUpdater_1.20.2.exe
```

Run it on the terminal **off-peak**. Migration 135 runs four `ALTER TABLE`
statements that lock each table while they rewrite it; the pre-flight check's
row counts tell you how long that will take.

Then check the log:

```
C:\ProgramData\Verdix\update.log
```

Look for `🎉 Migration complete!`. If you see `FAIL: migration step returned 1`,
stop — do not start the app. Restore the step-2 dump and work out which
migration threw before trying again.

---

## 4. Post-upgrade

Three migrations change behaviour the store will notice immediately. The
pre-flight check told you which apply here; this is how to undo them.

| What changed | Fix |
|---|---|
| **Repackaging, Approvals Board, Workflow Settings gone** from the sidebar (migration 146, only on installs that never configured Page Visibility) | Developer Options → Page Visibility → re-enable |
| **POS no longer opens in a plain browser** (migration 137). Electron terminals unaffected | Developer Options → enable browser POS |
| **Per-user permissions merged into user types** (migration 130). Additive, but a grant to one user now reaches everyone sharing that type | Review Manage User Types |

Then verify, in this order:

1. Log in — confirms the licence still verifies against this machine.
2. **Ring up one sale.** The selling-units chain (118–121, 126, 131–133) is the
   most invasive part of this upgrade; a sale exercises base-unit resolution,
   price-level lookup and batch costing in one go.
3. Open Sales Transactions and confirm that sale appears with the right total.
4. Check a product's Selling Units tab — each product should have exactly one
   base unit, and existing prices should be attached to it.

---

## What the migrations actually do

For reference, the substantive groups in 114 → 146:

- **Selling units (118–121, 126, 131–133)** — the big one. Products gain
  per-unit selling definitions (Piece / Box / Case) with their own barcodes,
  costs and prices. Price levels move from per-product to per-selling-unit;
  existing prices are preserved on each product's base unit. Well guarded:
  idempotent, `INSERT IGNORE`/`NOT EXISTS`, migrates data before dropping.
- **Price tiers (128, 134)** — `min_quantity` dropped then restored, so a
  price-level row can carry a quantity break.
- **VAT on documents (123–125)** — adds VAT and cost-at-sale columns to
  invoices and orders.
- **POS auth toggles (136–139, 142)** — browser-POS switch, X/Z-reading and
  discount credential prompts, price-level picker.
- **Quantity precision (135)** — line-item quantities go INT → DECIMAL(15,4) so
  fractional sales (kg, metres) stop being silently rounded. Lossless.
- **Permissions (130)** — one-time merge of per-user grants into user types.
- **Live refresh (145)** — `live_events` table backing cross-terminal refresh.
