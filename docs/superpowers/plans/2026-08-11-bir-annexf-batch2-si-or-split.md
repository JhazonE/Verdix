# BIR Annex F Batch 2: Sales Invoice vs Official Receipt Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Verdix POS document goods sales as a Sales Invoice (existing `si_number` series) and services sales as an Official Receipt (new `bir_or_number` series), block mixed-type carts before they can reach checkout, extend every report that ranges over `si_number` to also range over `bir_or_number`, and fix `bir-summary`'s pre-existing bug where its "Beginning/Ending SI/OR No." columns are sourced from the wrong counter.

**Architecture:** A new BIR-OR numbering series is added following the exact pattern already used for MC numbers (a counter column on `transaction_references`, an issued-number column on `sales_transactions`/`pos_transactions`, a `getNextBirOrNumber()` function mirroring `getNextMCNumber()`). Checkout gains a pre-transaction validation pass that determines whether the cart is all-goods or all-services (querying `products.type` server-side, never trusting client-supplied type) and rejects mixed carts; the POS UI adds a matching client-side check for immediate feedback. Receipt generation (both ESC/POS and browser paths) switches its title/number logic from payment-method-based to document-type-based. Every report that currently computes one SI range (Z-reading, X-reading, by-date, e-journal) gains a second, independently-scoped OR range.

**Tech Stack:** TypeScript, MySQL via `mysql2/promise` (raw SQL, no ORM), Next.js API routes, React, `@point-of-sale/receipt-printer-encoder` for ESC/POS, plain Node `assert`-based unit tests run via `tsx tests/unit/run.ts`.

## Global Constraints

- No change to historical/pre-split sales records — every existing `si_number` row predates this split and stays implicitly part of the goods/SI series. No backfill, no reclassification.
- No supplementary-document series (checklist item #2) — confirmed N/A, out of scope for this plan.
- The new internal column/function name is `bir_or_number` / `getNextBirOrNumber()` — never bare `or_number` or `getNextORNumber()`, to avoid confusion with the pre-existing, unrelated `pos_terminals.or_next_reference` / `transaction_references.receipt_number` / `getNextReceiptNumber()` counter (a generic per-terminal receipt reference that runs for every sale regardless of type, not a BIR classification).
- The value printed/displayed to users is the short label "OR No." (matching how `si_number` prints as "SI NO." today) — the `bir_` prefix is code-only, never user-facing.
- No change to the existing `receipt_number`/`or_next_reference`/`getNextReceiptNumber()` counter's behavior or callers.
- Server-side type determination always re-queries `products.type` fresh — never trusts a client-supplied `type` field, matching the existing `isService(soldProd)` pattern already used in checkout for stock/batch-costing (`app/api/pos/checkout/route.ts:170`).
- Mixed-cart carts are always rejected outright — no majority-vote or best-guess resolution.
- Goods sale title is always `SALES INVOICE` (no cash/charge distinction in the title); services sale title is always `OFFICIAL RECEIPT` (also no cash/charge distinction). Payment method remains visible lower on the receipt in the existing `CASH:`/`CHARGE:` payment-section line, unchanged.
- Training-mode sales burn neither `si_number` nor `bir_or_number`, matching the existing training-mode exclusion already applied to `si_number` (`app/api/pos/checkout/route.ts:116-119`).

---

## File Structure

- Create: `scripts/migrations/1XX_add_bir_or_number.ts` — new counter + issued-number columns (exact migration number determined at implementation time by checking the latest existing migration number).
- Modify: `lib/mysql.ts` — add `getNextBirOrNumber()`.
- Modify: `app/api/pos/checkout/route.ts` — mixed-cart validation, routing between `getNextSINumber`/`getNextBirOrNumber`, INSERT statements for both `sales_transactions` and `pos_transactions`.
- Modify: `app/(app)/pos/pos-content/use-pos.ts` — client-side mixed-cart check in `handleAddItem`.
- Modify: `lib/receipt-generator.ts` — title/number logic in `generateReceipt()`.
- Modify: `app/(app)/pos/receipt/receipt-types.ts` — add `birOrNumber` field.
- Modify: `app/(app)/pos/receipt/ReceiptView.tsx` — title/number logic, browser path.
- Modify: `app/api/sales/z-reading/route.ts` — second range pair (sales/void/return × OR).
- Modify: `lib/receipt-generator.ts` (Z-reading section) and `lib/z-reading-generator.ts` — print the new OR range lines.
- Modify: `app/api/sales/x-reading/route.ts` — second range pair.
- Modify: `lib/x-reading-generator.ts` and any X-reading preview component — print the new OR range.
- Modify: `app/api/sales/by-date/route.ts` — second range pair.
- Modify: `app/api/sales/ejournal/route.ts` — second sort-based begin/end pair.
- Modify: `app/api/sales/bir-summary/route.ts` — fix to source from `si_number`/`bir_or_number` instead of `receipt_number`.
- Test: `tests/unit/bir-or-number.test.ts` (new) — counter increment behavior.
- Test: `tests/unit/receipt-document-type.test.ts` (new) — title/number selection on both print paths.
- Test: `tests/unit/z-reading-or-range.test.ts` (new) — OR range appears correctly in Z-reading output.
- Modify: `tests/unit/run.ts` — register new test files.

---

### Task 1: `bir_or_number` counter — schema + `getNextBirOrNumber()`

**Files:**
- Create: `scripts/migrations/1XX_add_bir_or_number.ts` (pick the next available migration number — list `scripts/migrations/` and use the highest existing number + 1; `099_add_mc_number.ts` was the most recent numbering-series migration seen during planning, but check for higher numbers before picking one)
- Modify: `lib/mysql.ts:284-286` (insert after `getNextMCNumber`, before `closePool`)
- Test: `tests/unit/bir-or-number.test.ts` (new)
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Produces: `getNextBirOrNumber(connection?: mysql.PoolConnection): Promise<string>` — exported from `lib/mysql.ts`, returns a string like `"OR-000001"`. Later tasks (checkout, reports) import and call this exactly like `getNextSINumber`/`getNextMCNumber`.
- Produces: `transaction_references.bir_or_number VARCHAR(20) NOT NULL DEFAULT '000000'` (the counter column), `sales_transactions.bir_or_number VARCHAR(20) NULL` with UNIQUE index, `pos_transactions.bir_or_number VARCHAR(20) NULL` with UNIQUE index.

- [ ] **Step 1: Write the migration**

First check the highest existing migration number:

Run: `ls scripts/migrations/ | sort -V | tail -5`

Then create `scripts/migrations/1XX_add_bir_or_number.ts` (replace `1XX` with the actual next number, e.g. if the highest is `102`, use `103`), modeled exactly on `scripts/migrations/099_add_mc_number.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Add the BIR Official Receipt (OR) number series.
 *
 * BIR rules require goods sales to be documented as a Sales Invoice (the
 * existing si_number series) and services sales as an Official Receipt —
 * a legally distinct document type with its own numbering series, not a
 * cosmetic label choice.
 *
 * Named bir_or_number (not or_number) to avoid confusion with the existing,
 * unrelated pos_terminals.or_next_reference / transaction_references.receipt_number
 * counter, which is a generic per-terminal receipt reference issued for every
 * sale regardless of goods/services classification — not a BIR series.
 *
 * This migration:
 *   1. Adds transaction_references.bir_or_number — the counter, mirroring
 *      si_number and mc_number. Starts at '000000' because getNextBirOrNumber()
 *      increments-then-reads, so the FIRST Official Receipt issued is OR-000001.
 *   2. Adds sales_transactions.bir_or_number and pos_transactions.bir_or_number —
 *      where the issued number is stored per sale. NULL for goods sales (which
 *      use si_number instead) and for historical pre-split rows.
 *
 * Existing sales are deliberately NOT backfilled or reclassified — every
 * historical si_number row predates this split and stays implicitly part of
 * the goods/SI series.
 */
const migration: Migration = {
  name: '1XX_add_bir_or_number',
  timestamp: '2026-08-11_10-00-00',

  async up(): Promise<void> {
    // 1. The counter.
    const [refCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'transaction_references'
        AND COLUMN_NAME = 'bir_or_number'
    `);
    if (refCol?.cnt > 0) {
      console.log('• transaction_references.bir_or_number already exists — skipping');
    } else {
      await query(`
        ALTER TABLE transaction_references
        ADD COLUMN bir_or_number VARCHAR(20) NOT NULL DEFAULT '000000'
      `);
      console.log('✅ Added transaction_references.bir_or_number (counter, starts 000000)');
    }

    await query(`
      UPDATE transaction_references
      SET bir_or_number = '000000'
      WHERE id = 1 AND (bir_or_number IS NULL OR bir_or_number = '')
    `);

    // 2. sales_transactions.bir_or_number
    const [saleCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'sales_transactions'
        AND COLUMN_NAME = 'bir_or_number'
    `);
    if (saleCol?.cnt > 0) {
      console.log('• sales_transactions.bir_or_number already exists — skipping');
    } else {
      await query(`
        ALTER TABLE sales_transactions
        ADD COLUMN bir_or_number VARCHAR(20) NULL
      `);
      console.log('✅ Added sales_transactions.bir_or_number');

      await query(`
        CREATE UNIQUE INDEX idx_sales_transactions_bir_or_number
        ON sales_transactions (bir_or_number)
      `);
      console.log('✅ Added unique index on sales_transactions.bir_or_number');
    }

    // 3. pos_transactions.bir_or_number
    const [posCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pos_transactions'
        AND COLUMN_NAME = 'bir_or_number'
    `);
    if (posCol?.cnt > 0) {
      console.log('• pos_transactions.bir_or_number already exists — skipping');
      return;
    }

    await query(`
      ALTER TABLE pos_transactions
      ADD COLUMN bir_or_number VARCHAR(20) NULL
    `);
    console.log('✅ Added pos_transactions.bir_or_number');

    await query(`
      CREATE UNIQUE INDEX idx_pos_transactions_bir_or_number
      ON pos_transactions (bir_or_number)
    `);
    console.log('✅ Added unique index on pos_transactions.bir_or_number');
  },

  async down(): Promise<void> {
    await query(`DROP INDEX idx_pos_transactions_bir_or_number ON pos_transactions`);
    await query(`ALTER TABLE pos_transactions DROP COLUMN bir_or_number`);
    console.log('✅ Dropped pos_transactions.bir_or_number');

    await query(`DROP INDEX idx_sales_transactions_bir_or_number ON sales_transactions`);
    await query(`ALTER TABLE sales_transactions DROP COLUMN bir_or_number`);
    console.log('✅ Dropped sales_transactions.bir_or_number');

    await query(`ALTER TABLE transaction_references DROP COLUMN bir_or_number`);
    console.log('✅ Dropped transaction_references.bir_or_number');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Run the migration**

Run: `npm run migrate`
Expected: Output shows `✅ Added transaction_references.bir_or_number`, `✅ Added sales_transactions.bir_or_number`, `✅ Added unique index on sales_transactions.bir_or_number`, `✅ Added pos_transactions.bir_or_number`, `✅ Added unique index on pos_transactions.bir_or_number`.

Verify with: `npm run migrate` again — expected output this time is all three `• ... already exists — skipping` lines (idempotency check).

- [ ] **Step 3: Write the failing test for `getNextBirOrNumber()`**

Create `tests/unit/bir-or-number.test.ts`. This test requires a live DB connection (unlike the pure `si-number.test.ts`), so model it on how other DB-backed unit tests in this suite are structured — check `tests/unit/ejournal-writer.test.ts` or similar for the pattern of importing `withTransaction`/`query` directly if a lighter-weight approach isn't available; if all existing unit tests are DB-free, this may need to become a manual/integration verification instead (see Step 5's fallback). Attempt the direct approach first:

