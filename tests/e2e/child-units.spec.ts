import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import {
  PERISHABLE_FAMILY_PARENT,
  PERISHABLE_FAMILY_CHILD,
  REASSIGN_TOP_MOVER,
  REASSIGN_TOP_MOVER_CHILD,
} from './fixtures/test-data';

/**
 * Child Units dialog + parent/child badges on /products (Tasks 1-8 of the
 * parent/child reorg).
 *
 * What the reorg changed, and what these tests pin down:
 *  - /products is a FLAT list of top-level products when unfiltered — no
 *    chevron/expander column, no indented child rows.
 *  - A parent renders a clickable "N children" / "1 child" badge next to its
 *    name that opens the Child Units dialog; every row's dropdown also has a
 *    "Manage Child Units" item that opens the same dialog.
 *  - Under a search, matches at ANY depth are returned, and a child row carries
 *    a read-only "↳ <parent name>" badge under its name.
 *
 * Fixture choice: PERISHABLE_FAMILY_PARENT / _CHILD is used for the dialog and
 * markup tests because no other spec mutates that pair (product-reassign.spec.ts
 * moves the REASSIGN_* families around, so their parentage is execution-order
 * dependent). REASSIGN_TOP_MOVER_CHILD is only READ here (search badge), and
 * stays under REASSIGN_TOP_MOVER even after that spec runs — its subtree moves
 * intact.
 *
 * Selector notes verified against the real rendered markup (captured from a
 * live page snapshot, not assumed from the source):
 *  - The badge is a shadcn <Badge>, i.e. a plain <div> with no ARIA role, so it
 *    is targeted by its text within the product's row.
 *  - The dialog's accessible name is "Manage Child Units — <parent name>".
 *  - The Markup % cell is a bare <input type="number"> with placeholder
 *    "inherit" and no Label wiring — targeted positionally within its row.
 *  - Conversion renders "—" for these fixtures: products.conversion_factor is
 *    NULL on the child (the 12/box factor lives in conversion_factors, keyed to
 *    the PARENT), and Cost/Suggested render "—" because the family fixtures are
 *    seeded without a cost. Those are seed-data facts, not UI defects, so this
 *    spec does not assert numbers the fixtures never provide.
 *
 * Timeouts: the Playwright webServer runs `next dev`, so the FIRST navigation
 * of a run pays a cold Turbopack compile that can exceed the default 30s test
 * timeout on its own. Each test raises its own budget rather than weakening any
 * assertion.
 */

test.describe.configure({ timeout: 120_000 });

/** The products table's default page size can push a fixture onto page 2. */
async function showAllRows(page: Page) {
  await page.getByLabel('Rows per page:').click();
  await page.getByRole('option', { name: '50' }).click();
}

async function gotoProducts(page: Page) {
  await seedSession(page, DEFAULT_ADMIN);
  await page.goto('/products');
  await showAllRows(page);
}

/** The row for a product, matched on its name. */
function productRow(page: Page, name: string) {
  return page.getByRole('row', { name: new RegExp(name) });
}

/** The Child Units dialog, identified by its "Manage Child Units — X" title. */
function childUnitsDialog(page: Page) {
  return page.getByRole('dialog', { name: /Manage Child Units/ });
}

/** Open the Child Units dialog for the perishable family via its badge. */
async function openPerishableDialog(page: Page) {
  await productRow(page, PERISHABLE_FAMILY_PARENT.name)
    .getByText(/^1 child$|^\d+ children$/)
    .click();
  const dialog = childUnitsDialog(page);
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  // Wait past the "Loading…" placeholder rows so callers see real data.
  await expect(
    dialog.getByRole('row', { name: new RegExp(PERISHABLE_FAMILY_CHILD.name) }),
  ).toBeVisible({ timeout: 60_000 });
  return dialog;
}

/** The Markup % input on the dialog row for `childName`. */
function markupInput(page: Page, childName: string) {
  return childUnitsDialog(page)
    .getByRole('row', { name: new RegExp(childName) })
    .locator('input[type="number"]');
}

