import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import {
  REASSIGN_PARENT_A,
  REASSIGN_PARENT_B,
  REASSIGN_CHILD,
  REASSIGN_TOP_MOVER,
  REASSIGN_TOP_TARGET,
  REASSIGN_TOP_MOVER_CHILD,
  REASSIGN_AUTO_MOVER,
  REASSIGN_AUTO_MATCH,
  REASSIGN_AUTO_NOMATCH,
} from './fixtures/test-data';

/**
 * Family MEMBERSHIP changes (DB-backed), driven through the Child Units dialog
 * against verdix_test. Verified through the API: parent_id actually moved.
 *
 * ROUTE CHANGE (the child-unit membership work). Membership used to be changed
 * from the view-product dialog's "Reassign Parent" button; that control and its
 * ReassignParentDialog are gone. Everything now happens inside the parent's
 * Child Units dialog:
 *   - attach : footer "Add Child Unit" ▾ → "Add existing product" → pick → factor → confirm
 *   - move   : the child row's ⋮ → "Move to another parent" → pick → factor → Move
 *   - detach : the child row's ⋮ → "Remove from family" → confirm
 * The view-product dialog now only *reports* membership: a read-only
 * "Child of <parent>" line with a "Manage" link into the PARENT's dialog.
 *
 * The three tests below keep their original names and their fetchParentId
 * assertions unchanged — only the UI steps were rewritten.
 *
 * Selector notes (taken from the real components, not guessed):
 *  - The child-units dialog's accessible name is "Manage Child Units — <parent>".
 *  - The picker is one component in two framings: title "Add Existing Product"
 *    (mode add) or "Move to Another Parent" (mode move). Its candidate list is
 *    plain <button>s, not listbox options, so they are matched by role button
 *    inside the picker dialog.
 *  - The confirm button's LABEL is the feature's own signal of whether stock is
 *    about to be cleared: "Add as child" vs "Clear stock and add as child".
 *  - The ⋮ trigger on a dialog row has the sr-only text "Open menu", same as
 *    the products table's — hence every ⋮ lookup is scoped to its own row.
 *
 * Timeouts: the Playwright webServer runs `next dev`, so the first navigation
 * of a run pays a cold Turbopack compile that can exceed the default 30s test
 * timeout on its own. The file raises its budget rather than weakening any
 * assertion.
 */

test.describe.configure({ timeout: 120_000 });

async function fetchParentId(request: any, sku: string): Promise<string | null> {
  const res = await request.get(`/api/products?search=${sku}&limit=50`);
  const body = await res.json();
  const match = (body.data ?? []).find((p: any) => p.sku === sku);
  return match ? (match.parentId ?? match.parent_id ?? null) : null;
}

async function fetchStock(request: any, sku: string): Promise<number | null> {
  const res = await request.get(`/api/products?search=${sku}&limit=50`);
  const body = await res.json();
  const match = (body.data ?? []).find((p: any) => p.sku === sku);
  return match ? Number(match.stock) : null;
}

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

function productRow(page: Page, name: string) {
  return page.getByRole('row', { name: new RegExp(name) });
}

/** The Child Units dialog, identified by its "Manage Child Units — X" title. */
function childUnitsDialog(page: Page) {
  return page.getByRole('dialog', { name: /Manage Child Units/ });
}

/**
 * Open a product's Child Units dialog through its row dropdown — the one entry
 * point that works whether or not the product currently has children (the
 * "N children" badge only exists once it has some, so a would-be parent with an
 * empty family is unreachable that way).
 */
async function openChildUnitsFor(page: Page, name: string) {
  const row = productRow(page, name).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Manage Child Units' }).click();
  const dialog = childUnitsDialog(page);
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText(name, { timeout: 60_000 });
  return dialog;
}

/** A child's row inside the open Child Units dialog. */
function childRow(page: Page, childName: string) {
  return childUnitsDialog(page).getByRole('row', { name: new RegExp(childName) });
}

