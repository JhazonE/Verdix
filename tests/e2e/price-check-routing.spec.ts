import { test, expect } from '@playwright/test';
import { seedSession, type SessionUser } from './helpers/auth';

/**
 * Routing para sa `Price Inquiry` user type — ang account sa self-service
 * price-checker kiosk.
 *
 * Ang kiosk walay tawo nga mobantay, mao nga duha ka butang ang kinahanglan
 * gyud: (1) mo-land dayon sa `/price-check` human mo-login, ug (2) dili gyud
 * makagawas didto. Ang ikaduha mao ang importante — kung makaabot ang kustomer
 * sa inventory o reports, nawala ang tibuok punto sa gi-restrict nga account.
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

test.describe('Price Inquiry kiosk routing', () => {
  /**
   * Ang login FORM dili mo-render sa e2e environment (ang licence gate
   * mo-redirect sa /activate una pa mo-mount ang form) — ang naa nang
   * `auth.spec.ts` "cashier login" test mo-fail sab sa parehas nga paagi sa
   * wala-hilabti nga code. Mao nga gi-test dinhi ang redirect RULE pinaagi sa
   * usa ka gi-seed nga session, dili pinaagi sa pag-drive sa form.
   */
  test('a Price Inquiry session is sent to /price-check from the app root', async ({ page }) => {
    await seedSession(page, KIOSK_USER);

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/price-check/, { timeout: 40_000 });
  });

  test('a Price Inquiry user typing a back-office URL is sent back to /price-check', async ({ page }) => {
    await seedSession(page, KIOSK_USER);

    await page.goto('/products', { waitUntil: 'domcontentloaded' });

    // Ang /products bug-at i-compile sa dev mode (~14s), ug ang redirect
    // mo-fire human mo-load ang session — mao nga dako ang timeout dinhi.
    await expect(page).toHaveURL(/\/price-check/, { timeout: 40_000 });
  });

  test('the kiosk screen renders no sidebar and no logout control', async ({ page }) => {
    await seedSession(page, KIOSK_USER);

    await page.goto('/price-check', { waitUntil: 'domcontentloaded' });

    // Ang idle prompt mao ang pruba nga ang kiosk page mismo ang gi-render —
    // kung wala ni, ang mga absence-assertion sa ubos trivially mo-pass sa
    // usa ka 404 page.
    await expect(page.getByText(/I-scan ang barcode/i)).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /log ?out|sign ?out/i })).toHaveCount(0);
  });
});