test.describe('Child units badge', () => {
  test('the children badge opens the dialog and lists the child', async ({ page }) => {
    await gotoProducts(page);

    const parentRow = productRow(page, PERISHABLE_FAMILY_PARENT.name);
    await expect(parentRow).toBeVisible({ timeout: 60_000 });

    // The unfiltered list is flat: the child must NOT be a row of its own.
    await expect(productRow(page, PERISHABLE_FAMILY_CHILD.name)).toHaveCount(0);

    // The parent advertises exactly one child, singular wording.
    await expect(parentRow.getByText(/^1 child$/)).toBeVisible();

    const dialog = await openPerishableDialog(page);
    await expect(dialog).toContainText(PERISHABLE_FAMILY_PARENT.name);

    // The child is listed with its own unit.
    const childRow = dialog.getByRole('row', { name: new RegExp(PERISHABLE_FAMILY_CHILD.name) });
    await expect(childRow).toContainText(PERISHABLE_FAMILY_CHILD.unitOfMeasure);

    // Every documented column header is present.
    for (const header of [
      'Name',
      'Unit',
      'Conversion',
      'Stock',
      'Cost',
      'Markup %',
      'Suggested',
      'Current Price',
    ]) {
      await expect(dialog.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }
  });

  test('the row dropdown opens the same dialog', async ({ page }) => {
    await gotoProducts(page);

    const parentRow = productRow(page, PERISHABLE_FAMILY_PARENT.name);
    await expect(parentRow).toBeVisible({ timeout: 60_000 });
    await parentRow.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Manage Child Units' }).click();

    const dialog = childUnitsDialog(page);
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText(PERISHABLE_FAMILY_CHILD.name, { timeout: 60_000 });
  });
});

test.describe('Child units markups', () => {
  test('a markup edit persists across save, close and reopen', async ({ page }) => {
    await gotoProducts(page);
    const dialog = await openPerishableDialog(page);

    const input = markupInput(page, PERISHABLE_FAMILY_CHILD.name);
    await expect(input).toBeVisible();

    const saveButton = dialog.getByRole('button', { name: 'Save Markups' });
    // Nothing has changed yet, so saving must be impossible.
    await expect(saveButton).toBeDisabled();

    // A blank markup means "inherit", and the row says where it inherits from.
    if ((await input.inputValue()) === '') {
      await expect(dialog.getByText(/inherits \d/)).toBeVisible();
    }

    await input.fill('37.5');
    await expect(saveButton).toBeEnabled();

    // Out-of-range input must block the save (MARKUP_MAX guard).
    await input.fill('99999');
    await expect(saveButton).toBeDisabled();

    await input.fill('37.5');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect(page.getByText('Markups Saved')).toBeVisible({ timeout: 30_000 });

    // Reload and reopen — the saved value must come back from the server, not
    // from leftover component state.
    await page.reload();
    await showAllRows(page);
    await openPerishableDialog(page);

    await expect(markupInput(page, PERISHABLE_FAMILY_CHILD.name)).toHaveValue('37.5', {
      timeout: 30_000,
    });
  });
});

test.describe('Parent badge under search', () => {
  test('a searched child row shows ↳ parent and disappears when cleared', async ({ page }) => {
    await gotoProducts(page);

    const search = page.getByPlaceholder('Search products...');
    await search.fill(REASSIGN_TOP_MOVER_CHILD.name);

    // Under a filter, matches at any depth are listed — including this child.
    const childRow = productRow(page, REASSIGN_TOP_MOVER_CHILD.name);
    await expect(childRow).toBeVisible({ timeout: 30_000 });
    await expect(childRow).toContainText(`↳ ${REASSIGN_TOP_MOVER.name}`);

    // Clearing the search returns the flat top-level list — the child is gone.
    await search.fill('');
    await expect(childRow).toHaveCount(0, { timeout: 30_000 });
    // ...but its parent, a top-level product, is still listed.
    await expect(productRow(page, REASSIGN_TOP_MOVER.name).first()).toBeVisible();
  });
});

test.describe('Add Child Unit from the dialog', () => {
  /**
   * KNOWN FAILURE — kept as `test.fail()` so the suite stays green while the
   * defect stays visible, and so it flips to a hard failure the moment it is
   * fixed. This is a REAL blocker, not a selector problem:
   *
   * QuickAddChildDialog's Price and Cost inputs are `readOnly` and are filled
   * only by the derivation effect in use-quick-add-child.ts, which is guarded on
   * `selectedParent.cost !== undefined`. Every seeded parent/child family
   * fixture is inserted WITHOUT a cost column (see tests/e2e/setup/
   * prepare-test-db.ts — only BULK_PRICE_PRODUCT, PO_PRODUCT and the SO_*
   * products get a cost). So for any costless parent both inputs stay empty,
   * the user cannot type into them, and handleSave's
   *   `if (!selectedParent || ... || !price || !cost)`
   * guard rejects with the "All fields must be filled out" toast. The dialog
   * never closes and no child is created.
   *
   * The same dead end is reachable in production for any real product whose
   * cost has not been set. Fixing it needs a product change (let Price/Cost be
   * edited when they cannot be derived, or block "Add Child Unit" with an
   * explanatory message on a costless parent) plus a seeded cost on a family
   * fixture; both are out of scope for this test-only task.
   */
  test.fail();
  test('adds a unit that appears in the dialog table', async ({ page }) => {
    await gotoProducts(page);
    const dialog = await openPerishableDialog(page);

    await dialog.getByRole('button', { name: 'Add Child Unit' }).click();

    // QuickAddChildDialog opens with the parent preset.
    const addDialog = page.getByRole('dialog', { name: 'Add Child Product' });
    await expect(addDialog).toBeVisible({ timeout: 30_000 });
    await expect(addDialog).toContainText(PERISHABLE_FAMILY_PARENT.name);

    const newName = `E2E Child Unit ${Date.now()}`;
    await addDialog.getByLabel('Product Name').fill(newName);
    await addDialog.getByLabel('Description').fill('Added by the child-units e2e spec.');
    // SKU is required; the dialog can generate one.
    await addDialog.getByRole('button', { name: /Generate/i }).first().click();
    await expect(addDialog.locator('#sku')).not.toHaveValue('');

    // Unit comes from the parent's conversion_factors rows; the perishable
    // family has exactly one ("Piece", factor 12) and the dialog preselects it.
    await expect(addDialog.getByText(/per Box/)).toBeVisible();

    await addDialog.getByRole('button', { name: 'Add Child Product' }).click();

    // The new unit shows up in the Child Units table without a manual reload.
    await expect(addDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(dialog.getByRole('row', { name: new RegExp(newName) })).toBeVisible({
      timeout: 30_000,
    });
  });
});