/** Open the ⋮ menu on a child's dialog row. */
async function openChildRowMenu(page: Page, childName: string) {
  const row = childRow(page, childName);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: 'Open menu' }).click();
}

/**
 * Drive the shared picker: search the whole catalogue, select `targetName`, set
 * the factor, then press `confirmLabel`. Returns nothing — callers assert on the
 * DB afterwards.
 */
async function pickInPicker(
  page: Page,
  picker: ReturnType<Page['getByRole']>,
  target: { name: string; sku: string },
  factor: string,
) {
  await selectCandidate(picker, target);
  await picker.locator('#add-existing-factor').fill(factor);
}

/**
 * A candidate button in the picker renders the name AND the SKU as sibling
 * spans, so its accessible name is "<name> <sku>". Matching on both pins the
 * exact product — "Reassign Parent A" alone would also match a hypothetical
 * "Reassign Parent A2".
 */
async function selectCandidate(
  picker: ReturnType<Page['getByRole']>,
  target: { name: string; sku: string },
) {
  await picker.getByPlaceholder('Search by name, SKU or barcode...').fill(target.name);
  const option = picker.getByRole('button', { name: `${target.name} ${target.sku}`, exact: true });
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
}

test.describe('Child reassignment', () => {
  test('admin mo-reassign sa child ngadto sa bag-ong parent', async ({ page, request }) => {
    await gotoProducts(page);

    // Precondition: child starts under Parent A.
    expect(await fetchParentId(request, REASSIGN_CHILD.sku)).toBe(REASSIGN_PARENT_A.id);

    // ATTACH through the NEW parent's dialog: Parent B adopts the child.
    // Parent B has no children yet, so the dialog is reached via the row menu.
    const dialog = await openChildUnitsFor(page, REASSIGN_PARENT_B.name);
    await expect(dialog).toContainText('No child units yet.', { timeout: 60_000 });

    await dialog.getByRole('button', { name: 'Add Child Unit' }).click();
    await page.getByRole('menuitem', { name: 'Add existing product' }).click();

    const picker = page.getByRole('dialog', { name: 'Add Existing Product' });
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await pickInPicker(page, picker, REASSIGN_CHILD, '24');

    // The child carries no stock, so this is the plain attach path — the label
    // itself proves no stock clear is being offered.
    const confirm = picker.getByRole('button', { name: 'Add as child', exact: true });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(picker).toHaveCount(0, { timeout: 30_000 });

    // Verify parent_id moved to Parent B.
    await expect(async () => {
      expect(await fetchParentId(request, REASSIGN_CHILD.sku)).toBe(REASSIGN_PARENT_B.id);
    }).toPass({ timeout: 15_000 });

    // ...and the UI agrees: the child is now listed in Parent B's family.
    await expect(childRow(page, REASSIGN_CHILD.name)).toBeVisible({ timeout: 30_000 });
  });

  test('admin mo-move sa child ngadto sa lain nga parent gikan sa row menu', async ({
    page,
    request,
  }) => {
    await gotoProducts(page);

    // MOVE is the ⋮ path, and it is a genuinely distinct code path from attach:
    // the picker runs in mode="move" (the subject is the CHILD, the candidate is
    // its future PARENT) and calls reassignParent directly with no stock clear.
    //
    // Whichever of A/B currently holds the child, this moves it to the OTHER
    // one — so the test states a real, checkable change of family without
    // depending on the attach test above having run first.
    const from = await fetchParentId(request, REASSIGN_CHILD.sku);
    expect(from).not.toBeNull();
    const fromName = from === REASSIGN_PARENT_B.id ? REASSIGN_PARENT_B.name : REASSIGN_PARENT_A.name;
    const to = from === REASSIGN_PARENT_B.id ? REASSIGN_PARENT_A : REASSIGN_PARENT_B;

    await openChildUnitsFor(page, fromName);
    await openChildRowMenu(page, REASSIGN_CHILD.name);
    await page.getByRole('menuitem', { name: 'Move to another parent' }).click();

    const movePicker = page.getByRole('dialog', { name: 'Move to Another Parent' });
    await expect(movePicker).toBeVisible({ timeout: 30_000 });
    // The picker names the product being moved, so a mis-clicked row is visible.
    await expect(movePicker).toContainText(REASSIGN_CHILD.name);
    await pickInPicker(page, movePicker, to, '7');
    await movePicker.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(movePicker).toHaveCount(0, { timeout: 30_000 });

    // It genuinely changed families — not merely "a row is still visible".
    await expect(async () => {
      expect(await fetchParentId(request, REASSIGN_CHILD.sku)).toBe(to.id);
    }).toPass({ timeout: 15_000 });

    // The old family no longer lists it.
    await expect(childRow(page, REASSIGN_CHILD.name)).toHaveCount(0, { timeout: 30_000 });
  });

  test('admin mo-detach sa child gikan sa iyang family', async ({ page, request }) => {
    await gotoProducts(page);

    // This test is self-contained about WHICH parent holds the child: the
    // tests above may or may not have run (--grep, retries, sharding), so
    // read the current parent from the DB instead of assuming one.
    const currentParentId = await fetchParentId(request, REASSIGN_CHILD.sku);
    expect(currentParentId).not.toBeNull();
    const parentName =
      currentParentId === REASSIGN_PARENT_B.id ? REASSIGN_PARENT_B.name : REASSIGN_PARENT_A.name;

    await openChildUnitsFor(page, parentName);
    await expect(childRow(page, REASSIGN_CHILD.name)).toBeVisible({ timeout: 60_000 });

    await openChildRowMenu(page, REASSIGN_CHILD.name);
    await page.getByRole('menuitem', { name: 'Remove from family' }).click();

    // A blocking confirm that names the product, so a mis-clicked row is
    // visible before it is destructive.
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toContainText(
      `Remove ${REASSIGN_CHILD.name} from this family?`,
    );
    await expect(confirmDialog).toContainText('It becomes a top-level product.');
    await confirmDialog.getByRole('button', { name: 'Remove', exact: true }).click();

    // Detached: it has no parent at all now.
    await expect(async () => {
      expect(await fetchParentId(request, REASSIGN_CHILD.sku)).toBeNull();
    }).toPass({ timeout: 15_000 });

    // ...and it is gone from the family it used to belong to.
    await expect(childRow(page, REASSIGN_CHILD.name)).toHaveCount(0, { timeout: 30_000 });
  });
});

