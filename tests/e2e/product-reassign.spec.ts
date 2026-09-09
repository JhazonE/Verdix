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
 * Child reassignment (DB-backed) — i-drive ang view-product dialog "Reassign Parent"
 * batok sa verdix_test. Verify pinaagi sa API nga na-usab ang parent_id.
 */

/**
 * Ablihi ang view-product dialog para sa child pinaagi sa row menu ("View Details"
 * dropdown item — parehas sa pattern nga gigamit sa edit/delete spec).
 *
 * The unfiltered /products list is flat (top-level only, no chevron/expander —
 * see the parent/child reorg). A nested child is reached by searching for it:
 * under a filter the list returns matches at any depth. Searching used to be
 * unsafe here because ReassignParentDialog's legal-target list came from the
 * products page's own paginated `products` prop, so filtering the outer list
 * could drop a needed target out of that prop. That is no longer true — the
 * dialog now searches the whole catalogue itself in SQL (see the "can never be
 * the source of truth" comment in reassign-parent-dialog.tsx, fixed in
 * d17cbfc) — so searching the outer list here is safe.
 *
 * Callers must clear the search themselves afterward if a later step in the
 * same test needs the unfiltered list again.
 */
async function openViewDialog(page: Page, name: string, parentName?: string) {
  if (parentName) {
    // The child only appears in the flat list under a search match (it shows
    // a "↳ parent" badge there); search by the child's own name to reach it.
    const search = page.getByPlaceholder('Search products...');
    await search.fill(name);
  }
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'View Details' }).click();
}

async function fetchParentId(request: any, sku: string): Promise<string | null> {
  const res = await request.get(`/api/products?search=${sku}&limit=50`);
  const body = await res.json();
  const match = (body.data ?? []).find((p: any) => p.sku === sku);
  return match ? (match.parentId ?? match.parent_id ?? null) : null;
}