```typescript
import assert from 'node:assert/strict';
import { getNextBirOrNumber, withTransaction } from '../../lib/mysql';

// getNextBirOrNumber() must produce a distinct, incrementing, OR-prefixed
// sequence independent of si_number/mc_number, and must be rollback-safe
// on the same connection (a failed sale must not burn a number).

await withTransaction(async (connection) => {
  const first = await getNextBirOrNumber(connection);
  const second = await getNextBirOrNumber(connection);

  assert.ok(/^OR-\d{6}$/.test(first), `first OR number is OR-prefixed 6-digit, got ${first}`);
  assert.ok(/^OR-\d{6}$/.test(second), `second OR number is OR-prefixed 6-digit, got ${second}`);

  const firstNum = parseInt(first.replace('OR-', ''), 10);
  const secondNum = parseInt(second.replace('OR-', ''), 10);
  assert.equal(secondNum, firstNum + 1, 'second call increments by exactly 1');

  // Roll back — this transaction's increments must not persist.
  throw new Error('__TEST_ROLLBACK__');
}).catch((e: any) => {
  if (e.message !== '__TEST_ROLLBACK__') throw e;
});

console.log('✓ bir-or-number');
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx tsx tests/unit/bir-or-number.test.ts`
Expected: FAIL with `getNextBirOrNumber is not a function` or similar import error (function doesn't exist yet).

- [ ] **Step 5: Implement `getNextBirOrNumber()`**

In `lib/mysql.ts`, insert immediately after the closing `}` of `getNextMCNumber()` (currently ending at line 284) and before the doc comment for `closePool` (currently starting at line 286):

```typescript

/**
 * Atomically gets and increments the next BIR Official Receipt (OR) number.
 *
 * Named bir_or_number (not or_number) to avoid confusion with the existing,
 * unrelated getNextReceiptNumber()/or_next_reference counter, which is a
 * generic per-terminal receipt reference issued for every sale regardless of
 * type — not this BIR classification series.
 *
 * @returns The next BIR OR number, formatted (e.g. "OR-000001")
 */
export async function getNextBirOrNumber(connection?: mysql.PoolConnection): Promise<string> {
  return await onConnection(connection, async (connection) => {
    await connection.query(
      `UPDATE transaction_references SET bir_or_number = LPAD(IF(bir_or_number IS NULL OR bir_or_number = '', 0, CAST(bir_or_number AS UNSIGNED)) + 1, 6, '0') WHERE id = 1`
    );

    const [rows]: any = await connection.query(
      `SELECT bir_or_number as next_val FROM transaction_references WHERE id = 1`
    );
    if (!rows || rows.length === 0) {
      throw new Error('Failed to fetch next BIR OR number');
    }
    return `OR-${String(rows[0].next_val)}`;
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx tests/unit/bir-or-number.test.ts`
Expected: PASS, prints `✓ bir-or-number`.

If a live DB connection isn't available in the test environment and this fails for connection reasons (not logic reasons), note this in your task report as a concern rather than guessing at a mock — this test's value depends on hitting the real increment-then-read SQL against `transaction_references`.

- [ ] **Step 7: Register the test and run the full suite**

In `tests/unit/run.ts`, add `import './bir-or-number.test';` after the last existing import.

Run: `npm run test:unit`
Expected: All tests pass, no regressions.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrations/1XX_add_bir_or_number.ts lib/mysql.ts tests/unit/bir-or-number.test.ts tests/unit/run.ts
git commit -m "feat(billing): add BIR Official Receipt (bir_or_number) counter

BIR rules require services sales to be documented as an Official
Receipt with its own numbering series, distinct from the existing
si_number series used for goods (Sales Invoice). Named bir_or_number
to avoid confusion with the pre-existing, unrelated
receipt_number/or_next_reference counter that runs for every sale.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Mixed-cart validation — server-side (checkout API)

**Files:**
- Modify: `app/api/pos/checkout/route.ts:79-119` (insert validation after existing basic checks, before `getNextSINumber` call)

**Interfaces:**
- Consumes: `getNextBirOrNumber` from Task 1 (`lib/mysql.ts`).
- Produces: checkout now returns `{ success: false, error: 'Cannot mix goods and services in one sale...' }` with HTTP 400 for a mixed cart, matching the existing error-response shape used by the other validations in this route (e.g. line 70, 74, 78). Also produces the routing decision (`isServiceSale: boolean`) that Task 3 consumes.

- [ ] **Step 1: Write the failing test**

This is an API route — check whether existing checkout tests exist (`grep -r "checkout" tests/`) to follow the same testing approach. If no direct API-route test infrastructure exists in this repo's unit test suite (likely, given the suite is DB-free pure-function tests plus a few DB-backed ones from Task 1), write this as a focused integration test that calls the route handler directly with a mocked `NextRequest`, OR — if that's impractical given the route's dependencies — write the validation logic as an extractable pure function first (see Step 3) and unit-test that function in isolation, which is both simpler to test and better factored:

Create `tests/unit/mixed-cart-validation.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { validateSingleDocumentType } from '../../app/api/pos/checkout/mixed-cart-validation';

// A cart must be entirely goods (standard) or entirely services — never both.
// This is enforced before any counter is incremented, so a rejected cart
// never burns an SI or OR number.

assert.equal(
  validateSingleDocumentType([{ type: 'standard' }, { type: 'standard' }]),
  'standard',
  'all-goods cart resolves to standard',
);
assert.equal(
  validateSingleDocumentType([{ type: 'service' }, { type: 'service' }]),
  'service',
  'all-services cart resolves to service',
);
assert.throws(
  () => validateSingleDocumentType([{ type: 'standard' }, { type: 'service' }]),
  /mix/i,
  'mixed cart throws',
);
assert.equal(
  validateSingleDocumentType([{ type: undefined }, { type: 'standard' }]),
  'standard',
  'missing type defaults to standard (matches isService() false-default direction)',
);
assert.equal(
  validateSingleDocumentType([{ type: undefined }]),
  'standard',
  'single item with no type is standard',
);

console.log('✓ mixed-cart-validation');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/mixed-cart-validation.test.ts`
Expected: FAIL — module `app/api/pos/checkout/mixed-cart-validation` doesn't exist yet.

- [ ] **Step 3: Write the validation function**

Create `app/api/pos/checkout/mixed-cart-validation.ts`:

```typescript
import type { ProductType } from '@/lib/product-type';

/**
 * Resolves a cart's single BIR document type (goods → Sales Invoice,
 * services → Official Receipt), or throws if the cart mixes both.
 *
 * Missing/unknown type defaults to 'standard', matching isService()'s
 * false-default direction in lib/product-type.ts — a bad read must never
 * misclassify a sale as services.
 */
export function validateSingleDocumentType(items: { type?: string | null }[]): ProductType {
  const types = new Set(items.map(item => (item.type === 'service' ? 'service' : 'standard')));
  if (types.size > 1) {
    throw new Error('Cannot mix goods and services in one sale — please complete this as two separate transactions.');
  }
  return types.has('service') ? 'service' : 'standard';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/mixed-cart-validation.test.ts`
Expected: PASS, prints `✓ mixed-cart-validation`.

- [ ] **Step 5: Wire the validation into the checkout route**

In `app/api/pos/checkout/route.ts`, after the existing validation block (currently lines 77-79, ending with the `Customer is required for Charge to Account` check) and before the ID-generation block (currently starting at line 81 with `const saleId = ...`), add a server-side type lookup and validation. This must query `products.type` fresh for every item in the cart (never trust client-supplied data, matching the existing `isService(soldProd)` pattern at line 170):

```typescript
    // Determine this cart's single BIR document type (goods vs services) by
    // re-querying products.type fresh — never trust client-supplied type,
    // matching the existing isService(soldProd) pattern used later in this
    // route for stock/batch-costing.
    const productIds = items.map((it: any) => it.id);
    const [productTypeRows]: any = await query(
      `SELECT id, type FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
      productIds
    );
    const typeById = new Map(productTypeRows.map((r: any) => [r.id, r.type]));
    let isServiceSale: boolean;
    try {
      const resolvedType = validateSingleDocumentType(
        items.map((it: any) => ({ type: typeById.get(it.id) }))
      );
      isServiceSale = resolvedType === 'service';
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    }
```

Add the import at the top of the file, alongside the existing imports (currently line 7, `import { isService } from '@/lib/product-type';`):

```typescript
import { validateSingleDocumentType } from './mixed-cart-validation';
```

- [ ] **Step 6: Run the checkout route's existing tests (if any) plus the full suite**

Run: `npm run test:unit`
Expected: All tests pass, no regressions. (This step only changes behavior for mixed carts — existing single-type checkout flows are unaffected since `validateSingleDocumentType` on an all-one-type array never throws.)

- [ ] **Step 7: Commit**

```bash
git add app/api/pos/checkout/mixed-cart-validation.ts app/api/pos/checkout/route.ts tests/unit/mixed-cart-validation.test.ts tests/unit/run.ts
git commit -m "feat(checkout): reject carts that mix goods and services