test.describe('Top-level reassignment', () => {
  test('admin mo-move sa top-level mother ngadto sa bag-ong parent', async ({ page, request }) => {
    await gotoProducts(page);

    // Precondition: the mover is top-level, its child nests under it.
    expect(await fetchParentId(request, REASSIGN_TOP_MOVER.sku)).toBeNull();
    expect(await fetchParentId(request, REASSIGN_TOP_MOVER_CHILD.sku)).toBe(REASSIGN_TOP_MOVER.id);

    // The mover is top-level and carries stock (fixture seeds stock: 8), so the
    // "add existing" path is the correct one here: it is the flow that offers
    // to clear that stock. The dedicated stock-clearing test below asserts the
    // warning; this one is about the SUBTREE surviving the move, so it goes the
    // same way and checks the child afterwards.
    const dialog = await openChildUnitsFor(page, REASSIGN_TOP_TARGET.name);

    await dialog.getByRole('button', { name: 'Add Child Unit' }).click();
    await page.getByRole('menuitem', { name: 'Add existing product' }).click();

    const picker = page.getByRole('dialog', { name: 'Add Existing Product' });
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await pickInPicker(page, picker, REASSIGN_TOP_MOVER, '10');
    await picker
      .getByRole('button', { name: /^(Add as child|Clear stock and add as child)$/ })
      .click();
    await expect(picker).toHaveCount(0, { timeout: 30_000 });

    // The mover now nests under the target...
    await expect(async () => {
      expect(await fetchParentId(request, REASSIGN_TOP_MOVER.sku)).toBe(REASSIGN_TOP_TARGET.id);
    }).toPass({ timeout: 15_000 });

    // ...and its own child still nests under the mover (subtree moved intact).
    expect(await fetchParentId(request, REASSIGN_TOP_MOVER_CHILD.sku)).toBe(REASSIGN_TOP_MOVER.id);
  });

});

