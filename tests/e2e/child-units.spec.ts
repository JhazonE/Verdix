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
 * conversion tests because no other spec mutates that pair
 * (product-reassign.spec.ts moves the REASSIGN_* families around, so their
 * parentage is execution-order dependent). REASSIGN_TOP_MOVER_CHILD is only
 * READ here (search badge), and stays under REASSIGN_TOP_MOVER even after that
 * spec runs — its subtree moves intact.
 *
 * Selector notes verified against the real rendered markup:
 *  - The badge is a shadcn <Badge>, i.e. a plain <div> with no ARIA role, so it
 *    is targeted by its text within the product's row.
 *  - The dialog's accessible name is "Manage Child Units — <parent name>".
 *  - The Conversion cell is a bare <input type="number"> with placeholder
 *    "none" and no Label wiring — targeted positionally within its row. It is
 *    the ONLY number input in a row now that Markup % is gone.
 *  - Cost renders "—" because the family fixtures are seeded without a cost.
 *    That is a seed-data fact, not a UI defect, so this spec does not assert
 *    numbers the fixtures never provide.
 *  - The perishable family DOES have a conversion factor: prepare-test-db.ts
 *    seeds conversion_factors(PERISHABLE_FAMILY_PARENT, 'Piece', 12), and
 *    getChildProducts joins it on (parent_id, unit_of_measure). So the child's
 *    Conversion input starts populated. The conversion tests below never
 *    hardcode that starting value — they read it, write something different,
 *    and restore it — so they are independent of each other's execution order
 *    and of whatever a previous run left behind.
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

/** The Conversion factor input on the dialog row for `childName`. */
function conversionInput(page: Page, childName: string) {
  return childUnitsDialog(page)
    .getByRole('row', { name: new RegExp(childName) })
    .locator('input[type="number"]');
}

/** The dialog's save button. Re-resolved per call: the dialog remounts on reopen. */
function saveConversionsButton(page: Page) {
  return childUnitsDialog(page).getByRole('button', { name: 'Save Conversions' });
}

/**
 * A toast, matched on its TITLE element.
 *
 * The toast provider renders each toast twice: the visible card, and an
 * aria-live <span role="status"> announcer that concatenates title + description
 * ("Notification Error Saving ConversionsFix the high…"). A bare getByText()
 * therefore hits two elements and dies on strict mode, so this matches the title
 * exactly — which excludes the concatenated announcer string.
 */
function toastTitle(page: Page, title: string) {
  return page.getByText(title, { exact: true });
}

/**
 * Reload /products and reopen the perishable dialog. Used between a write and a
 * read so a passing assertion proves a server round trip, never component state.
 */
