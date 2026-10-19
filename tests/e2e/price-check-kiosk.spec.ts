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
  stock: 4321,
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
async function stubApis(page: Page, opts: { churnStock?: boolean } = {}) {
  let churn = 0;
  await page.route('**/api/products**', async (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    // Gi-awat ang tinuod nga server: usa ka LIKE match sa name/SKU/barcode —
    // mao nga ang partial barcode mo-match gihapon, nga mao ang sentro sa
    // gisi-nga-barcode nga test.
    const data = search
      ? CATALOGUE.filter(
          (p) =>
            p.name.toLowerCase().includes(search) ||
            p.barcode.includes(search) ||
            p.sku.toLowerCase().includes(search),
        )
      : CATALOGUE;
    // `churnStock` simulates a live store: every refetch sees a different
    // `stock`, which is never rendered but DOES change the payload's identity.
    // This is the shape that broke the idle timer while byte-identical stubs
    // passed, so it is worth stubbing deliberately.
    const body = opts.churnStock
      ? data.map((p) => ({ ...p, stock: 1000 - churn++ }))
      : data;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: body }),
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

async function openKiosk(page: Page, opts: { churnStock?: boolean } = {}) {
  await seedSession(page, KIOSK_USER);
  await stubApis(page, opts);
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

    // Ang cost (70.00) ug ang stock (24) naa sa API payload pero dili gyud
    // dapat mo-abot sa screen. Gipili ang 4321 isip stock value kay dili ni
    // matabunan sa bisan unsang presyo sa fixture (89.00 / 17.00).
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/4321/);
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

  // Regression para sa review finding C2 — ang bersyon nga nakalusot sa unang
  // review. Ang byte-identical nga stub mo-pass; ang tinuod nga tindahan (nga
  // nag-usab sa stock kada sale) dili. Ang `stock` wala gi-render, pero
  // mo-usab sa payload identity, nga mao ang nag-reset sa timer kaniadto.
  test('still returns to idle while background refetches churn the payload', async ({ page }) => {
    await openKiosk(page, { churnStock: true });

    await scan(page, COKE.barcode);
    await expect(page.getByTestId('kiosk-price')).toBeVisible();

    await expect(page.getByText(/I-scan ang barcode/i)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('kiosk-price')).toHaveCount(0);
  });

  // Regression para sa review finding I3 — ang gisi nga barcode.
  test('a partial barcode offers a choice instead of asserting a price', async ({ page }) => {
    await openKiosk(page);

    // Ang kataposang digit nawala: mo-LIKE-match ni sa usa ka produkto, pero
    // dili ni exact hit, mao nga ang kustomer ang mo-confirm.
    await scan(page, COKE.barcode.slice(0, -1));

    await expect(page.getByRole('button', { name: /Coca-Cola 1\.5L/ })).toBeVisible();
    await expect(page.getByTestId('kiosk-price')).toHaveCount(0);
  });

  // Regression para sa review finding C3 — ang patay nga terminal.
  test('an API failure says ask a staff member, not "no product found"', async ({ page }) => {
    await seedSession(page, KIOSK_USER);
    await page.route('**/api/price-levels**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ id: 'retail-level', name: 'Retail', isDefault: true }] }),
      }),
    );
    await page.route('**/api/products**', (route) => route.fulfill({ status: 500, body: 'boom' }));
    await page.goto('/price-check', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('kiosk-search')).toBeVisible({ timeout: 40_000 });

    await scan(page, COKE.barcode);

    await expect(page.getByTestId('kiosk-offline')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('kiosk-not-found')).toHaveCount(0);
  });
});