test.describe('Reassign factor auto-detect', () => {
  /**
   * Auto-detect survived the route change: the picker still pre-fills the
   * conversion factor when the fixed side already knows the candidate's unit,
   * and still labels it "Auto-detected from X".
   *
   * In 'add' framing the SUBJECT is the parent, so the lookup runs over the
   * parent's own conversion_factors for the CANDIDATE's unit. REASSIGN_AUTO_MATCH
   * is seeded with a "Box" factor of 4 and REASSIGN_AUTO_MOVER's unit is "Box",
   * so opening AUTO_MATCH's dialog and picking AUTO_MOVER is the auto-detect
   * case; REASSIGN_AUTO_NOMATCH has no Box factor, so picking AUTO_MOVER from
   * ITS dialog is the genuine blank case.
   */
  test('auto-fills the factor from a parent that already knows the unit', async ({ page }) => {
    await gotoProducts(page);

    // 1) A parent that DOES know the candidate's unit → pre-filled + hint.
    const matchDialog = await openChildUnitsFor(page, REASSIGN_AUTO_MATCH.name);
    await matchDialog.getByRole('button', { name: 'Add Child Unit' }).click();
    await page.getByRole('menuitem', { name: 'Add existing product' }).click();

    const picker = page.getByRole('dialog', { name: 'Add Existing Product' });
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await selectCandidate(picker, REASSIGN_AUTO_MOVER);

    await expect(picker.locator('#add-existing-factor')).toHaveValue('4.00');
    await expect(picker.getByText(/Auto-detected from/)).toBeVisible();

    // 2) A parent that does NOT → blank, no hint.
    await picker.getByRole('button', { name: 'Cancel' }).click();
    await expect(picker).toHaveCount(0, { timeout: 30_000 });
    await matchDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(matchDialog).toHaveCount(0, { timeout: 30_000 });

    const nomatchDialog = await openChildUnitsFor(page, REASSIGN_AUTO_NOMATCH.name);
    await nomatchDialog.getByRole('button', { name: 'Add Child Unit' }).click();
    await page.getByRole('menuitem', { name: 'Add existing product' }).click();

    const picker2 = page.getByRole('dialog', { name: 'Add Existing Product' });
    await expect(picker2).toBeVisible({ timeout: 30_000 });
    await selectCandidate(picker2, REASSIGN_AUTO_MOVER);

    await expect(picker2.locator('#add-existing-factor')).toHaveValue('');
    await expect(picker2.getByText(/Auto-detected from/)).toHaveCount(0);
  });
});

