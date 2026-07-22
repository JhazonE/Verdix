# Adjustment Expiration Dates — SDD Progress

Base commit: eb43566
Branch: main (user works direct-to-main; see [[user-handles-push-sync]])
Plan: docs/superpowers/plans/2026-07-22-adjustment-expiration-dates.md
Spec: docs/superpowers/specs/2026-07-22-adjustment-expiration-dates-design.md

## Environment (project-wide truths, verified 2026-07-22)
- **DO NOT run `npm run lint`** — broken repo-wide (`next lint` misparses arg → "Invalid project
  directory provided, no such directory: ...\lint"). Removed from all task gates.
- **typecheck has 10 PRE-EXISTING source-file errors** — baseline at
  `.superpowers/sdd/typecheck-baseline.txt` (REBUILT after Task 7 to EXCLUDE `.next/` build
  artifacts: Next.js regenerates union-type key ORDER between runs, e.g.
  `"viewport" | "default"` ↔ `"default" | "viewport"`, producing phantom diff lines that are the
  same error. Always filter with `| grep -v "^\.next"`.)
  Gate command (as updated in the plan):
  `npm run typecheck 2>&1 | grep -E "^[^ ].*error TS" | grep -v "^\.next" | sort > .superpowers/sdd/tc-now.txt; diff .superpowers/sdd/typecheck-baseline.txt .superpowers/sdd/tc-now.txt`
  8 of the 10 are in `app/(app)/products/*/tabs/*` = the files Task 8 edits. Do NOT fix them.
- MySQL only, raw SQL via `lib/mysql.ts` `query()`/`withTransaction()`. No ORM.
- E2E: port 3100, `verdix_test`, workers:1. `verdix_test` is a **SCHEMA CLONE of dev `verdix`**
  (not migration replay) → migration 100 MUST be applied to dev DB before `npm run test:e2e:db`.
- E2E conventions: `testQuery()` from `tests/e2e/helpers/db.ts`, `seedSession()` from
  `helpers/auth.ts`, fixtures centralized in `tests/e2e/fixtures/test-data.ts` + seeded in
  `setup/prepare-test-db.ts`. Reference spec: `tests/e2e/inventory-adjust.spec.ts`. Comments in Cebuano.
- Unit tests: custom tsx runner, `npm run test:unit` (not used by this plan).

## Key architectural findings (from plan authoring — carry into dispatches)
- The batch INSERT is NOT in the adjustment routes. Two sites in `lib/stock-movements.ts`:
  `:196` inside `recordAdjustmentMovement` (line 131), `:421` inside `updateStockAndRecordMovement`
  (line 314). A third at `lib/purchase-actions.ts:212` is PO receiving = OUT OF SCOPE.
- **Only `:421` is on the live path.** `adjustStock()` routes EVERY adjustment (even non-family
  products) through `addFamilyStock` → `updateStockAndRecordMovement` → `:421`.
  `recordAdjustmentMovement` is only called by `createStockAdjustment` + a backfill loop.
- **Three approval touch points**, all needing expirationDate:
  `app/api/inventory/adjust/bulk/route.ts:71` (bulk payload),
  `app/(app)/inventory/history/actions.ts:235` (single payload),
  `app/api/approvals/process/route.ts:127` (replay via adjustStock(...,true)).
  `approvalData` is untyped JSON — a dropped field is NOT a compile error.
- Batch INSERTs sit in silent `try/catch { console.warn }` → a failed expiry write shows a SUCCESS
  toast and persists nothing. DB assertions are mandatory, UI assertions are insufficient.

## Tasks
- [x] Task 1: complete (commit ee13bd1). Controller-verified directly against MySQL:
      products.is_perishable = tinyint(1) NOT NULL DEFAULT '0'; inventory_batches.expiration_date =
      date NULL; idx_ib_expiration present. down()/up() cycle exercised by implementer.
      Schema-only, no logic → no reviewer dispatch.
- [x] Task 2: complete (commits 0ee7d48..a519ce1, review clean; spec ✅ quality Approved).
      REVIEW CAUGHT REAL BUG: normalizeExpirationDate used new Date(x).toISOString() → at UTC+8 this
      shifted "2026-07-22T00:00:00", "07/22/2026", "2026-07-22 00:00:00" back one day. Fixed via
      regex extraction on the ISO path (no Date object at all) + local accessors on the fallback
      path + new isValidCalendarDate (leap-year correct; verified 2028-02-29 ok, 2027-02-29 / 1900-02-29
      rejected). Controller independently verified all 13 inputs. 2 Minor deferred (see below).
- [x] Task 3: complete (commit 91fef30, review clean; spec ✅ quality Approved). Both INSERT sites
      updated (recordAdjustmentMovement ~200, updateStockAndRecordMovement ~432); controller verified
      column/param alignment (8/8 and 9/9 — CURDATE() and 'adjustment' are literals) + both signatures
      have expirationDate trailing + typecheck clean. Reviewer confirmed: failure isolation preserved
      (double-guarded), same-connection cache refresh is correct read-your-writes, and the
      `if (normalizedExpiry)` guard is safe (NULL rows excluded from the MIN aggregate by construction).
      2 Minor deferred.
- [x] Task 4: complete (commit ee1efb7, typecheck CLEAN). Controller-verified line-by-line against all
      three requirements: (1) `expirationDate?` added after `depth = 0`; (2) batch write receives
      `depth === 0 ? expirationDate : null` so only the directly-adjusted product carries the date;
      (3) recursive addFamilyStock call UNCHANGED (children get undefined→NULL) and deductFamilyStock
      untouched (0 hits in diff). 7 insertions/2 deletions, 1 file → no reviewer dispatch.
- [x] Task 5: complete (commit 8d03404, typecheck CLEAN). Controller-verified full diff: signature has
      trailing `expirationDate?`; approval payload now carries `expirationDate: expirationDate || null`
      (the untyped-JSON silent-failure point — confirmed present); BOTH addFamilyStock calls forward it
      with explicit `0` depth; BOTH deductFamilyStock calls untouched. Small surgical diff → no reviewer.
- [x] Task 6: complete (commit f7089f7, typecheck CLEAN). Controller-verified both files' full diffs:
      (1) `expirationDate` destructured from each adjustment item; (2) approvalData carries
      `expirationDate: expirationDate || null` [WRITE half of the untyped-JSON round trip];
      (3) addFamilyStock forwards it with explicit `0` depth, deductFamilyStock untouched;
      (4) approvals/process replays `txData.expirationDate || null` as adjustStock's 6th arg
      [READ half]. Server-side chain now COMPLETE end to end.
- [x] Task 7: complete (commit 7c6061e, typecheck CLEAN). Controller-verified 2-line diff:
      `isPerishable?: boolean` on the Product interface (lib/types.ts:27) and
      `isPerishable: Boolean(product.is_perishable)` in the mapper (products/actions.ts:291).
      No SELECT changes needed — all three product queries use `SELECT p.*`. Trivial diff → no reviewer.
- [x] Task 8: complete (commit b860236, typecheck CLEAN). 7 files: both loyalty-tabs, both schemas,
      both form hooks, + products/actions.ts. PLAN BUG FOUND: the brief said persistence lives in
      `app/api/products/` — it does NOT. Product create/update are SERVER ACTIONS (`addProduct` /
      `updateProduct` in `app/(app)/products/actions.ts`); the implementer found and edited the right
      place. Controller verified INSERT alignment: 29 cols / 29 `?` / 29 values, is_perishable last in
      all three. Edit path runtime-verified via real browser form (product TEST → is_perishable=1).
      NOTE: implementer also had to add `isPerishable?: boolean` to the ProductFormData type
      (actions.ts:49) — not in the brief but required for typecheck.
- [x] Task 9: complete (commit 2a011b7, typecheck CLEAN). ALL FOUR visibility cases verified in a REAL
      BROWSER by the controller (implementer could only code-read case 3 — dev DB had one product, so
      controller seeded a non-perishable one and drove it):
        • perishable + Add    → label "Expiration Date (Optional)", input#expirationDate present
        • perishable + Remove → dateInputCount 0 (hidden)
        • non-perishable + Add→ dateInputCount 0 (hidden)  ← the gap the implementer flagged, now closed
        • Physical Count      → hidden (implementer, browser)
      Persistence proven in DB: dialog write with expiry → batch expiry '2027-01-31'; blank → NULL,
      no error. Screenshot confirmed field sits between Quantity and Reason, matching existing styling.
- [x] Task 10: complete (commit 2320a7e, typecheck CLEAN). 6 files (5 + config-fields.tsx).
      Controller INDEPENDENTLY re-verified the header/body sync risk in a real browser:
        • non-perishable only, ADD → 6 heads / 6 cells, no EXPIRY column
        • + perishable added, ADD → 7 heads / 7 cells; EXPIRY between IMPACT and NOTE;
          non-perishable row renders "—", perishable row renders input[type=date]
        • switch to REMOVE      → back to 6 heads / 6 cells, 0 date inputs
      No misalignment in any state. Screenshot confirmed layout matches the user's original screenshot
      with exactly one column added. DB: bulk write persisted expiry '2027-03-15'.
- [ ] Task 11: Expiry in batch history views
- [ ] Task 12: Expiring Soon report
- [ ] Task 13: E2E coverage
- [ ] Task 14: Manual approval-path verification

## Minor findings (for final review triage)
- Task 2: `normalizeExpirationDate` fallback path (non-ISO input like "2/29/2027") still launders the
  value through native `Date` BEFORE validating, so Date's rollover wins → returns "2027-03-01"
  instead of null. The ISO regex path is correct. Real-world impact low (UI `<input type="date">`
  only ever emits bare ISO), but the doc comment implies broader protection than delivered.
- Task 2: year is not zero-padded in output (`${year}-${pad2(m)}-${pad2(d)}`), so "0000-01-01" →
  "0-01-01", not a valid MySQL DATE shape. Outside realistic input space for expiry dates.
- Task 3: `src/infrastructure/services/TransferStockService.ts:153` has a PRIVATE method also named
  `updateStockAndRecordMovement` (different signature, takes warehouseId). Distinct function, not a
  defect — but nobody should assume expiry support exists there.
- Task 8 (controller): there is a SECOND, legacy product-create path — `POST /api/products/route.ts`
  → `CreateProductUseCase` → `MySqlProductRepository` (INSERT at
  `src/infrastructure/repositories/MySqlProductRepository.ts:192`). It does NOT persist
  is_perishable: POSTing `{isPerishable:true}` returns `isPerishable:true` in the response body but
  writes 0. Controller confirmed NO UI code POSTs to it (the Add Product form calls the `addProduct`
  server action instead), so this is NOT a Task 8 defect and not user-reachable. Flagging because an
  external API consumer would hit it, and the response body lies about what was stored.
- Task 3: DECREASE/FIFO path (`deductFromBatches`) never calls `refreshProductExpirationCache`, so if
  the batch driving `products.expiration_date` is fully depleted, the cache goes STALE until some
  other batch event refreshes it. Pre-existing gap, not a regression from this task (the brief only
  covered the INCREASE path), but a real follow-up.

## ✅ SERVER-SIDE CHAIN SMOKE TESTED (after Task 6, controller-run)
Live dev server on :3000 against dev `verdix`. Seeded a perishable product, POSTed to
`/api/inventory/adjust/bulk` with `expirationDate:"2027-06-30"` → `success:true, processed:1`.
DB verified: `inventory_batches` row created with the expiry AND `products.expiration_date` cache
refreshed. `DATE_FORMAT(...,'%Y-%m-%d')` on both = **2027-06-30**, exactly as submitted (no shift).
Smoke data deleted afterward. The UI tasks are building on a chain that is PROVEN to persist.

## Gotchas discovered during execution (carry into later tasks)
- **mysql2 renders a bare DATE column as a JS Date in LOCAL time.** A correctly-stored `2027-06-30`
  prints as `2027-06-29T16:00:00.000Z` at UTC+8. This is a DISPLAY artifact, not corruption.
  When asserting dates (Task 13!), use `DATE_FORMAT(col,'%Y-%m-%d')` in SQL, or pass
  `dateStrings:true` to the connection — do NOT compare against `.toISOString()`, which will look
  off-by-one and send you chasing a bug that isn't there.
- **Importing `lib/expiration.ts` (or anything importing `lib/mysql.ts`) HANGS the process.**
  `lib/mysql.ts` opens a connection pool AND starts a backup scheduler + background sync worker on
  import, so a `tsx` script that imports it never exits (observed: 2-minute timeout, exit 143).
  To exercise pure functions standalone, COPY them into a scratch file rather than importing the
  module. Same hang class the previous feature's ledger recorded for its unit tests.
