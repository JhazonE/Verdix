import { test, expect } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import { testQuery } from './helpers/db';
import { BULK_PRICE_PRODUCT } from './fixtures/test-data';

const WORKFLOW_ID = 'wf-priceupdate-e2e';

/**
 * Bulk Price Update (DB-backed) — drives the "Bulk Update Price" drawer and its
 * Excel upload path on /products against the seeded verdix_test DB.
 *
 * Uses BULK_PRICE_PRODUCT, the only seeded product with a non-NULL warehouse_id
 * (see fixtures/test-data.ts) — the drawer's product picker filters by warehouse,
 * and every other seeded product has warehouse_id = NULL.
 *
 * Selectors were verified against the real rendered markup (not assumed from the
 * plan): the shadcn Checkbox renders `button[role="checkbox"]`, the "Value" input
 * has no htmlFor/id wiring to its Label (siblings, not nested), and the warehouse
 * Select uses SelectValue placeholder text "Select a warehouse".
 */

async function openDrawerAndSelectWarehouse(page: import('@playwright/test').Page) {
  await seedSession(page, DEFAULT_ADMIN);
  await page.goto('/products');
  await page.getByRole('button', { name: 'Bulk Update Price' }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Bulk Update Price')).toBeVisible();

  await drawer.getByText('Select a warehouse').click();
  await page.getByRole('option', { name: 'Test Warehouse' }).click();

  // Product table only renders once a warehouse is selected.
  await expect(drawer.getByText(BULK_PRICE_PRODUCT.sku)).toBeVisible();
  return drawer;
}

test.describe('Bulk Price Update', () => {
  test.afterAll(async ({ request }) => {
    // Safety net in case a mid-test failure skipped the inline cleanup — a
    // leftover workflow row or a left-on switch would break later specs that
    // share this DB (e.g. any other price-update path).
    await testQuery('DELETE FROM approval_workflows WHERE id=?', [WORKFLOW_ID]);
    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: false } });
  });

  test('drawer: approval OFF applies immediately', async ({ page, request }) => {
    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: false } });

    // Baseline price straight from the DB — don't assume the seeded value in case
    // an earlier run/spec mutated it.
    const before = await request.get(`/api/products?search=${BULK_PRICE_PRODUCT.sku}&limit=50`);
    const beforeBody = await before.json();
    const beforeProduct = (beforeBody.data ?? []).find((p: any) => p.sku === BULK_PRICE_PRODUCT.sku);
    expect(beforeProduct, 'seeded bulk-price product should exist').toBeTruthy();
    const priceBefore = parseFloat(beforeProduct.price);

    const drawer = await openDrawerAndSelectWarehouse(page);

    // Select the (only) product row's checkbox — shadcn Checkbox renders as
    // button[role="checkbox"], not a native input.
    const table = drawer.locator('table').first();
    await table.locator('tbody tr').first().getByRole('checkbox').check();

    // "Value" Label/Input are siblings with no htmlFor/id link, so getByLabel
    // doesn't resolve it — target the (only) number input in the drawer instead.
    await drawer.locator('input[type="number"]').fill('10');

    const submitButton = drawer.getByRole('button', { name: /Update 1 Product/ });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    await expect(page.getByText('Prices updated')).toBeVisible();

    const expectedPrice = Math.round(priceBefore * 1.1 * 100) / 100;
    await expect(async () => {
      const after = await request.get(`/api/products?search=${BULK_PRICE_PRODUCT.sku}&limit=50`);
      const afterBody = await after.json();
      const afterProduct = (afterBody.data ?? []).find((p: any) => p.sku === BULK_PRICE_PRODUCT.sku);
      expect(afterProduct, 'product still findable after update').toBeTruthy();
      expect(parseFloat(afterProduct.price)).toBeCloseTo(expectedPrice, 2);
    }).toPass({ timeout: 10_000 });
  });

  test('drawer: approval ON queues instead of applying', async ({ page, request }) => {
    // checkApprovalRequired('PRICE_UPDATE') needs BOTH the pos_settings switch AND
    // an approval_workflows row for the type (see lib/approvals.ts) — the schema
    // clone carries no data, so verdix_test has no workflow rows out of the box.
    // Assign the step to a non-Admin role so the seeded admin session can't
    // auto-skip it as "creator can approve their own step".
    await testQuery('DELETE FROM approval_workflows WHERE id=?', [WORKFLOW_ID]);
    const nonAdminRole = await testQuery("SELECT id FROM user_types WHERE name <> 'Admin' ORDER BY id LIMIT 1");
    const fallbackRole = nonAdminRole[0]?.id ?? (await testQuery('SELECT id FROM user_types LIMIT 1'))[0]?.id;
    await testQuery(
      "INSERT INTO approval_workflows (id, transaction_type, user_type_id, step_order) VALUES (?, 'PRICE_UPDATE', ?, 1)",
      [WORKFLOW_ID, fallbackRole],
    );

    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: true } });

    const before = await request.get(`/api/products?search=${BULK_PRICE_PRODUCT.sku}&limit=50`);
    const beforeBody = await before.json();
    const beforeProduct = (beforeBody.data ?? []).find((p: any) => p.sku === BULK_PRICE_PRODUCT.sku);
    const priceBefore = parseFloat(beforeProduct.price);

    const drawer = await openDrawerAndSelectWarehouse(page);

    const table = drawer.locator('table').first();
    await table.locator('tbody tr').first().getByRole('checkbox').check();
    await drawer.locator('input[type="number"]').fill('5');

    const submitButton = drawer.getByRole('button', { name: /Update 1 Product/ });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // exact:true — the toast description text also contains this phrase as a
    // substring ("Price update for 1 product(s) submitted for approval."),
    // which would otherwise resolve to 2 elements (strict-mode violation).
    await expect(page.getByText('Submitted for approval', { exact: true })).toBeVisible();

    // Price must NOT have moved — it's sitting in the approval queue, not applied.
    const after = await request.get(`/api/products?search=${BULK_PRICE_PRODUCT.sku}&limit=50`);
    const afterBody = await after.json();
    const afterProduct = (afterBody.data ?? []).find((p: any) => p.sku === BULK_PRICE_PRODUCT.sku);
    expect(parseFloat(afterProduct.price)).toBeCloseTo(priceBefore, 2);

    // Grab the queued row now, before approving, so we can assert its final
    // status independent of the UI flow below.
    const queueRows = await testQuery(
      "SELECT id FROM approval_queue WHERE transaction_type='PRICE_UPDATE' AND status='Pending' ORDER BY created_at DESC LIMIT 1",
    );
    expect(queueRows.length, 'a pending PRICE_UPDATE queue row should exist').toBe(1);
    const queueId = queueRows[0].id;

    await page.goto('/approvals');
    await page.getByText('Price Update', { exact: true }).click();
    await page.getByText(/Price Update:/).first().click();
    await expect(page.getByText(/Price Update:/).first()).toBeVisible();

    try {
      // Drives the full finalize->apply chain end to end:
      // app/api/approvals/process/route.ts's PRICE_UPDATE branch calls
      // submitPriceUpdateBatch(..., true) -> applyPriceUpdateBatch, which must
      // actually write to the DB. Before this, that chain had zero automated
      // coverage anywhere in the suite (see whole-branch review Finding 4).
      // The seeded admin session (userType 'Admin') satisfies the DetailView's
      // isAdmin bypass regardless of which role the workflow step targets, so
      // the Approve button is enabled here.
      const approveButton = page.getByRole('button', { name: 'Approve' });
      await expect(approveButton).toBeEnabled();
      await approveButton.click();

      const expectedApprovedPrice = Math.round(priceBefore * 1.05 * 100) / 100;
      await expect(async () => {
        const afterApproval = await request.get(`/api/products?search=${BULK_PRICE_PRODUCT.sku}&limit=50`);
        const afterApprovalBody = await afterApproval.json();
        const afterApprovalProduct = (afterApprovalBody.data ?? []).find((p: any) => p.sku === BULK_PRICE_PRODUCT.sku);
        expect(afterApprovalProduct, 'product still findable after approval').toBeTruthy();
        expect(parseFloat(afterApprovalProduct.price)).toBeCloseTo(expectedApprovedPrice, 2);
      }).toPass({ timeout: 10_000 });

      const finalRows = await testQuery('SELECT status FROM approval_queue WHERE id=?', [queueId]);
      expect(finalRows[0].status).toBe('Approved');
    } finally {
      // Revert the price so this mutation doesn't bleed into a re-run of this
      // spec file, same discipline as the other tests below.
      await testQuery('UPDATE products SET price = ? WHERE id = ?', [priceBefore, BULK_PRICE_PRODUCT.id]);
    }

    // Reset the setting AND remove the workflow row so neither bleeds into other
    // specs that share the DB.
    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: false } });
    await testQuery('DELETE FROM approval_workflows WHERE id=?', [WORKFLOW_ID]);
  });

  test('excel upload: valid + invalid rows in one file', async ({ page, request }) => {
    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: false } });

    // Baseline price straight from the DB, same discipline as the drawer tests —
    // don't assume the seeded value, and revert to it afterward.
    const before = await request.get(`/api/products?search=${BULK_PRICE_PRODUCT.sku}&limit=50`);
    const beforeBody = await before.json();
    const beforeProduct = (beforeBody.data ?? []).find((p: any) => p.sku === BULK_PRICE_PRODUCT.sku);
    expect(beforeProduct, 'seeded bulk-price product should exist').toBeTruthy();
    const priceBefore = parseFloat(beforeProduct.price);
    const newPrice = 123.45;

    try {
      const drawer = await openDrawerAndSelectWarehouse(page);

      await drawer.getByRole('button', { name: 'Upload Excel' }).click();

      const uploadDialog = page.getByRole('dialog').filter({ hasText: 'Upload Price List' });
      await expect(uploadDialog).toBeVisible();

      // Build a minimal xlsx in-memory with TWO rows: one valid row (real SKU,
      // matched via previewPriceListUpload's `new_price` branch — exercises the
      // apply path) and one row referencing a SKU that doesn't exist in this
      // warehouse (the skip path). Exercising both in one file matches the
      // brief's "valid + invalid rows in one file".
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([
        ['sku', 'barcode', 'new_price', 'new_cost', 'new_markup_pct'],
        [BULK_PRICE_PRODUCT.sku, '', String(newPrice), '', ''],
        ['BAD-SKU-DOES-NOT-EXIST', '', '99', '', ''],
      ]);
      XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      await uploadDialog.locator('input[type="file"]').setInputFiles({
        name: 'price-list.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: buf,
      });

      await expect(uploadDialog.getByText(/1 row\(s\) skipped/)).toBeVisible();
      const submitButton = uploadDialog.getByRole('button', { name: /Submit 1 Change/ });
      await expect(submitButton).toBeEnabled();
      await submitButton.click();

      await expect(page.getByText('Prices updated')).toBeVisible();

      // Verify the valid row actually persisted to the DB — not just previewed.
      await expect(async () => {
        const after = await request.get(`/api/products?search=${BULK_PRICE_PRODUCT.sku}&limit=50`);
        const afterBody = await after.json();
        const afterProduct = (afterBody.data ?? []).find((p: any) => p.sku === BULK_PRICE_PRODUCT.sku);
        expect(afterProduct, 'product still findable after update').toBeTruthy();
        expect(parseFloat(afterProduct.price)).toBeCloseTo(newPrice, 2);
      }).toPass({ timeout: 10_000 });
    } finally {
      // Revert so this test's mutation doesn't bleed into a re-run of this spec
      // file, same discipline as the drawer tests.
      await testQuery('UPDATE products SET price = ? WHERE id = ?', [priceBefore, BULK_PRICE_PRODUCT.id]);
    }
  });
});
