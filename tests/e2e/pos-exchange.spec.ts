import { test, expect, type Page } from '@playwright/test';
import { testQuery, resetPosState } from './helpers/db';
import { TEST_USERS } from './fixtures/test-data';

/**
 * POS Exchange Item — full UI flow (Task 8, final integration checkpoint for the
 * feature). Task 4 (tests/e2e/pos-exchange-api.spec.ts) already covers the
 * POST /api/sales/exchanges route directly; these tests instead drive the real
 * POS UI (login → shift → Merch Credit → select item → exchange) the same way
 * tests/e2e/pos-sale.spec.ts drives a checkout.
 *
 * IMPORTANT — `/pos` does NOT use the `mock-user-session` localStorage key that
 * `seedSession`/`DEFAULT_ADMIN` (tests/e2e/helpers/auth.ts) write. The POS page
 * has its own login form (PosLoginForm) backed by its own localStorage keys
 * (`pos_current_user`, `pos_current_shift_id`), populated only by really
 * POSTing to /api/auth/login and /api/pos/shifts. So these tests log in via the
 * UI with a real seeded user (TEST_USERS.admin), exactly like pos-sale.spec.ts's
 * `posLogin`/`startShift` helpers, rather than the brief's `seedSession`
 * sketch — confirmed by reading app/(app)/pos/pos-content/use-pos.ts.
 *
 * Also corrected against the real rendered DOM/source (not the brief's guesses):
 *  - The footer button is labelled "Merch Credit", not "Merchandise Credit"
 *    (see PosFooterActions.tsx). Its accessible name still contains "Merch
 *    Credit" so `/merch credit/i` is used.
 *  - TransactionSearchBar's placeholder is "Search SI #, SO #, or customer
 *    name" (default prop), not literally "search" — but "search" is not a
 *    substring, so `getByPlaceholder(/SI #/i)` targets it directly.
 *  - The search box hits GET /api/pos/recent-sales?query=..., which matches
 *    against `pt.order_number`, `st.id`, `pt.si_number`, or `c.name` (see
 *    app/api/pos/recent-sales/route.ts) — so seeded sales are found by their
 *    `sales_transactions.id`, and a matching `pos_transactions` row (INNER
 *    JOIN) is mandatory or the sale never appears in the list at all.
 *  - TransactionPickRow renders a plain <button>, not test-id'd — its visible
 *    text includes the SI number/order number and the customer name, so we
 *    click on the seeded sale's own id text.
 *  - SelectItemsView's rows use shadcn Checkbox (role="checkbox"), matching
 *    the brief's guess. The Exchange button text is exactly "Exchange for
 *    Another Item" (button, not case-sensitive in our regex).
 *  - ProductSearchDialog's search field is a CommandInput with placeholder
 *    "Search by name or barcode...", not literally "search" as a full word —
 *    `getByPlaceholder(/search/i)` still matches it (substring "Search").
 *  - ExchangeBalanceView's confirm button says "Confirm Exchange"; the
 *    downsell-without-customer case shows the exact copy "This sale has no
 *    customer attached, so the difference cannot be credited." — matched with
 *    `/no customer attached/i`.
 *  - ExchangeSuccessView shows "Exchange Complete", "MC No.:" and, when present,
 *    "SI No.:" — matching the brief's assertions directly.
 *
 * A pre-existing, unrelated bug was flagged going into this task: an earlier
 * task in this session found tests/e2e/pos-sale.spec.ts's `addProductBySku`
 * (the POS barcode-add flow) timing out 10/10 across 3 spec files. Tests 1
 * and 2 below also drive product-search UI (ProductSearchDialog, picking a
 * REPLACEMENT item), in the same UI family, so that was the expected risk
 * here. In practice it did NOT block this feature — GET /api/products and
 * ProductSearchDialog's live search both work fine for these tests.
 *
 * What actually blocked tests 1 and 2 was a REAL bug in this feature's own
 * code, caught by writing this test: in ReturnSalesDialog.tsx,
 * ProductSearchDialog's onSelectProduct fires, then its own handleSelect
 * (use-product-search.ts) immediately calls onOpenChange(false) as part of
 * its normal "close after picking" behavior. The old onOpenChange wiring
 * unconditionally treated every close as the cashier backing out and called
 * handleBackFromReplacement(), which reset the step back to 'select_items'
 * in the same tick — undoing the pick every single time, even on success.
 * Fixed with a synchronous ref flag (justPickedReplacementRef) that
 * onSelectProduct sets before onOpenChange runs, since both callbacks close
 * over the same stale `step` value and can't distinguish the two cases by
 * reading state. See the fix in ReturnSalesDialog.tsx and task-8-report.md
 * for the full writeup with reproduction screenshots.
 */