test.describe('Adding a stocked product as a child', () => {
  /**
   * The user-visible half of clearStockAndReassign's rollback property: a
   * product that HAS stock can still be adopted, but only after being warned
   * that the stock is destroyed — a child's stock is derived from its parent,
   * so it cannot keep its own.
   *
   * The warning is not decoration: the confirm button's label changes with it,
   * and the underlying server action changes too (clearStockAndReassign rather
   * than plain reassignParent). Both the label and the resulting stock=0 are
   * asserted, so a UI that showed the warning but silently kept the stock — or
   * cleared stock with no warning — would fail here.
   *
   * REASSIGN_PARENT_A is the stocked candidate (fixture stock: 10). By the time
   * this runs, the "Child reassignment" tests have taken REASSIGN_CHILD away
   * from it, so it is a childless top-level product with stock — but the test
   * does not depend on that: it asserts the precondition it needs.
   */
  test('warns about stock, clears it, and attaches the product', async ({ page, request }) => {
    await gotoProducts(page);

    const stockBefore = await fetchStock(request, REASSIGN_PARENT_A.sku);
    expect(stockBefore).toBeGreaterThan(0);

    const dialog = await openChildUnitsFor(page, REASSIGN_PARENT_B.name);
    await dialog.getByRole('button', { name: 'Add Child Unit' }).click();
    await page.getByRole('menuitem', { name: 'Add existing product' }).click();

    const picker = page.getByRole('dialog', { name: 'Add Existing Product' });
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await pickInPicker(page, picker, REASSIGN_PARENT_A, '6');

    // The amber warning must name the product and the stock it is about to
    // destroy — a bare "warning is visible" check would pass on an empty box.
    const warning = picker.getByText(/in stock\. Adding it as a child clears that stock/);
    await expect(warning).toBeVisible();
    // The quantity is rendered straight from the DB decimal, so it reads
    // "10.0000 Box", not "10 Box" — match the number loosely but insist both the
    // real figure and the unit are actually on screen.
    await expect(
      picker.getByText(
        new RegExp(`\\b${stockBefore}(\\.0+)?\\s+${REASSIGN_PARENT_A.unitOfMeasure}\\b`),
      ),
    ).toBeVisible();

    // ...and the confirm button says so too.
    const confirm = picker.getByRole('button', { name: 'Clear stock and add as child', exact: true });
    await expect(confirm).toBeVisible();
    await expect(
      picker.getByRole('button', { name: 'Add as child', exact: true }),
    ).toHaveCount(0);
    await confirm.click();
    await expect(picker).toHaveCount(0, { timeout: 30_000 });

    // Both halves of the promise: it became a child, AND its stock is zero.
    await expect(async () => {
      expect(await fetchParentId(request, REASSIGN_PARENT_A.sku)).toBe(REASSIGN_PARENT_B.id);
    }).toPass({ timeout: 15_000 });
    await expect(async () => {
      expect(await fetchStock(request, REASSIGN_PARENT_A.sku)).toBe(0);
    }).toPass({ timeout: 15_000 });
  });
});

test.describe('The retired reassign UI', () => {
  /**
   * Task 6 deleted the view-product dialog's "Reassign Parent" button. What
   * replaced it is strictly informational: a read-only "Child of <parent>" line
   * with a "Manage" link into the parent's Child Units dialog.
   *
   * Asserting the absence alone would be a weak test (a blank dialog passes it),
   * so this also asserts the replacement line renders with the real parent name.
   */
  test('the view dialog reports membership instead of editing it', async ({ page, request }) => {
    await gotoProducts(page);

    // PERISHABLE_FAMILY_CHILD is untouched by this spec, so its parentage is
    // stable regardless of execution order. Reached by search: the unfiltered
    // products list is flat (top-level only).
    const child = { name: 'Perishable Family Child', parentName: 'Perishable Family Parent' };
    await page.getByPlaceholder('Search products...').fill(child.name);

    const row = productRow(page, child.name);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'View Details' }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: child.name }).first();
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    // The retired control is gone...
    await expect(dialog.getByRole('button', { name: /Reassign/i })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Reassign Parent' })).toHaveCount(0);

    // ...and the read-only membership line took its place, naming the parent.
    await expect(dialog.getByText(`Child of ${child.parentName}`)).toBeVisible({
      timeout: 30_000,
    });

    // The Manage link opens the PARENT's family, not the child's.
    await dialog.getByRole('button', { name: 'Manage', exact: true }).click();
    const familyDialog = childUnitsDialog(page);
    await expect(familyDialog).toBeVisible({ timeout: 60_000 });
    await expect(familyDialog).toContainText(child.parentName, { timeout: 60_000 });
    await expect(childRow(page, child.name)).toBeVisible({ timeout: 60_000 });

    // Nothing about this test should mutate parentage.
    expect(await fetchParentId(request, 'PERISH-FAM-CHD-001')).toBe('test-perishable-family-parent');
  });
});