test.describe('Child reassignment', () => {
  test('admin mo-reassign sa child ngadto sa bag-ong parent', async ({ page, request }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/products');

    // Precondition: child starts under Parent A.
    expect(await fetchParentId(request, REASSIGN_CHILD.sku)).toBe(REASSIGN_PARENT_A.id);

    // The child only shows up in the flat top-level list under a search match
    // (see openViewDialog above) — reach it that way instead of expanding a
    // parent row, which no longer exists.
    await openViewDialog(page, REASSIGN_CHILD.name, REASSIGN_PARENT_A.name);

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Reassign Parent' }).click();

    // The ReassignParentDialog is a nested Dialog — its own dialog role is now on top.
    const reassignDialog = page.getByRole('dialog', { name: 'Reassign Parent' });
    await expect(reassignDialog).toBeVisible();

    // Pick the new parent, set a factor, save. The picker searches the whole
    // catalogue itself (SQL, not the products page's own loaded slice) —
    // search its OWN box by name so Parent B is guaranteed to be among the
    // results on a 15,000+ row catalogue.
    await reassignDialog.getByLabel('New parent').click();
    await page.getByPlaceholder('Search by name, SKU or barcode...').fill(REASSIGN_PARENT_B.name);
    await expect(page.getByRole('option', { name: REASSIGN_PARENT_B.name })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('option', { name: REASSIGN_PARENT_B.name }).click();
    await reassignDialog.getByLabel(/Conversion factor/).fill('24');
    await reassignDialog.getByRole('button', { name: 'Reassign' }).click();

    // Verify parent_id moved to Parent B.
    await expect(async () => {
      expect(await fetchParentId(request, REASSIGN_CHILD.sku)).toBe(REASSIGN_PARENT_B.id);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe('Top-level reassignment', () => {
  test('admin mo-move sa top-level mother ngadto sa bag-ong parent', async ({ page, request }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/products');

    // Precondition: the mover is top-level, its child nests under it.
    expect(await fetchParentId(request, REASSIGN_TOP_MOVER.sku)).toBeNull();
    expect(await fetchParentId(request, REASSIGN_TOP_MOVER_CHILD.sku)).toBe(REASSIGN_TOP_MOVER.id);

    // reassignParent() (actions.ts) refuses to attach a product with stock > 0
    // to a new parent — a real, unrelated business rule, not something this
    // spec is about. The fixture seeds REASSIGN_TOP_MOVER with stock: 8 (no
    // test here or in child-units.spec.ts asserts on that stock value), so
    // clear it first the same way a real user would ("adjust or clear the
    // inventory first, then reassign" is the server's own message).
    await request.patch(`/api/products/${REASSIGN_TOP_MOVER.id}`, {
      data: { stockIncrement: -REASSIGN_TOP_MOVER.stock },
    });

    // The mover itself is opened directly off the unfiltered top-level list
    // (no search — openViewDialog only searches when given a parentName), and
    // the default page size of 10 can push it past page 1 once enough
    // dedicated fixtures exist in the DB — bump rows-per-page so it's visible.
    await page.getByLabel('Rows per page:').click();
    await page.getByRole('option', { name: '50' }).click();

    // Open the mover's view dialog (top-level row — no parent expansion, no search needed).
    await openViewDialog(page, REASSIGN_TOP_MOVER.name);

    const dialog = page.getByRole('dialog');
    // NEW behavior: the Reassign button is present for a top-level product.
    await dialog.getByRole('button', { name: 'Reassign Parent' }).click();

    const reassignDialog = page.getByRole('dialog', { name: 'Reassign Parent' });
    await expect(reassignDialog).toBeVisible();

    // Detach must be HIDDEN for an already top-level product.
    await reassignDialog.getByLabel('New parent').click();
    await expect(page.getByRole('option', { name: 'Detach (no parent)' })).toHaveCount(0);

    // The picker searches the whole catalogue itself (SQL, not the products
    // page's own loaded slice) — search its OWN box by name so the target is
    // guaranteed to be among the results on a 15,000+ row catalogue.
    await page.getByPlaceholder('Search by name, SKU or barcode...').fill(REASSIGN_TOP_TARGET.name);
    await expect(page.getByRole('option', { name: REASSIGN_TOP_TARGET.name })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('option', { name: REASSIGN_TOP_TARGET.name }).click();
    await reassignDialog.getByLabel(/Conversion factor/).fill('10');
    await reassignDialog.getByRole('button', { name: 'Reassign' }).click();

    // The mover now nests under the target...
    await expect(async () => {
      expect(await fetchParentId(request, REASSIGN_TOP_MOVER.sku)).toBe(REASSIGN_TOP_TARGET.id);
    }).toPass({ timeout: 10_000 });

    // ...and its own child still nests under the mover (subtree moved intact).
    expect(await fetchParentId(request, REASSIGN_TOP_MOVER_CHILD.sku)).toBe(REASSIGN_TOP_MOVER.id);
  });
});

test.describe('Reassign factor auto-detect', () => {
  test('auto-fills the factor from a parent that already knows the unit', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/products');

    // The mover itself is opened directly off the unfiltered top-level list
    // (no search — openViewDialog only searches when given a parentName), and
    // the default page size of 10 can push it past page 1 once enough
    // dedicated fixtures exist in the DB — bump rows-per-page so it's visible.
    await page.getByLabel('Rows per page:').click();
    await page.getByRole('option', { name: '50' }).click();

    // REASSIGN_AUTO_MOVER is a DEDICATED fixture that no other test in this file
    // touches — it stays genuinely top-level regardless of test execution order,
    // so this test can run standalone (e.g. via --grep) without depending on the
    // preceding "Top-level reassignment" test having run first.
    await openViewDialog(page, REASSIGN_AUTO_MOVER.name);

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Reassign Parent' }).click();

    const reassignDialog = page.getByRole('dialog', { name: 'Reassign Parent' });
    await expect(reassignDialog).toBeVisible();

    const factorInput = reassignDialog.getByLabel(/Conversion factor/);
    const pickerSearch = page.getByPlaceholder('Search by name, SKU or barcode...');

    // 1) Pick the target that already has a Box factor → input auto-fills "4.00" + hint shows.
    // The picker searches the whole catalogue itself (SQL), so search its OWN
    // box by name to guarantee the target is among the results on a 15,000+
    // row catalogue, rather than relying on an unfiltered top-N fetch.
    await reassignDialog.getByLabel('New parent').click();
    await pickerSearch.fill(REASSIGN_AUTO_MATCH.name);
    await expect(page.getByRole('option', { name: REASSIGN_AUTO_MATCH.name })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('option', { name: REASSIGN_AUTO_MATCH.name }).click();
    await expect(factorInput).toHaveValue('4.00');
    await expect(reassignDialog.getByText(/Auto-detected from/)).toBeVisible();

    // 2) Switch to a target with NO matching factor → input clears + hint gone.
    // REASSIGN_AUTO_NOMATCH is dedicated to this test and never reassigned onto by
    // any other test, so it genuinely never has a conversion_factors row.
    await reassignDialog.getByLabel('New parent').click();
    await pickerSearch.fill(REASSIGN_AUTO_NOMATCH.name);
    await expect(page.getByRole('option', { name: REASSIGN_AUTO_NOMATCH.name })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('option', { name: REASSIGN_AUTO_NOMATCH.name }).click();
    await expect(factorInput).toHaveValue('');
    await expect(reassignDialog.getByText(/Auto-detected from/)).toHaveCount(0);
  });
});