const ADMIN = TEST_USERS.admin;
const TERMINAL_ID = 'test-terminal-1'; // TEST_TERMINAL.id

async function seedProductWithBaseUnit(opts: {
  id: string; name: string; price: number; cost: number; stock: number;
}) {
  await testQuery(
    `INSERT INTO products (id, name, price, cost, stock, sku, availability, type)
     VALUES (?, ?, ?, ?, ?, ?, 'Available', 'standard')`,
    [opts.id, opts.name, opts.price, opts.cost, opts.stock, `SKU-${opts.id}`]
  );
  await testQuery(
    `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base)
     VALUES (?, ?, 'Piece', 1, ?, ?, 1)`,
    [`psu-base-${opts.id}`, opts.id, opts.cost, opts.price]
  );
}

async function seedBatch(opts: { id: string; productId: string; qty: number; unitCost: number; sellingPrice: number }) {
  await testQuery(
    `INSERT INTO inventory_batches
       (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type)
     VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'purchase')`,
    [opts.id, opts.productId, opts.qty, opts.qty, opts.unitCost, opts.sellingPrice]
  );
}

async function seedActiveShift(id: string) {
  await testQuery(
    `INSERT INTO shifts (id, user_id, terminal_id, status, start_time)
     VALUES (?, ?, ?, 'active', NOW())`,
    [id, ADMIN.uid, TERMINAL_ID]
  );
}

/**
 * Seeds a completed sale that is findable through the real POS UI search flow:
 * GET /api/pos/recent-sales INNER JOINs pos_transactions, so a sale with no
 * matching pos_transactions row never appears in the pick list no matter what
 * is typed into the search box. `orderNumber` must be a distinct int per test
 * (pos_transactions.order_number is NOT NULL with no default).
 */
async function seedSale(opts: {
  saleId: string;
  orderNumber: number;
  total: number;
  customerId?: string | null;
  productId: string;
  productName: string;
  price: number;
  quantity?: number;
  sellingUnitId: string;
}) {
  const qty = opts.quantity ?? 1;
  await testQuery(
    `INSERT INTO sales_transactions (id, reference, receipt_number, total, payment_method, status, transaction_source, customer_id, date, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Cash', 'Paid', 'POS', ?, CURDATE(), NOW(), NOW())`,
    [opts.saleId, `REF-${opts.saleId}`, `RCPT-${opts.saleId}`, opts.total, opts.customerId ?? null]
  );
  await testQuery(
    `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, price, selling_unit_id, selling_unit_name, selling_unit_factor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Piece', 1, NOW())`,
    [`sale-item-${opts.saleId}`, opts.saleId, opts.productId, opts.productName, qty, opts.price, opts.sellingUnitId]
  );
  await testQuery(
    `INSERT INTO pos_transactions (id, sale_id, user_id, terminal_id, transaction_type, subtotal, total_amount, payment_method, order_number, si_number, created_at)
     VALUES (?, ?, ?, ?, 'sale', ?, ?, 'Cash', ?, ?, NOW())`,
    [`pt-${opts.saleId}`, opts.saleId, ADMIN.uid, TERMINAL_ID, opts.total, opts.total, opts.orderNumber, String(opts.orderNumber).padStart(6, '0')]
  );
}

/** A sale whose single line has ALREADY been fully returned (net quantity 0). */
async function seedFullyReturnedSale(opts: {
  saleId: string; orderNumber: number; productId: string; productName: string; price: number;
}) {
  await testQuery(
    `INSERT INTO sales_transactions (id, reference, receipt_number, total, payment_method, status, transaction_source, date, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Cash', 'Paid', 'POS', CURDATE(), NOW(), NOW())`,
    [opts.saleId, `REF-${opts.saleId}`, `RCPT-${opts.saleId}`, opts.price]
  );
  // Original sold row (+1) ...
  await testQuery(
    `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, price, selling_unit_id, selling_unit_name, selling_unit_factor, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'Piece', 1, NOW())`,
    [`sale-item-${opts.saleId}-orig`, opts.saleId, opts.productId, opts.productName, opts.price, `psu-base-${opts.productId}`]
  );
  // ... and a matching returned row (-1), netting to 0 remaining — the exact
  // shape GET /api/pos/recent-sales's itemsQuery expects (GREATEST/LEAST split).
  await testQuery(
    `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, price, selling_unit_id, selling_unit_name, selling_unit_factor, created_at)
     VALUES (?, ?, ?, ?, -1, ?, ?, 'Piece', 1, NOW())`,
    [`sale-item-${opts.saleId}-ret`, opts.saleId, opts.productId, opts.productName, opts.price, `psu-base-${opts.productId}`]
  );
  await testQuery(
    `INSERT INTO pos_transactions (id, sale_id, user_id, terminal_id, transaction_type, subtotal, total_amount, payment_method, order_number, si_number, created_at)
     VALUES (?, ?, ?, ?, 'sale', ?, ?, 'Cash', ?, ?, NOW())`,
    [`pt-${opts.saleId}`, opts.saleId, ADMIN.uid, TERMINAL_ID, opts.price, opts.price, opts.orderNumber, String(opts.orderNumber).padStart(6, '0')]
  );
}

