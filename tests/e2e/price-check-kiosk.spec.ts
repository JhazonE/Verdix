import { test, expect, type Page } from '@playwright/test';
import { seedSession, type SessionUser } from './helpers/auth';

/**
 * Ang kiosk screen mismo — ang gitan-aw sa kustomer.
 *
 * Ang scanner mao ang primary input: mo-type siya sa barcode dayon mo-Enter,
 * nga walay bisan unsa nga pag-click. Ug kay walay tawo nga mobantay, duha ka
 * butang ang dili pwede mapakyas: (1) ang presyo ra gyud ang makita, walay
 * stock o cost, ug (2) dili gyud mabilin sa screen ang produkto sa nilabay nga
 * kustomer.
 */

const KIOSK_USER: SessionUser = {
  uid: 'test-kiosk-uid',
  username: 'test.kiosk',
  userType: 'Price Inquiry',
  roleId: null,
  displayName: 'Price Checker',
  photoURL: null,
  permissions: ['price_inquiry'],
};

const COKE = {
  id: 'prod-coke',
  name: 'Coca-Cola 1.5L',
  category: 'Beverages',
  brand: 'Coke',
  stock: 24,
  price: '89.00',
  cost: '70.00',
  sku: 'SKU-COKE',
  barcode: '4800016641116',
  unitOfMeasure: 'Bottle',
  priceLevels: [],
  sellingUnits: [
    { id: 'su-coke', name: 'Bottle', factor: 1, barcode: '4800016641116', price: 89, isBase: true },
  ],
};

const PANCIT = {
  id: 'prod-pancit',
  name: 'Lucky Me Pancit Canton',
  category: 'Noodles',
  brand: 'Lucky Me',
  stock: 100,
  price: '17.00',
  cost: '13.00',
  sku: 'SKU-PANCIT',
  barcode: '1000000000001',
  unitOfMeasure: 'Piece',
  priceLevels: [],
  sellingUnits: [
    { id: 'su-pancit', name: 'Piece', factor: 1, barcode: '1000000000001', price: 17, isBase: true },
  ],
};

const CATALOGUE = [COKE, PANCIT];

/**
 * Ang `/api/products` mo-search sa server side (ang term moagi sa query
 * string), mao nga ang stub kinahanglan mo-filter sab — kung dili, ang
 * not-found nga test dili gyud mo-fire.
 */
async function stubApis(page: Page) {
  await page.route('**/api/products**', async (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const data = search
      ? CATALOGUE.filter(
          (p) =>
            p.name.toLowerCase().includes(search) ||
            p.barcode === search ||
            p.sku.toLowerCase() === search,
        )
      : CATALOGUE;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });

  await page.route('**/api/price-levels**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ id: 'retail-level', name: 'Retail', isDefault: true }],
      }),
    }),
  );
}

async function openKiosk(page: Page) {
  await seedSession(page, KIOSK_USER);
  await stubApis(page);
  await page.goto('/price-check', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('kiosk-search')).toBeVisible({ timeout: 40_000 });
}

/** Gi-awat ang barcode scanner: mo-type sa code dayon mo-Enter. */
async function scan(page: Page, barcode: string) {
  const input = page.getByTestId('kiosk-search');
  await input.fill(barcode);
  await input.press('Enter');
}

test.describe('Price Inquiry kiosk screen', () => {
  test('shows the idle prompt before any scan', async ({ page }) => {
    await openKiosk(page);

    await expect(page.getByText(/I-scan ang barcode/i)).toBeVisible();
  });

  test('an exact barcode scan shows the product name and its retail price', async ({ page }) => {
    await openKiosk(page);

    await scan(page, COKE.barcode);

    await expect(page.getByTestId('kiosk-product-name')).toHaveText('Coca-Cola 1.5L');
    await expect(page.getByTestId('kiosk-price')).toHaveText(/₱89\.00/);
  });

  test('never shows stock or cost', async ({ page }) => {
    await openKiosk(page);

    await scan(page, COKE.barcode);
    await expect(page.getByTestId('kiosk-price')).toBeVisible();

    // Ang cost (70) ug ang stock (24) naa sa API payload pero dili gyud dapat
    // mo-abot sa screen.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\b24\b/);
    expect(body).not.toMatch(/70\.00/);
    expect(body).not.toMatch(/stock|on hand|cost/i);
  });

  // Review Focus #2
  test('an unknown barcode shows a not-found state and stays ready', async ({ page }) => {
    await openKiosk(page);

    await scan(page, '0000000000000');

    await expect(page.getByTestId('kiosk-not-found')).toBeVisible();
    await expect(page.getByTestId('kiosk-search')).toBeFocused();
  });

  // Review Focus #3
  test('a second scan replaces the first result', async ({ page }) => {
    await openKiosk(page);

    await scan(page, COKE.barcode);
    await expect(page.getByTestId('kiosk-product-name')).toHaveText('Coca-Cola 1.5L');

    await scan(page, PANCIT.barcode);

    await expect(page.getByTestId('kiosk-product-name')).toHaveText('Lucky Me Pancit Canton');
    await expect(page.getByText('Coca-Cola 1.5L')).toHaveCount(0);
  });

  test('returns to the idle prompt after the idle timeout', async ({ page }) => {
    await openKiosk(page);

    await scan(page, COKE.barcode);
    await expect(page.getByTestId('kiosk-price')).toBeVisible();

    // Ang 10-segundo nga timer mo-clear sa screen para andam sa sunod.
    await expect(page.getByText(/I-scan ang barcode/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('kiosk-price')).toHaveCount(0);
  });
});