BIR requires one document type per sale (Sales Invoice for goods,
Official Receipt for services). Server-side enforcement re-queries
products.type fresh per item rather than trusting the client, and
runs before any counter is touched so a rejected cart never burns
an SI or OR number.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Note: register `mixed-cart-validation.test.ts` in `tests/unit/run.ts` as part of this task, same as Task 1's pattern — add `import './mixed-cart-validation.test';` before running Step 6.)

---

### Task 3: Checkout routing — assign SI or OR number, write both tables

**Files:**
- Modify: `app/api/pos/checkout/route.ts:2` (import), `:116-142` (SI number assignment + `sales_transactions` INSERT), `:354-382` (`pos_transactions` INSERT)

**Interfaces:**
- Consumes: `isServiceSale: boolean` from Task 2 (computed earlier in the same route, in scope for the rest of the handler). `getNextBirOrNumber` from Task 1.
- Produces: `birOrNumber: string | null` — a new variable in scope for the rest of the checkout handler, alongside the existing `siNumber` variable, consumed by Task 4 (browser/API response) if the response payload needs it.

- [ ] **Step 1: Update the import**

In `app/api/pos/checkout/route.ts:2`, change:

```typescript
import { withTransaction, getNextReference, getNextReceiptNumber, getNextSINumber, formatSINumber } from '@/lib/mysql';
```

to:

```typescript
import { withTransaction, getNextReference, getNextReceiptNumber, getNextSINumber, getNextBirOrNumber, formatSINumber } from '@/lib/mysql';
```

- [ ] **Step 2: Route between `getNextSINumber` and `getNextBirOrNumber`**

Change the current lines 116-119:

```typescript
      // Get next SI Number (consolidated sequence number). Training-mode sales are
      // excluded from official BIR totals, so they must not burn a real SI number —
      // doing so would create unexplained jumps in the filed sequence.
      const siNumber = isTrainingMode ? null : await getNextSINumber(connection);
```

to:

```typescript
      // Get next SI Number (goods) or BIR OR Number (services) — never both.
      // Training-mode sales are excluded from official BIR totals, so they
      // must not burn a real number from either series — doing so would
      // create unexplained jumps in the filed sequence.
      const siNumber = (isTrainingMode || isServiceSale) ? null : await getNextSINumber(connection);
      const birOrNumber = (isTrainingMode || !isServiceSale) ? null : await getNextBirOrNumber(connection);
```

- [ ] **Step 3: Add `bir_or_number` to the `sales_transactions` INSERT**

Change the current lines 125-142:

```typescript
      // 1. Insert into sales_transactions
      const insertSaleSql = `
        INSERT INTO sales_transactions (
          id, reference, receipt_number, si_number, customer_id, invoice_date, date, total, payment_method, status, transaction_source, notes, is_training, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, CURDATE(), CURDATE(), ?, ?, ?, 'POS', ?, ?, NOW(), NOW())
      `;
      await connection.query(insertSaleSql, [
        saleId,
        sequentialRef,
        receiptNo,
        siNumber,
        (customer && customer.id !== 'walk-in') ? customer.id : null,
        totalDue,
        paymentMethod,
        invoiceStatus,
        notes || 'POS Sale',
        isTrainingMode
      ]);
```

to:

```typescript
      // 1. Insert into sales_transactions
      const insertSaleSql = `
        INSERT INTO sales_transactions (
          id, reference, receipt_number, si_number, bir_or_number, customer_id, invoice_date, date, total, payment_method, status, transaction_source, notes, is_training, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURDATE(), CURDATE(), ?, ?, ?, 'POS', ?, ?, NOW(), NOW())
      `;
      await connection.query(insertSaleSql, [
        saleId,
        sequentialRef,
        receiptNo,
        siNumber,
        birOrNumber,
        (customer && customer.id !== 'walk-in') ? customer.id : null,
        totalDue,
        paymentMethod,
        invoiceStatus,
        notes || 'POS Sale',
        isTrainingMode
      ]);
```