const SEEDED_PRODUCT_IDS = [
  'E2E-EXCH-PROD-A', 'E2E-EXCH-PROD-B', 'E2E-EXCH-PROD-CHEAP', 'E2E-EXCH-PROD-RETURNED',
];

async function cleanupSeededProducts() {
  for (const id of SEEDED_PRODUCT_IDS) {
    await testQuery('DELETE FROM inventory_batches WHERE product_id = ?', [id]);
    await testQuery('DELETE FROM product_selling_units WHERE product_id = ?', [id]);
    await testQuery('DELETE FROM products WHERE id = ?', [id]);
  }
  await testQuery("DELETE FROM customers WHERE id = 'E2E-EXCH-CUSTOMER'");
}

async function posLogin(page: Page) {
  await page.goto('/pos');
  await expect(page.getByRole('heading', { name: /cashier login/i })).toBeVisible();
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: /login to pos/i }).click();
}

async function startShift(page: Page) {
  await expect(page.getByRole('heading', { name: /start new shift/i })).toBeVisible();
  await page.getByRole('button', { name: /start shift/i }).click();
  await expect(page.getByPlaceholder(/scan barcode or enter product sku/i)).toBeVisible();
}

/**
 * Opens Merch Credit, searches, and picks the seeded sale.
 *
 * IMPORTANT: TransactionPickRow does NOT render `sales_transactions.id` as
 * visible text at all — it renders `formatSINumber(sale.siNumber)` when an SI
 * number is present, falling back to `sale.orderNumber`, falling back to
 * `sale.id.substring(0, 7)` (see TransactionPickRow.tsx). Since our seeded
 * pos_transactions rows always carry an si_number, the row's visible text is
 * the SI number (a zero-padded/verbatim version of the numeric orderNumber
 * we seeded), never the raw `saleId` string. GET /api/pos/recent-sales does
 * match the raw sale id server-side (`st.id LIKE '%query%'`), so searching BY
 * saleId still finds and returns the row — but clicking must target the
 * order number text that's actually rendered, not the id used to search.
 */
