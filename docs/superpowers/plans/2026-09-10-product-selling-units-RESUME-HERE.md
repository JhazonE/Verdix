# Selling Units — Resume Here (Tasks 5–8)

**Status as of 2026-09-10:** Tasks 1–4 shipped and reviewed clean. Tasks 5–8 deferred to a fresh
session by user decision, because they rewrite POS checkout — BIR-significant code sitting behind
28 existing Z-readings.

- **Plan:** `docs/superpowers/plans/2026-09-10-product-selling-units.md` (start at Task 5)
- **Spec:** `docs/superpowers/specs/2026-09-10-product-selling-units-design.md`
- **Commits from this run:** `2759fbd..0ce871e` (4 commits, 296 insertions / 0 deletions)

## What state things are actually in

The database is at **migration 120**.

`product_selling_units` exists and holds exactly one `is_base = 1, factor = 1` row per product —
**15,987 of them**, each mirroring its product's `unit_of_measure`, `barcode`, `cost` and `price`.
Verified: 0 products missing a base unit, 0 duplicates, 0 orphans.

`products.stock` was never touched and is still the sole stock figure in base units:
`SUM = -849.0000`, `MIN = -624.0000`. That `-624` belongs to `product_1788760575586` and is carried
deliberately — **do not "correct" it.**

The four line-item tables (`pos_transaction_items`, `sale_items`, `sales_invoice_items`,
`sales_order_items`) each gained three nullable columns: `selling_unit_id`, `selling_unit_name`,
`selling_unit_factor`. **Every existing row is NULL on all three, meaning "base unit."** Row counts
and quantity sums were identical before and after (147/147/141/2; 288/288/300/2).

**Nothing reads or writes any of this yet.** A repo-wide grep finds the new table only in its own
migrations and `lib/selling-units.ts`, which is imported solely by its own test. The old parent/child
family model and `lib/family-sync.ts` still run unchanged and still own stock.

## Before Task 5 touches checkout

1. **Take a fresh mysqldump.** The 12 MB one in the prior session's scratchpad is already stale —
   it predates schema 120. (An 8.5 MB pre-migration dump also exists there.)
2. **The two models must never both own stock at once.** Converting a caller means removing its
   family-sync cascade in the *same* commit — not in a later cleanup.
3. **Write `selling_unit_id` / `_name` / `_factor` at sale time**, denormalised. A later edit to a
   unit's factor must not rewrite what a filed receipt meant.
4. **Treat NULL as factor 1** in every read path — that is what every historical row means.
5. **Guard NaN quantity at the call site.** `baseQuantity` validates only the *factor* (it throws on
   zero/negative/non-finite). A NaN *quantity* would propagate silently into a stock write.
6. **Expect `ER_DUP_ENTRY` on barcode.** `product_selling_units.barcode` is UNIQUE and already holds
   15,987 non-NULL values — every product had one. A new unit reusing a barcode a base unit already
   claims must surface a clear error, never fail a sale silently. Multiple NULLs are fine.
7. **Re-verify after each BIR-facing change:** the 147/147/141/2 counts, and that the `-624` row is
   still `-624`.

## Known-good verification commands

```bash
# base units: expect products == bases, missing 0, multipleBases 0
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const [{n:products}] = await query('SELECT COUNT(*) n FROM products');
  const [{n:bases}] = await query('SELECT COUNT(*) n FROM product_selling_units WHERE is_base=1');
  const missing = await query('SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_selling_units u WHERE u.product_id=p.id AND u.is_base=1)');
  console.log({products, bases, missing: missing[0].n}); process.exit(0);
})();"

# stock untouched: expect SUM -849.0000, MIN -624.0000
npx tsx -e "require('./lib/mysql').query('SELECT SUM(stock) s, MIN(stock) m FROM products').then(r=>{console.log(r[0]); process.exit(0)})"
```

## Deferred minors (neither blocks Task 5)

- `baseQuantity` does not validate `quantity`. Inert today; becomes real the moment checkout calls it
  — see point 5 above.
- `getBaseUnit`'s "every product has exactly one" is a backfill invariant, not a DB constraint. Worth
  adding a uniqueness guarantee on `(product_id) WHERE is_base = 1` once Task 5 starts writing units.

## Environment notes

- `npm run migrate` does not self-exit — a pre-existing cron side effect in `lib/mysql`. Read the
  output and stop it manually.
- `npm run test:unit` cannot verify a new test: `tests/unit/business-date-lock-lifecycle.test.ts:67`
  aborts the suite before later imports. Use `npx tsx tests/unit/<file>.test.ts`.
- Baseline is red independently of this work: lint broken, typecheck has pre-existing errors, four
  `tests/e2e/products/price-levels.spec.ts` tests fail because that spec seeds no session.
- The working tree carries ~10 uncommitted files of a colleague's user-manual work. Never
  `git stash` / `restore` / `checkout --` / `reset` / `clean`; stage only your own paths.