- [ ] **Step 4: Add `bir_or_number` to the `pos_transactions` INSERT**

Change the current lines 355-382:

```typescript
      // 4. Insert into pos_transactions with payment details reference
      const insertPosTransSql = `
        INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type, si_number,
          subtotal, tax_amount, discount_amount, total_amount, payment_method,
          payment_status, payment_details_id, payment_validated_at,
          notes, is_training, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW(), NOW())
      `;

      const posNotes = `Tendered: ₱${(body.amountTendered || totalDue).toFixed(2)}, Change: ₱${(body.change || 0).toFixed(2)}${notes ? ' - ' + notes : ''}`;

      await connection.query(insertPosTransSql, [
        posTransId,
        saleId,
        shiftId || null,
        userId,
        terminalId || null,
        siNumber,
        body.subtotal || totalDue,
        body.taxAmount || 0,
        body.discountAmount || 0,
        totalDue,
        paymentMethod,
        posPaymentStatus,
        paymentDetailsId,
        posNotes,
        isTrainingMode
      ]);
```

to:

```typescript
      // 4. Insert into pos_transactions with payment details reference
      const insertPosTransSql = `
        INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type, si_number, bir_or_number,
          subtotal, tax_amount, discount_amount, total_amount, payment_method,
          payment_status, payment_details_id, payment_validated_at,
          notes, is_training, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW(), NOW())
      `;

      const posNotes = `Tendered: ₱${(body.amountTendered || totalDue).toFixed(2)}, Change: ₱${(body.change || 0).toFixed(2)}${notes ? ' - ' + notes : ''}`;

      await connection.query(insertPosTransSql, [
        posTransId,
        saleId,
        shiftId || null,
        userId,
        terminalId || null,
        siNumber,
        birOrNumber,
        body.subtotal || totalDue,
        body.taxAmount || 0,
        body.discountAmount || 0,
        totalDue,
        paymentMethod,
        posPaymentStatus,
        paymentDetailsId,
        posNotes,
        isTrainingMode
      ]);
```

(Note the added `?` in the VALUES clause immediately after the `si_number` placeholder, to match the new `bir_or_number` column inserted into the column list — and the corresponding new `birOrNumber` entry in the parameter array, positioned to match.)

- [ ] **Step 5: Include `birOrNumber` in the checkout response**

Find the response JSON at the end of the route (per prior research, around line 667-671, returning `{ saleId, posTransId, invoiceId, paymentDetailsId, orderNumber, siNumber, pointsEarned, pointsRemaining, creditApplied }`). Add `birOrNumber` to this object so the client can build the receipt with the correct number:

```typescript
    return NextResponse.json({
      success: true,
      data: {
        saleId,
        posTransId,
        invoiceId,
        paymentDetailsId,
        orderNumber,
        siNumber,
        birOrNumber,
        pointsEarned,
        pointsRemaining,
        creditApplied
      }
    });
```

(Adjust to match the exact existing response shape found in the file at implementation time — the fields listed here are from the research pass; confirm against the actual current code before editing, and only add `birOrNumber` alongside the existing `siNumber` field without altering anything else in the response shape.)

- [ ] **Step 6: Manual verification (no automated test for this step — covered by Task 2's validation test and Task 1's counter test individually; this step wires them together)**

Since this task is pure plumbing between already-tested pieces (Task 1's counter, Task 2's validation), write one integration-style test that exercises the full routing decision without hitting the actual HTTP route (which requires a running Next.js server):

Create a small unit test that verifies the routing arithmetic directly, `tests/unit/checkout-si-or-routing.test.ts`:

```typescript
import assert from 'node:assert/strict';

// Mirrors the routing logic added to checkout/route.ts: exactly one of
// siNumber/birOrNumber is non-null for a real sale, both are null for
// training mode, and the choice matches isServiceSale.
function resolveNumbers(isTrainingMode: boolean, isServiceSale: boolean) {
  const siNumber = (isTrainingMode || isServiceSale) ? null : 'SI-WOULD-BE-CALLED';
  const birOrNumber = (isTrainingMode || !isServiceSale) ? null : 'OR-WOULD-BE-CALLED';
  return { siNumber, birOrNumber };
}

assert.deepEqual(
  resolveNumbers(false, false),
  { siNumber: 'SI-WOULD-BE-CALLED', birOrNumber: null },
  'goods, not training: SI assigned, OR null',
);
assert.deepEqual(
  resolveNumbers(false, true),
  { siNumber: null, birOrNumber: 'OR-WOULD-BE-CALLED' },
  'services, not training: OR assigned, SI null',
);
assert.deepEqual(
  resolveNumbers(true, false),
  { siNumber: null, birOrNumber: null },
  'goods, training: neither assigned',
);
assert.deepEqual(
  resolveNumbers(true, true),
  { siNumber: null, birOrNumber: null },
  'services, training: neither assigned',
);

console.log('✓ checkout-si-or-routing');
```

Run: `npx tsx tests/unit/checkout-si-or-routing.test.ts`
Expected: PASS.

Register in `tests/unit/run.ts`: `import './checkout-si-or-routing.test';`

Run: `npm run test:unit`
Expected: All tests pass.

Run: `npm run typecheck`
Expected: No new errors in `app/api/pos/checkout/route.ts`.

- [ ] **Step 7: Commit**