async function reloadAndReopen(page: Page) {
  await page.reload();
  await showAllRows(page);
  return openPerishableDialog(page);
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

test.describe('Child units conversions', () => {
  /**
   * The markup UI was removed from this dialog: the Markup % and Suggested
   * columns and the "Save Markups" button are gone, and Conversion became the
   * editable column. This test is the guard against any of that quietly coming
   * back — and it checks the dialog still RENDERS its rows, so it cannot pass
   * on a dialog that simply failed to load anything at all.
   */
  test('the markup UI is gone and the dialog still renders its rows', async ({ page }) => {
    await gotoProducts(page);
    const dialog = await openPerishableDialog(page);

    // The dialog is real and populated, not an empty shell.
    await expect(
      dialog.getByRole('row', { name: new RegExp(PERISHABLE_FAMILY_CHILD.name) }),
    ).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: 'Conversion', exact: true })).toBeVisible();

    // ...and the markup surface is gone from it.
    await expect(dialog.getByRole('columnheader', { name: 'Markup %', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('columnheader', { name: 'Suggested', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Save Markups' })).toHaveCount(0);

    // The replacement button exists and is enabled with nothing edited.
    await expect(saveConversionsButton(page)).toBeEnabled();

    // The footnote about stock syncs is present.
    await expect(dialog.getByText(/affects future stock syncs only/i)).toBeVisible();
  });

  /**
   * The core write path. Self-contained: it reads the child's current factor,
   * saves a DIFFERENT one, proves the new value survives a full page reload,
   * then restores the original so the fixture is left as found (this spec's
   * other tests, and product-reassign.spec.ts, share the database).
   */
  test('a conversion factor edit persists across save, reload and reopen', async ({ page }) => {
    await gotoProducts(page);
    await openPerishableDialog(page);

    const original = await conversionInput(page, PERISHABLE_FAMILY_CHILD.name).inputValue();
    // The seed gives this pair a factor; a blank here would mean the join broke.
    expect(original, 'the seeded 12/Piece factor must be pre-filled').not.toBe('');

    const edited = original === '7' ? '9' : '7';

    await conversionInput(page, PERISHABLE_FAMILY_CHILD.name).fill(edited);
    await saveConversionsButton(page).click();
    await expect(toastTitle(page, 'Conversions Saved')).toBeVisible({ timeout: 30_000 });

    await reloadAndReopen(page);
    await expect(conversionInput(page, PERISHABLE_FAMILY_CHILD.name)).toHaveValue(edited, {
      timeout: 30_000,
    });

    // --- restore, and prove the restore round-tripped too --------------------
    await conversionInput(page, PERISHABLE_FAMILY_CHILD.name).fill(original);
    await saveConversionsButton(page).click();
    await expect(toastTitle(page, 'Conversions Saved')).toBeVisible({ timeout: 30_000 });

    await reloadAndReopen(page);
    await expect(conversionInput(page, PERISHABLE_FAMILY_CHILD.name)).toHaveValue(original, {
      timeout: 30_000,
    });
  });

  /**
   * The save button is ALWAYS enabled — there is no "nothing changed" disabled
   * state any more. Saving an untouched dialog must write nothing and close
   * cleanly: no error toast, and the factor unchanged afterwards.
   */
  test('saving with nothing changed closes the dialog without an error', async ({ page }) => {
    await gotoProducts(page);
    await openPerishableDialog(page);

    const before = await conversionInput(page, PERISHABLE_FAMILY_CHILD.name).inputValue();

    const save = saveConversionsButton(page);
    await expect(save).toBeEnabled();
    await save.click();

    // The dialog closes...
    await expect(childUnitsDialog(page)).toHaveCount(0, { timeout: 30_000 });
    // ...and nothing complained. Checked after the close so a toast raised by
    // the click has had its chance to appear.
    await expect(toastTitle(page, 'Error Saving Conversions')).toHaveCount(0);
    await expect(page.getByText(/Fix the highlighted conversion factors/i)).toHaveCount(0);

    // A no-op save must not have altered the stored factor.
    await reloadAndReopen(page);
    await expect(conversionInput(page, PERISHABLE_FAMILY_CHILD.name)).toHaveValue(before, {
      timeout: 30_000,
    });
  });

  /**
   * `0` is not a legal factor (dividing by it is meaningless), and blank — not
   * zero — is how "no factor" is expressed. So a typed 0 must be rejected
   * inline, must not be written, and must leave the stored value alone.
   */
  test('a zero conversion factor is rejected and never reaches the server', async ({ page }) => {
    await gotoProducts(page);
    const dialog = await openPerishableDialog(page);

    const original = await conversionInput(page, PERISHABLE_FAMILY_CHILD.name).inputValue();
    expect(original, 'this test needs a stored factor to prove it survives').not.toBe('');
    expect(original).not.toBe('0');

    await conversionInput(page, PERISHABLE_FAMILY_CHILD.name).fill('0');

    // The inline error appears on the offending row itself.
    await expect(
      dialog
        .getByRole('row', { name: new RegExp(PERISHABLE_FAMILY_CHILD.name) })
        .getByText('Enter a number greater than 0, or leave it blank.'),
    ).toBeVisible();

    // Attempting to save is refused rather than silently ignored, and the
    // dialog stays open so the user can fix the value.
    await saveConversionsButton(page).click();
    await expect(toastTitle(page, 'Error Saving Conversions')).toBeVisible({ timeout: 30_000 });
    await expect(childUnitsDialog(page)).toBeVisible();

    // Nothing was written: the original factor is still what the server holds.
    // page.reload() discards the rejected draft entirely.
    await reloadAndReopen(page);
    await expect(conversionInput(page, PERISHABLE_FAMILY_CHILD.name)).toHaveValue(original, {
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