async function openMerchCreditAndPickSale(page: Page, saleId: string, orderNumber: number) {
  await page.getByRole('button', { name: /merch credit/i }).click();
  await expect(page.getByText(/merchandise credit/i)).toBeVisible();
  const searchBox = page.getByPlaceholder(/SI #, SO #, or customer name/i);
  await searchBox.fill(saleId);
  // TransactionPickRow renders a <button> whose accessible name starts with
  // the SI/order number (e.g. "900001 Cash Walk-in Customer · Sep 25, ...
  // ₱50.00") — scope to role=button so this can't accidentally match the
  // number if it also appeared in a price or date elsewhere on the page.
  const row = page.getByRole('button', { name: new RegExp(`^${orderNumber}\\b`) });
  await expect(async () => {
    await expect(row.first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await row.first().click();
  await expect(page.getByText(/select items to return/i)).toBeVisible();
}

test.describe('POS Exchange Item — full UI flow', () => {
  test.beforeEach(async () => {
    await resetPosState();
    await cleanupSeededProducts();
  });

  test.afterEach(async () => {
    await cleanupSeededProducts();
  });

  test('even exchange completes through the UI and shows both numbers on the success screen', async ({ page }) => {
    await seedProductWithBaseUnit({ id: 'E2E-EXCH-PROD-A', name: 'E2E Exchange Product A', price: 50, cost: 30, stock: 9 });
    await seedProductWithBaseUnit({ id: 'E2E-EXCH-PROD-B', name: 'E2E Exchange Product B', price: 50, cost: 30, stock: 10 });
    await seedBatch({ id: 'e2e-batch-b-1', productId: 'E2E-EXCH-PROD-B', qty: 10, unitCost: 30, sellingPrice: 50 });
    await seedSale({
      saleId: 'E2E-EXCH-SALE-1', orderNumber: 900001, total: 50,
      productId: 'E2E-EXCH-PROD-A', productName: 'E2E Exchange Product A', price: 50,
      sellingUnitId: 'psu-base-E2E-EXCH-PROD-A',
    });

    await posLogin(page);
    await startShift(page);

    await openMerchCreditAndPickSale(page, 'E2E-EXCH-SALE-1', 900001);

    // Checkbox index 0 is the "Select all items" header checkbox (its own
    // click handler lives on the wrapping <div role="button">, not on the
    // Checkbox itself, so checking it directly does nothing) — index 1 is
    // the actual line-item checkbox that drives handleItemToggle.
    await page.getByRole('checkbox').nth(1).check();
    await page.getByRole('button', { name: /exchange for another item/i }).click();

    // ProductSearchDialog opens ("pick_replacement" step) — search for Product B.
    await expect(page.getByText(/search product/i)).toBeVisible();
    await page.getByPlaceholder(/search by name or barcode/i).fill('E2E Exchange Product B');
    await expect(async () => {
      await expect(page.getByText('E2E Exchange Product B').first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await page.getByText('E2E Exchange Product B').first().click();

    // Even exchange (both priced at 50): confirm directly.
    await expect(page.getByText(/settle exchange balance/i)).toBeVisible();
    await page.getByRole('button', { name: /confirm exchange/i }).click();

    await expect(page.getByText(/exchange complete/i)).toBeVisible();
    // .first(): the off-screen, always-mounted ExchangeSlipView (the printable
    // slip, positioned at top:-9999px in ReturnSalesDialog) renders its own
    // "MC NO.:"/"SI No.:" text too, so both strings exist twice in the DOM —
    // ExchangeSuccessView's on-screen copy is what actually matters here.
    await expect(page.getByText(/MC No\./i).first()).toBeVisible();
    await expect(page.getByText(/SI No\./i).first()).toBeVisible();
  });

  test('downsell exchange on a walk-in sale is blocked in the UI', async ({ page }) => {
    await seedProductWithBaseUnit({ id: 'E2E-EXCH-PROD-A', name: 'E2E Exchange Product A', price: 50, cost: 30, stock: 9 });
    await seedProductWithBaseUnit({ id: 'E2E-EXCH-PROD-CHEAP', name: 'E2E Exchange Cheap Product', price: 10, cost: 5, stock: 10 });
    await seedBatch({ id: 'e2e-batch-cheap-1', productId: 'E2E-EXCH-PROD-CHEAP', qty: 10, unitCost: 5, sellingPrice: 10 });
    // customer_id left NULL — a walk-in sale.
    await seedSale({
      saleId: 'E2E-EXCH-SALE-WALKIN', orderNumber: 900002, total: 50, customerId: null,
      productId: 'E2E-EXCH-PROD-A', productName: 'E2E Exchange Product A', price: 50,
      sellingUnitId: 'psu-base-E2E-EXCH-PROD-A',
    });

    await posLogin(page);
    await startShift(page);

    await openMerchCreditAndPickSale(page, 'E2E-EXCH-SALE-WALKIN', 900002);

    // Index 1 is the line-item checkbox — see the comment on the first test.
    await page.getByRole('checkbox').nth(1).check();
    await page.getByRole('button', { name: /exchange for another item/i }).click();

    await expect(page.getByText(/search product/i)).toBeVisible();
    await page.getByPlaceholder(/search by name or barcode/i).fill('E2E Exchange Cheap Product');
    await expect(async () => {
      await expect(page.getByText('E2E Exchange Cheap Product').first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await page.getByText('E2E Exchange Cheap Product').first().click();

    // Downsell (10 < 50) with no customer on the sale: ExchangeBalanceView must
    // show the warning copy and keep Confirm Exchange disabled.
    await expect(page.getByText(/settle exchange balance/i)).toBeVisible();
    await expect(page.getByText(/no customer attached/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm exchange/i })).toBeDisabled();
  });

  test('a fully-returned line cannot be selected for exchange again', async ({ page }) => {
    await seedProductWithBaseUnit({ id: 'E2E-EXCH-PROD-RETURNED', name: 'E2E Exchange Returned Product', price: 40, cost: 20, stock: 10 });
    await seedFullyReturnedSale({
      saleId: 'E2E-EXCH-SALE-FULLY-RETURNED', orderNumber: 900003,
      productId: 'E2E-EXCH-PROD-RETURNED', productName: 'E2E Exchange Returned Product', price: 40,
    });

    await posLogin(page);
    await startShift(page);

    await openMerchCreditAndPickSale(page, 'E2E-EXCH-SALE-FULLY-RETURNED', 900003);

    // Exact match: the row's line renders BOTH "Returned: 1 (fully returned)"
    // and a separate "Fully returned" badge — /fully returned/i matches both
    // and trips Playwright's strict mode, so assert on the badge specifically.
    await expect(page.getByText('Fully returned', { exact: true })).toBeVisible();
    // Index 1 is the line-item checkbox (index 0 is "Select all items",
    // which the SelectItemsView leaves enabled even though nothing under it
    // is selectable — see the comment on the first test).
    await expect(page.getByRole('checkbox').nth(1)).toBeDisabled();
    // With nothing selectable, Exchange must stay disabled too — it is gated
    // on selectedItems.size === 1, same as Issue Credit.
    await expect(page.getByRole('button', { name: /exchange for another item/i })).toBeDisabled();
  });

  test('X-reading total includes both legs of a committed exchange', async ({ page, request }) => {
    // This test seeds its exchange through the API (Task 4's route), not the
    // UI — only the X-reading endpoint itself is under test here, and it is
    // not part of the product-search UI family that may be blocked. Confirmed
    // by reading app/api/sales/x-reading/route.ts: GET has NO `terminalId`
    // query param (the brief's sketch assumed one that does not exist) — it
    // filters by `shiftId`/`cashierId`/`startDate`/`endDate` against the
    // `shifts` table and joins pos_transactions via pt.shift_id, so we filter
    // by the shift we seeded instead.
    await seedProductWithBaseUnit({ id: 'E2E-EXCH-PROD-A', name: 'E2E Exchange Product A', price: 50, cost: 30, stock: 9 });
    await seedProductWithBaseUnit({ id: 'E2E-EXCH-PROD-B', name: 'E2E Exchange Product B', price: 50, cost: 30, stock: 10 });
    await seedBatch({ id: 'e2e-batch-b-2', productId: 'E2E-EXCH-PROD-B', qty: 10, unitCost: 30, sellingPrice: 50 });
    await seedSale({
      saleId: 'E2E-EXCH-SALE-XREAD', orderNumber: 900004, total: 50,
      productId: 'E2E-EXCH-PROD-A', productName: 'E2E Exchange Product A', price: 50,
      sellingUnitId: 'psu-base-E2E-EXCH-PROD-A',
    });
    const shiftId = 'e2e-exchange-shift-xread';
    await seedActiveShift(shiftId);

    const res = await request.post('/api/sales/exchanges', {
      data: {
        saleId: 'E2E-EXCH-SALE-XREAD',
        returnItem: { productId: 'E2E-EXCH-PROD-A', productName: 'E2E Exchange Product A', quantity: 1, price: 50 },
        newItem: { productId: 'E2E-EXCH-PROD-B', productName: 'E2E Exchange Product B', quantity: 1, price: 50 },
        userId: ADMIN.uid,
        terminalId: TERMINAL_ID,
        shiftId,
      },
    });
    expect(res.ok()).toBe(true);
    const exchangeBody = await res.json();
    expect(exchangeBody.success).toBe(true);

    const xReadingRes = await request.get(`/api/sales/x-reading?shiftId=${shiftId}`);
    expect(xReadingRes.ok()).toBe(true);
    const xReadingBody = await xReadingRes.json();
    expect(xReadingBody.success).toBe(true);
    expect(xReadingBody.data).toHaveLength(1);

    const reading = xReadingBody.data[0];
    // The route's 'sale' aggregate: the new-item leg (Product B, 50) is a
    // pos_transactions row with transaction_type='sale' and a NOT-voided
    // sales_transactions.status, so it must appear in gross/net sales.
    expect(reading.grossSales).toBeCloseTo(50, 2);
    expect(reading.netSales).toBeCloseTo(50, 2);
    expect(reading.transactionCount).toBe(1);
    // The return leg (Product A, 50) is a pos_transactions row with
    // transaction_type='return' — ABS(SUM(total_amount)) per the route's
    // returns_amount SQL — so it must appear as the returns figure, separate
    // from the sale leg above (confirming no report code needed to change).
    expect(reading.returns).toBeCloseTo(50, 2);
  });
});