```bash
git add app/api/pos/checkout/route.ts tests/unit/checkout-si-or-routing.test.ts tests/unit/run.ts
git commit -m "feat(checkout): assign SI or BIR OR number based on cart document type

Exactly one of si_number/bir_or_number is now written per sale,
matching whether the cart resolved to goods or services in Task 2's
validation. Training-mode sales continue to burn neither number.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Client-side mixed-cart check (POS UI)

**Files:**
- Modify: `app/(app)/pos/pos-content/use-pos.ts:563-586` (`handleAddItem`)

**Interfaces:**
- Consumes: `Product.type` (`lib/types.ts:28`), already present on every product object passed into `handleAddItem`.
- Produces: no new exports — this is a UI-only behavioral change (blocks the add + shows a toast), verified manually since `use-pos.ts` is a React hook not covered by the plain-Node unit test suite.

- [ ] **Step 1: Add the mixed-type check**

In `app/(app)/pos/pos-content/use-pos.ts`, change the current `handleAddItem` (lines 563-586):

```typescript
  const handleAddItem = (product: any | undefined) => {
    if (product) {
      setItems(prevItems => {
        const existing = prevItems.find(item => item.id === product.id);
        if (existing) {
          const newQty = existing.quantity + 1;
          const newPrice = calculateEffectivePrice(product, newQty, activeLevelId, defaultLevelId);
          return prevItems.map(item => item.id === product.id ? { ...item, quantity: newQty, price: newPrice } : item);
        } else {
          const newItem: SaleItem = {
            ...product, quantity: 1, discount: 0, name: product.name,
            price: calculateEffectivePrice(product, 1, activeLevelId, defaultLevelId),
            taxType: mapVatStatusToTaxType(product.vatStatus),
          };
          setSelectedItemId(newItem.id);
          return [...prevItems, newItem];
        }
      });
    } else {
      toast({ title: 'Error', description: 'Product not found', variant: 'destructive' });
    }
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };
```

to:

```typescript
  const handleAddItem = (product: any | undefined) => {
    if (product) {
      const existing = items.find(item => item.id === product.id);
      // Adding an existing line (quantity bump) never changes the cart's
      // document type, so only check on a genuinely new line.
      if (!existing && items.length > 0) {
        const cartType = items[0].type === 'service' ? 'service' : 'standard';
        const newItemType = product.type === 'service' ? 'service' : 'standard';
        if (cartType !== newItemType) {
          toast({
            title: 'Cannot Mix Goods and Services',
            description: 'This sale already has a ' + (cartType === 'service' ? 'service' : 'goods') + ' item. Please complete this as two separate transactions.',
            variant: 'destructive',
          });
          setInputValue('');
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      }
      setItems(prevItems => {
        const existing = prevItems.find(item => item.id === product.id);
        if (existing) {
          const newQty = existing.quantity + 1;
          const newPrice = calculateEffectivePrice(product, newQty, activeLevelId, defaultLevelId);
          return prevItems.map(item => item.id === product.id ? { ...item, quantity: newQty, price: newPrice } : item);
        } else {
          const newItem: SaleItem = {
            ...product, quantity: 1, discount: 0, name: product.name,
            price: calculateEffectivePrice(product, 1, activeLevelId, defaultLevelId),
            taxType: mapVatStatusToTaxType(product.vatStatus),
          };
          setSelectedItemId(newItem.id);
          return [...prevItems, newItem];
        }
      });
    } else {
      toast({ title: 'Error', description: 'Product not found', variant: 'destructive' });
    }
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: No new errors in `app/(app)/pos/pos-content/use-pos.ts`.

- [ ] **Step 3: Manual verification**

Since this is React UI state logic with no existing test harness for `use-pos.ts` in this repo (confirmed no jsdom/RTL infrastructure exists, per Batch 1's Task 4 finding), verify manually:
1. Start the dev server (`npm run dev`), open the POS screen.
2. Add a `standard`-type product to the cart.
3. Attempt to add a `service`-type product. Confirm: the add is blocked, a "Cannot Mix Goods and Services" toast appears, and the cart still only shows the original standard item.
4. Clear the cart, add a `service`-type product first, then attempt to add a `standard`-type product. Confirm the same blocking behavior in the reverse direction.
5. Add multiple units of the same product (quantity bump) — confirm this is never blocked, regardless of type.
6. Clear the cart and add two different `standard`-type products — confirm this is never blocked (same-type carts are unaffected).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "feat(pos): block adding goods and services to the same cart

Client-side mirror of the checkout API's mixed-cart rejection (Task 2)
— gives the cashier immediate feedback instead of only failing at
checkout submission time.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Receipt title and number — ESC/POS path

**Files:**
- Modify: `lib/receipt-generator.ts:58-90` (`generateReceipt` signature), `:178-183` (title + SI NO. logic)
- Test: `tests/unit/receipt-document-type.test.ts` (new)
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: a new `birOrNumber?: string` field on the `generateReceipt()` sale parameter, alongside the existing `siNumber?: string`.
- Produces: `generateReceipt()` prints `SALES INVOICE` + `SI NO.:` when `birOrNumber` is absent (or falls back to today's behavior when neither is present), and `OFFICIAL RECEIPT` + `OR NO.:` when `birOrNumber` is present.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/receipt-document-type.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { ReceiptGenerator } from '../../lib/receipt-generator';

// Goods sales print as a Sales Invoice (existing si_number, no cash/charge
// distinction in the title per this batch's design); services sales print
// as an Official Receipt using the new birOrNumber field.

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const baseSale = {
  items: [{ name: 'Rice', price: 100, quantity: 1, discount: 0, taxType: 'VAT' } as any],
  customer: null,
  totalDue: 100,
  change: 0,
  paymentMethod: 'CASH',
};

const gen = new ReceiptGenerator();

// ─── goods sale: SALES INVOICE, SI NO. ───────────────────────────────────
const goodsSale = decode(gen.generateReceipt({ ...baseSale, siNumber: '000123' }, null));
assert.ok(goodsSale.includes('SALES INVOICE'), 'goods sale title is SALES INVOICE');
assert.ok(!goodsSale.includes('OFFICIAL RECEIPT'), 'goods sale is not titled OFFICIAL RECEIPT');
assert.ok(goodsSale.includes('SI NO.: 000123'), 'goods sale prints SI NO. with the si_number');
assert.ok(!goodsSale.includes('OR NO.'), 'goods sale does not print an OR NO. line');

// ─── goods sale, CHARGE payment: still SALES INVOICE (no cash/charge split) ──
const chargeSale = decode(gen.generateReceipt({ ...baseSale, paymentMethod: 'CHARGE', siNumber: '000124' }, null));
assert.ok(chargeSale.includes('SALES INVOICE'), 'charge payment does not change the SALES INVOICE title');
assert.ok(!chargeSale.includes('CHARGE INVOICE'), 'old CHARGE INVOICE title no longer appears');

// ─── services sale: OFFICIAL RECEIPT, OR NO. ─────────────────────────────
const servicesSale = decode(gen.generateReceipt({ ...baseSale, birOrNumber: 'OR-000045' }, null));
assert.ok(servicesSale.includes('OFFICIAL RECEIPT'), 'services sale title is OFFICIAL RECEIPT');
assert.ok(!servicesSale.includes('SALES INVOICE'), 'services sale is not titled SALES INVOICE');
assert.ok(servicesSale.includes('OR NO.: OR-000045'), 'services sale prints OR NO. with the bir_or_number');
assert.ok(!servicesSale.includes('SI NO.'), 'services sale does not print a SI NO. line');

console.log('✓ receipt-document-type');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/receipt-document-type.test.ts`
Expected: FAIL — title is still always `CASH INVOICE`/`CHARGE INVOICE`, no `birOrNumber` handling exists.

- [ ] **Step 3: Add `birOrNumber` to the `generateReceipt` parameter type**

In `lib/receipt-generator.ts`, in the `generateReceipt` sale parameter object (currently lines 58-90), add a new field after `siNumber?: string;` (currently line 65):

```typescript
        siNumber?: string;
        birOrNumber?: string;
```

- [ ] **Step 4: Replace the title and SI/OR NO. logic**

Change the current lines 177-183:

```typescript
        // ─── SALE HEADER ───────────────────────────────────────────
        const title = paymentMethod?.toUpperCase() === 'CHARGE' ? 'CHARGE INVOICE' : 'CASH INVOICE';
        enc.raw([0x1b, 0x61, 0x31]).line(title).raw([0x1b, 0x61, 0x30]);
        // orderNumber is a per-terminal counter, not a BIR series — only a fallback
        // for rows written before si_number existed.
        const formattedSiNo = formatSINumber(sale.siNumber || orderNumber);
        enc.bold(true).line(`SI NO.: ${formattedSiNo}`).bold(false);
```

to:

```typescript
        // ─── SALE HEADER ───────────────────────────────────────────
        // Goods → Sales Invoice (si_number); services → Official Receipt
        // (birOrNumber). No cash/charge distinction in the title on either
        // side — payment method remains visible in the payment-section line
        // below. Exactly one of siNumber/birOrNumber is set per sale.
        const isServicesReceipt = !!sale.birOrNumber;
        const title = isServicesReceipt ? 'OFFICIAL RECEIPT' : 'SALES INVOICE';
        enc.raw([0x1b, 0x61, 0x31]).line(title).raw([0x1b, 0x61, 0x30]);
        if (isServicesReceipt) {
            enc.bold(true).line(`OR NO.: ${sale.birOrNumber}`).bold(false);
        } else {
            // orderNumber is a per-terminal counter, not a BIR series — only a fallback
            // for rows written before si_number existed.
            const formattedSiNo = formatSINumber(sale.siNumber || orderNumber);
            enc.bold(true).line(`SI NO.: ${formattedSiNo}`).bold(false);
        }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/unit/receipt-document-type.test.ts`
Expected: PASS, prints `✓ receipt-document-type`.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm run test:unit`
Expected: All tests pass, including `tests/unit/receipt-si-number.test.ts` — re-check this test's assertions still hold: it never sets `birOrNumber`, so `isServicesReceipt` is always `false` for its cases, and the `SI NO.:` line logic is otherwise unchanged from before this task. Its title-string assertions (if any) should be checked — this existing test does not currently assert on `title`/`CASH INVOICE`/`CHARGE INVOICE` text (confirmed from its contents), so it should be unaffected.

- [ ] **Step 7: Register the test**

In `tests/unit/run.ts`, add `import './receipt-document-type.test';`.

- [ ] **Step 8: Commit**

```bash
git add lib/receipt-generator.ts tests/unit/receipt-document-type.test.ts tests/unit/run.ts
git commit -m "feat(receipts): print SALES INVOICE / OFFICIAL RECEIPT by document type

Replaces the old CASH INVOICE / CHARGE INVOICE title (based on
payment method) with a title based on whether the sale is goods
(Sales Invoice, si_number) or services (Official Receipt, the new
birOrNumber). Payment method remains visible in the payment section.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Receipt title and number — browser path

**Files:**
- Modify: `app/(app)/pos/receipt/receipt-types.ts:13` (add `birOrNumber` field)
- Modify: `app/(app)/pos/receipt/ReceiptView.tsx:42-45` (title + SI/OR NO. logic)

**Interfaces:**
- Consumes: `saleDetails.birOrNumber?: string`, mirroring Task 5's `birOrNumber` on the ESC/POS side — same field name, same semantics (presence means services/OFFICIAL RECEIPT).
- Produces: browser-rendered receipt matches Task 5's ESC/POS output exactly in wording, following the cross-path consistency discipline established in Batch 1.

- [ ] **Step 1: Add `birOrNumber` to `ReceiptViewProps`**

In `app/(app)/pos/receipt/receipt-types.ts`, add a field after `siNumber?: number | string;` (currently line 13):

```typescript
    siNumber?: number | string;
    birOrNumber?: string;
```

- [ ] **Step 2: Replace the title and SI/OR NO. JSX**

In `app/(app)/pos/receipt/ReceiptView.tsx`, change the current lines 41-45:

```tsx
            <div className="mb-2 border-b border-dashed border-black pb-2">
                <div className="font-bold text-center border-y border-black py-1 mb-1 uppercase">
                    {paymentMethod?.toUpperCase() === 'CHARGE' ? 'CHARGE INVOICE' : 'CASH INVOICE'}
                </div>
                <div className="font-bold">SI NO.: {formatSINumber(saleDetails.siNumber || saleDetails.orderNumber)}</div>
```

to:

```tsx
            <div className="mb-2 border-b border-dashed border-black pb-2">
                <div className="font-bold text-center border-y border-black py-1 mb-1 uppercase">
                    {saleDetails.birOrNumber ? 'OFFICIAL RECEIPT' : 'SALES INVOICE'}
                </div>
                {saleDetails.birOrNumber ? (
                    <div className="font-bold">OR NO.: {saleDetails.birOrNumber}</div>
                ) : (
                    <div className="font-bold">SI NO.: {formatSINumber(saleDetails.siNumber || saleDetails.orderNumber)}</div>
                )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No new errors in `receipt-types.ts` or `ReceiptView.tsx`.

- [ ] **Step 4: Extend the browser-path watermark test file with a document-type check**

The existing `tests/unit/reprint-watermark-browser.test.ts` (from Batch 1) already renders `ReceiptView` via `renderToStaticMarkup` — append a document-type assertion block to that same file, after its existing `ReceiptView` section (before the `ZReadingPreview` section):

```typescript
// ─── ReceiptView document type (SALES INVOICE vs OFFICIAL RECEIPT) ──────
const goodsHtml = renderToStaticMarkup(
  React.createElement(ReceiptView, { saleDetails: { ...baseSaleDetails, siNumber: '000123' }, settings: null }),
);
assert.ok(goodsHtml.includes('SALES INVOICE'), 'goods sale renders SALES INVOICE title');
assert.ok(goodsHtml.includes('SI NO.: 000123'), 'goods sale renders SI NO. line');

const servicesHtml = renderToStaticMarkup(
  React.createElement(ReceiptView, { saleDetails: { ...baseSaleDetails, birOrNumber: 'OR-000045' }, settings: null }),
);
assert.ok(servicesHtml.includes('OFFICIAL RECEIPT'), 'services sale renders OFFICIAL RECEIPT title');
assert.ok(servicesHtml.includes('OR NO.: OR-000045'), 'services sale renders OR NO. line');

console.log('✓ reprint-watermark-browser (document type)');
```

- [ ] **Step 5: Run the test**

Run: `npx tsx tests/unit/reprint-watermark-browser.test.ts`
Expected: PASS, including the new `✓ reprint-watermark-browser (document type)` line alongside the existing two.

- [ ] **Step 6: Run the full suite**

Run: `npm run test:unit`
Expected: All tests pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/pos/receipt/receipt-types.ts" "app/(app)/pos/receipt/ReceiptView.tsx" tests/unit/reprint-watermark-browser.test.ts
git commit -m "feat(receipts): print SALES INVOICE / OFFICIAL RECEIPT on the browser print path

Mirrors Task 5's ESC/POS title/number change into ReceiptView.tsx,
keeping both print paths in agreement (same discipline established
in Batch 1 for the REPRINT watermark).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Z-reading — second range pair (SI and OR)

**Files:**
- Modify: `app/api/sales/z-reading/route.ts` (range queries — sales, void, return; both the main and per-shift variants)
- Modify: `lib/receipt-generator.ts` (`generateZReadingReceipt`) and `lib/z-reading-generator.ts` (`ZReadingGenerator.generate`) — print the new OR range lines
- Modify: `lib/types.ts` (`ZReadingData` interface) — add OR range fields
- Test: `tests/unit/z-reading-or-range.test.ts` (new)
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `bir_or_number` column from Task 1, on `sales_transactions`/`pos_transactions`.
- Produces: `ZReadingData` gains `minOrId?: string`, `maxOrId?: string`, `minVoidOrId?: string`, `maxVoidOrId?: string`, `minReturnOrId?: string`, `maxReturnOrId?: string` — mirroring the existing `minSaleId`/`maxSaleId`/`minVoidId`/`maxVoidId`/`minReturnId`/`maxReturnId` fields, one OR counterpart per existing SI field.

- [ ] **Step 1: Read the current exact Z-reading query code before editing**

Since prior research in this plan's design phase found the Z-reading MIN/MAX queries at approximate line numbers that may have shifted (the file has since been touched by Batch 1's work), read the current `app/api/sales/z-reading/route.ts` in full before making changes, to get exact current line numbers for:
- The main sales-range query (`MIN(st.si_number) as min_sale_id, MAX(st.si_number) as max_sale_id`)
- The void-range query (same shape, `status IN ('Void','Voided','Cancelled')`)
- The return-range query (same shape, `transaction_type = 'return'`)
- The per-shift variant with `CASE WHEN pt.transaction_type='sale' THEN st.si_number END`
- Where `minSaleId`/`maxSaleId` etc. are formatted/threaded into the response object (both the GET/preview path and the POST/commit path — this route has two near-identical code paths per Batch 1's prior research findings)

- [ ] **Step 2: Add OR-range queries alongside each existing SI-range query**

For each of the SI-range queries found in Step 1, add a parallel query (or extend the same query, whichever is more efficient given the actual current SQL structure) that computes the same MIN/MAX over `bir_or_number` instead of `si_number`, scoped with `WHERE bir_or_number IS NOT NULL` (or an equivalent `AND` condition merged into the existing WHERE clause) so goods and services ranges are never combined into one MIN/MAX. Example shape (adapt exact column/table aliases to match the file's actual current structure found in Step 1):

```sql
MIN(st.si_number) as min_sale_id, MAX(st.si_number) as max_sale_id,
MIN(st.bir_or_number) as min_sale_or_id, MAX(st.bir_or_number) as max_sale_or_id
```

Apply the same treatment to the void-range and return-range queries (with `_void_or_id`/`_return_or_id` naming), and to the per-shift `CASE WHEN` variant (add a parallel `CASE WHEN pt.transaction_type='sale' THEN st.bir_or_number END` alongside the existing SI-based one).

- [ ] **Step 3: Thread the new fields through the response objects**

Wherever `minSaleId`/`maxSaleId`/`minVoidId`/`maxVoidId`/`minReturnId`/`maxReturnId` are currently formatted (zero-padded, defaulted to `'000000'`) and placed into the response object — for both the GET/preview code path and the POST/commit code path — add the same formatting/defaulting for the new `minSaleOrId`/`maxSaleOrId`/`minVoidOrId`/`maxVoidOrId`/`minReturnOrId`/`maxReturnOrId` fields (default `'OR-000000'` to distinguish an empty OR range from an empty SI range, since the prefix carries meaning here).

- [ ] **Step 4: Add the new fields to `ZReadingData`**

In `lib/types.ts`, in the `ZReadingData` interface (currently lines 543-590 per Batch 1 research), add new optional fields alongside the existing `minSaleId?`/`maxSaleId?`/`minVoidId?`/`maxVoidId?`/`minReturnId?`/`maxReturnId?` (currently lines 570-575):

```typescript
  minSaleId?: string;
  maxSaleId?: string;
  minSaleOrId?: string;
  maxSaleOrId?: string;
  minVoidId?: string;
  maxVoidId?: string;
  minVoidOrId?: string;
  maxVoidOrId?: string;
  minReturnId?: string;
  maxReturnId?: string;
  minReturnOrId?: string;
  maxReturnOrId?: string;
```

- [ ] **Step 5: Write the failing test for the printed output**

Create `tests/unit/z-reading-or-range.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { ReceiptGenerator } from '../../lib/receipt-generator';

// Z-reading must print a distinct Beg./End. OR # range alongside the
// existing Beg./End. SI # range, never combining goods and services
// invoice numbers into one range.

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const gen = new ReceiptGenerator();

const zData = {
  reportDate: new Date('2026-08-11T18:00:00'),
  netSales: 1000,
  previousReading: 0,
  vatSales: 892.86,
  vatAmount: 107.14,
  vatExempt: 0,
  zeroRated: 0,
  grossSales: 1000,
  discounts: 0,
  returns: 0,
  voidAmount: 0,
  vatAdjustment: 0,
  paymentMethods: [{ name: 'CASH', amount: 1000 }],
  startingCash: 0,
  minSaleId: '000100',
  maxSaleId: '000105',
  minSaleOrId: 'OR-000010',
  maxSaleOrId: 'OR-000012',
  minVoidId: '000000',
  maxVoidId: '000000',
  minVoidOrId: 'OR-000000',
  maxVoidOrId: 'OR-000000',
  minReturnId: '000000',
  maxReturnId: '000000',
  minReturnOrId: 'OR-000000',
  maxReturnOrId: 'OR-000000',
  discountSummary: [],
};

const printed = decode(gen.generateZReadingReceipt(zData, null));

assert.ok(printed.includes('000100') && printed.includes('000105'), 'SI range still prints (unchanged)');
assert.ok(printed.includes('OR-000010') && printed.includes('OR-000012'), 'OR range prints alongside SI range');

console.log('✓ z-reading-or-range');
```

(Adjust the exact assertion strings/labels once Step 1-4's actual implementation is in place — this test's field names must match whatever `ZReadingData` fields Step 4 actually defines and whatever labels Step 6 actually prints.)

- [ ] **Step 6: Print the new OR range lines**

In `lib/receipt-generator.ts` (`generateZReadingReceipt`), find the existing lines that print `Beg. SI #:`/`End. SI #:`/`Beg. VOID #:`/`End. VOID #:`/`Beg. RETURN #:`/`End. RETURN #:` (per Batch 1 research, these are in the COUNTER SECTION, currently around lines 615-620) and add corresponding `Beg. OR #:`/`End. OR #:`/`Beg. VOID OR #:`/`End. VOID OR #:`/`Beg. RETURN OR #:`/`End. RETURN OR #:` lines immediately after each, reading from the new `data.minSaleOrId`/`data.maxSaleOrId`/etc. fields. Apply the identical treatment to `lib/z-reading-generator.ts`'s `ZReadingGenerator.generate()` (the browser/reprint-path generator fixed in Batch 1), keeping both generators' OR-range output in the same wording, per the cross-path consistency discipline.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx tsx tests/unit/z-reading-or-range.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full suite**

Run: `npm run test:unit`
Expected: All tests pass, including Batch 1's `z-reading-discount-summary.test.ts` and `reprint-watermark.test.ts` (both exercise the same generators — confirm the new OR-range lines don't disturb the existing DISCOUNT SUMMARY / REPRINT watermark output these tests check for).

- [ ] **Step 9: Register the test and commit**

In `tests/unit/run.ts`, add `import './z-reading-or-range.test';`.

```bash
git add app/api/sales/z-reading/route.ts lib/receipt-generator.ts lib/z-reading-generator.ts lib/types.ts tests/unit/z-reading-or-range.test.ts tests/unit/run.ts
git commit -m "feat(z-reading): print a separate Beg./End. OR # range alongside SI #

Prevents the goods (SI) and services (OR) numbering series from being
combined into one MIN/MAX range, which would misstate which invoices
were actually issued that day — exactly the artifact BIR examiners
reconcile against the physical invoice/OR booklets.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: X-reading — second range pair

**Files:**
- Modify: `app/api/sales/x-reading/route.ts` (range query, per Batch 1 research at approximately line 178-179 — re-verify exact line at implementation time)
- Modify: `lib/x-reading-generator.ts` and any X-reading preview component — print the OR range
- Modify: `lib/types.ts` (`XReadingData` interface, per Batch 1 research at approximately lines 594-632) — add `minSaleOrId?`/`maxSaleOrId?` fields

**Interfaces:**
- Consumes: `bir_or_number` column from Task 1.
- Produces: `XReadingData.minSaleOrId?: string`, `.maxSaleOrId?: string`, mirroring Task 7's Z-reading fields but for the shift-scoped X-reading (X-reading only tracks one sales range, not separate void/return ranges — confirm this against the actual current `XReadingData` interface before assuming symmetry with Z-reading).

- [ ] **Step 1: Read the current X-reading route and types before editing**

Read `app/api/sales/x-reading/route.ts` and the `XReadingData` interface in `lib/types.ts` in full to confirm exact current line numbers and the exact existing MIN/MAX query shape (X-reading may have a simpler range structure than Z-reading's four pairs — per Batch 1 research it has `minSaleId`/`maxSaleId` and separately `voidAmount`/`refundAmount` as plain totals, not ranges — confirm this before assuming a void/return range needs duplicating here).

- [ ] **Step 2: Add the OR-range query**

Following the same pattern as Task 7 Step 2, add `MIN(pt.bir_or_number)`/`MAX(pt.bir_or_number)` (or the correct table alias per Step 1's findings) alongside the existing SI MIN/MAX, scoped so goods and services ranges stay separate.

- [ ] **Step 3: Add fields to `XReadingData`**

In `lib/types.ts`, add `minSaleOrId?: string;` and `maxSaleOrId?: string;` alongside the existing `minSaleId?`/`maxSaleId?` fields in the `XReadingData` interface.

- [ ] **Step 4: Print the OR range**

In `lib/x-reading-generator.ts` (and the X-reading preview React component, if one exists separately per the browser-print pattern established in Batch 1 — check for an `x-reading-preview.tsx` equivalent to `z-reading-preview.tsx`), find where `Beg. SI #:`/`End. SI #:` currently print and add `Beg. OR #:`/`End. OR #:` immediately after.

- [ ] **Step 5: Write a test mirroring Task 7's**

Create `tests/unit/x-reading-or-range.test.ts` following the exact same structure as `tests/unit/z-reading-or-range.test.ts` (Task 7 Step 5), adapted to whatever generator function X-reading uses (confirm the function name/signature from Step 1's reading before writing the test).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx tests/unit/x-reading-or-range.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite, register the test, and commit**

Run: `npm run test:unit` — expected all pass.

In `tests/unit/run.ts`, add `import './x-reading-or-range.test';`.

```bash
git add app/api/sales/x-reading/route.ts lib/x-reading-generator.ts lib/types.ts tests/unit/x-reading-or-range.test.ts tests/unit/run.ts
git commit -m "feat(x-reading): print a separate Beg./End. OR # range alongside SI #

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(If Step 1 finds the X-reading preview is rendered by a separate component file, add that file to this commit's file list too.)

---

### Task 9: By-date report — second range pair

**Files:**
- Modify: `app/api/sales/by-date/route.ts` (range query, per Batch 1 research at approximately lines 76-77)
- Modify: `app/(app)/sales/by-date/ByDateTable.tsx`, `use-by-date-utils.ts`, `use-by-date-table.tsx`, `by-date-types.ts` (per Batch 1 research citations) — display the second pair

**Interfaces:**
- Consumes: `bir_or_number` column from Task 1.
- Produces: `by-date-types.ts` gains `startOrOr?: string`/`endOrOr?: string` fields (or better naming — confirm against the existing `startOR`/`endOR` naming convention found in Step 1 and follow it consistently, e.g. if existing fields are `startOR`/`endOR`, the new ones might be `startBirOr`/`endBirOr` to stay unambiguous per this plan's naming constraint).

- [ ] **Step 1: Read the current by-date route and types before editing**

Read `app/api/sales/by-date/route.ts` in full, noting the existing comment (per Batch 1 research) that already warns against mixing numbering schemes in one range — this is prior art for the exact kind of guard comment to add for the new OR range. Read `app/(app)/sales/by-date/by-date-types.ts` for the exact current field names (`startOR`/`endOR` per research, confirm current naming).

- [ ] **Step 2: Add the OR-range query**

Add `MIN(pt.bir_or_number) as start_bir_or, MAX(pt.bir_or_number) as end_bir_or` (or matching the file's actual current column-alias convention) to the existing per-day query, alongside the existing `MIN(pt.si_number)`/`MAX(pt.si_number)` pair. Add a comment matching the existing style, explaining why this must stay a separate pair (echoing the file's existing SI-vs-order-number mixing warning, extended to cover SI-vs-OR mixing).

- [ ] **Step 3: Thread the new fields through to display**

Update `by-date-types.ts`'s type definition, `use-by-date-utils.ts` and `use-by-date-table.tsx`'s data mapping, and `ByDateTable.tsx`'s rendering to show the new OR range as a second column/line alongside the existing SI range display — following whatever the existing SI range's display pattern is (confirmed in Step 1).

- [ ] **Step 4: Manual verification**

Since this is a report UI without existing unit-test coverage (confirmed no test file targets `by-date` per the research citations), verify manually: run a day with at least one goods sale and one services sale (as two separate transactions, since mixed carts are blocked), open the By-Date report, and confirm both an SI range and an OR range display correctly for that day, each reflecting only that day's transactions of the matching type.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: No new errors in the touched files.

```bash
git add app/api/sales/by-date/route.ts "app/(app)/sales/by-date/ByDateTable.tsx" "app/(app)/sales/by-date/use-by-date-utils.ts" "app/(app)/sales/by-date/use-by-date-table.tsx" "app/(app)/sales/by-date/by-date-types.ts"
git commit -m "feat(reports): show a separate OR range in the by-date sales report

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Adjust the exact file list in this commit to match whatever Step 1 finds are the real file paths — the by-date feature's file organization should be re-confirmed at implementation time.)

---

### Task 10: E-journal — second begin/end pair

**Files:**
- Modify: `app/api/sales/ejournal/route.ts` (per Batch 1 research at approximately lines 126-133)

**Interfaces:**
- Consumes: `bir_or_number` column from Task 1.
- Produces: the e-journal's printed/exported file gains a second "Beginning OR#"/"Ending OR#" line alongside the existing "Beginning SI#"/"Ending SI#" lines.

- [ ] **Step 1: Read the current e-journal route before editing**

Read `app/api/sales/ejournal/route.ts` in full, focusing on the sort-and-take-first/last computation (per research: `const siNumbers = validTxns.map(t => formatSINumber(t.si_number)).sort(); beginSI = siNumbers[0]; endSI = siNumbers[last];`).

- [ ] **Step 2: Add a parallel OR sort**

Add an equivalent computation for `bir_or_number`, filtering to only transactions where `bir_or_number` is non-null before sorting (so an all-goods day produces an empty OR list rather than a meaningless range), producing `beginOR`/`endOR` (or matching naming convention).

- [ ] **Step 3: Print the new lines in the e-journal output**

Find where `Beginning SI#`/`Ending SI#` are currently written into the e-journal file (per research, near where `beginSI`/`endSI` are used) and add `Beginning OR#`/`Ending OR#` immediately after, using a placeholder (e.g. `N/A` or blank) when no services sales occurred that day.

- [ ] **Step 4: Manual verification**

No existing unit test targets this route's output format directly (confirm this against `tests/unit/ejournal-*.test.ts` files, which per the file list test the standalone `lib/ejournal/` writer/formatter modules, not this API route directly). Verify manually: trigger an e-journal export for a day with both goods and services sales, confirm both ranges appear correctly in the output file.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: No new errors.

```bash
git add app/api/sales/ejournal/route.ts
git commit -m "feat(ejournal): print a separate Beginning/Ending OR# alongside SI#

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Fix `bir-summary`'s data source

**Files:**
- Modify: `app/api/sales/bir-summary/route.ts` (per Batch 1 research at approximately lines 47-48)
- Modify: `app/(app)/reports/sales/bir-summary/page.tsx` (per Batch 1 research citations)

**Interfaces:**
- Consumes: `si_number`/`bir_or_number` columns (the latter from Task 1).
- Produces: the `bir-summary` report's "Beginning/Ending SI/OR No." columns now genuinely reflect `si_number`/`bir_or_number`, replacing the current `receipt_number`-sourced values.

- [ ] **Step 1: Read the current bir-summary route before editing**

Read `app/api/sales/bir-summary/route.ts` in full, confirming the exact current query (per research: `MIN(st.receipt_number) as beginning_si, MAX(st.receipt_number) as ending_si`).

- [ ] **Step 2: Replace with two real pairs**

Change the query to compute two separate pairs:

```sql
MIN(st.si_number) as beginning_si, MAX(st.si_number) as ending_si,
MIN(st.bir_or_number) as beginning_or, MAX(st.bir_or_number) as ending_or
```

(Each should logically be scoped to non-null values for its own column — adapt to the file's actual current WHERE-clause structure, following the same non-null scoping principle used in Tasks 7-10.)

- [ ] **Step 3: Update the response shape and UI**

Update whatever object shape the route returns (currently likely `beginning_si`/`ending_si` under one label) to expose both pairs distinctly, then update `app/(app)/reports/sales/bir-summary/page.tsx` (per research, lines ~42-43, 204, 222, 229, 676-677) to render "Beginning/Ending SI No." and "Beginning/Ending OR No." as two distinct columns/rows instead of one combined "SI/OR" column.

- [ ] **Step 4: Manual verification**

Run the bir-summary report for a day with both goods and services sales. Confirm the SI range matches the actual `si_number` values issued that day (cross-check against Recent Sales or the sales_transactions table directly), and the OR range matches the actual `bir_or_number` values — neither should match the old `receipt_number` values anymore.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: No new errors.

```bash
git add app/api/sales/bir-summary/route.ts "app/(app)/reports/sales/bir-summary/page.tsx"
git commit -m "fix(reports): source bir-summary SI/OR range from si_number/bir_or_number

The report's 'Beginning/Ending SI/OR No.' columns were previously
sourced from receipt_number — a generic per-terminal receipt counter
unrelated to the actual BIR SI/OR classification — so the label never
matched the data. Now splits into two real, correctly-sourced pairs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test:unit`
Expected: All tests pass, including every new test file from this plan (Tasks 1, 2, 3, 5, 6, 7, 8) and every pre-existing test (Batch 1's and earlier).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors introduced by this plan's changes (pre-existing red baseline, per project memory, is not this plan's concern — confirm any errors present are unrelated to files this plan touched).

- [ ] **Step 3: Run the migration on a fresh/test database**

Run: `npm run migrate` against a clean test DB (or `npm run test:e2e:db` if that re-seeds a schema this plan's migration would apply to) to confirm the new migration applies cleanly from zero, not just incrementally on an already-migrated dev DB.

- [ ] **Step 4: End-to-end manual smoke test**

1. Ring up a goods-only sale (e.g. a `standard`-type product). Confirm: receipt title is "SALES INVOICE", prints `SI NO.: <number>`, and the sale row in `sales_transactions` has `si_number` set and `bir_or_number` NULL.
2. Ring up a services-only sale (a `service`-type product). Confirm: receipt title is "OFFICIAL RECEIPT", prints `OR NO.: OR-<number>`, and the sale row has `bir_or_number` set and `si_number` NULL.
3. Attempt to add both a goods and a services item to the same cart in the POS UI — confirm the client-side block (Task 4) fires.
4. Bypass the UI (e.g. via a direct API call or by temporarily disabling the client check) and submit a mixed-type checkout request directly — confirm the server rejects it with a 400 and neither `si_number` nor `bir_or_number` advances (check `transaction_references` before/after).
5. Run a shift covering at least one goods sale and one services sale through to a Z-reading. Confirm both an SI range and an OR range print, each showing only that shift's actual transactions of the matching type, with no cross-contamination.
6. Confirm a training-mode sale (either type) still burns neither `si_number` nor `bir_or_number`.
7. Open the `bir-summary` report for a day covering both sale types — confirm it shows two correct, distinct ranges, with no residual `receipt_number`-derived values.
8. Reprint a goods sale receipt and a services sale receipt (exercising Batch 1's REPRINT watermark logic together with this batch's title logic) — confirm both the REPRINT watermark and the correct SALES INVOICE/OFFICIAL RECEIPT title appear together correctly on each.
