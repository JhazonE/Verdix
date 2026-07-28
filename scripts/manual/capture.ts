import { chromium, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { SCREENS, type Screen } from './screens';
import { calloutOverlayCss, calloutMarkup, type ResolvedCallout } from './overlay';
import { seedSession, DEFAULT_ADMIN } from '../../tests/e2e/helpers/auth';
import { TEST_USERS, TEST_PRODUCTS } from '../../tests/e2e/fixtures/test-data';
import { resetPosState } from '../../tests/e2e/helpers/db';

/**
 * Screenshots every screen in `SCREENS` (with numbered callout badges overlaid)
 * into `docs/manual/images/<slug>.png` for the user manual generator.
 *
 * Run: `npm run manual:capture` — expects a dev server already running on
 * http://localhost:3100 against the `verdix_test` database (see
 * tests/e2e/setup/prepare-test-db.ts / playwright.config.ts webServer block).
 */

const BASE_URL = 'http://localhost:3100';
const VIEWPORT = { width: 1440, height: 900 };
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'docs', 'manual', 'images');

const cashier = TEST_USERS.cashier;
const product = TEST_PRODUCTS[0];

/** Named POS setup sequences referenced by `Screen.setup`. Mirrors tests/e2e/pos-sale.spec.ts. */
const POS_SETUPS: Record<string, (page: Page) => Promise<void>> = {
  async posLoginForm(page) {
    await page.goto('/pos');
    await page.getByRole('heading', { name: /cashier login/i }).waitFor();
  },

  async posStartShiftDialog(page) {
    await page.goto('/pos');
    await page.getByRole('heading', { name: /cashier login/i }).waitFor();
    await page.getByLabel('Username').fill(cashier.username);
    await page.getByLabel('Password').fill(cashier.password);
    await page.getByRole('button', { name: /login to pos/i }).click();
    await page.getByRole('heading', { name: /start new shift/i }).waitFor();
  },

  async posShiftStarted(page) {
    await POS_SETUPS.posStartShiftDialog(page);
    await page.getByRole('button', { name: /start shift/i }).click();
    await page.getByPlaceholder(/scan barcode or enter product sku/i).waitFor();
  },

  async posWithCart(page) {
    await POS_SETUPS.posShiftStarted(page);
    const barcode = page.getByPlaceholder(/scan barcode or enter product sku/i);
    const deadline = Date.now() + 15_000;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        await barcode.fill(product.sku);
        await barcode.press('Enter');
        await page.getByText(product.name).first().waitFor({ timeout: 2_000 });
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('posWithCart: failed to add product to cart');
  },

  /**
   * Ring up and tender a real cash sale, so the X/Z-reading reports have actual
   * figures to show. Without a completed sale every line reads P0.00, which is
   * useless as a manual figure — the reader cannot see what the report is for.
   *
   * Mirrors the tender flow proven in tests/e2e/pos-sale.spec.ts: an empty
   * barcode + Enter opens the tender dialog pre-filled with the exact total.
   */
  async posWithCompletedSale(page) {
    await POS_SETUPS.posWithCart(page);

    const barcode = page.getByPlaceholder(/scan barcode or enter product sku/i);
    await barcode.click();
    await barcode.press('Enter');

    await page.getByText(/tender payment/i).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /confirm payment/i }).click();

    // The sale is saved once the print prompt appears; skip printing (no
    // printer attached in capture) and wait for the cart to clear, which
    // confirms the transaction was committed to the DB.
    await page.getByText(/saved successfully/i).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: /no, skip/i }).click();
    await page.getByText(/cart is empty/i).waitFor({ timeout: 10_000 });
  },

  /**
   * Open the membership payment dialog from the POS customer panel.
   *
   * Uses SO_CUSTOMER, which is seeded with no customer_loyalty row, so the
   * dialog opens in its activation state with the RFID Card Code field
   * visible — the variant the Ch.6 steps describe in most detail. A customer
   * that already had a card would render the shorter renewal panel instead.
   */
  async posMembershipDialog(page) {
    await POS_SETUPS.posShiftStarted(page);

    await page.getByRole('button', { name: /customer/i }).first().click();

    // The dialog's customer picker is a Radix Select (role=combobox), anchored
    // by its "Select Customer" placeholder — there is also an RFID text input
    // above it, so an unqualified role lookup would be ambiguous.
    await page.getByRole('combobox').filter({ hasText: /select customer/i }).click();
    await page.getByRole('option', { name: 'SO Test Customer' }).click();

    await page.getByRole('button', { name: /activate membership/i }).click();
    await page.getByRole('heading', { name: /membership payment/i }).waitFor({ timeout: 10_000 });
  },
};

/**
 * Named non-POS setup sequences referenced by `Screen.setup`. Unlike
 * `POS_SETUPS`, these run against whatever `screen.route` the screen already
 * navigated to (see captureScreen) rather than assuming `/pos` and remapping
 * afterward.
 */
const SETUPS: Record<string, (page: Page) => Promise<void>> = {
  async activateOfflineTab(page) {
    await page.getByRole('button', { name: /^offline$/i }).click();
    await page.getByText('Your Machine ID').waitFor();
  },

  async posSetupGeneralTab(page) {
    await page.getByRole('tab', { name: /^general$/i }).click();
    // Anchor on the input id rather than the "Membership Fee (₱)" label text:
    // the peso sign is a non-ASCII literal in a matcher, and the id is stable.
    await page.locator('#membershipFee').waitFor({ state: 'visible', timeout: 10_000 });
  },
};

/** Resolve callout definitions to concrete pixel positions in the current viewport. */
async function resolveCallouts(page: Page, screen: Screen): Promise<ResolvedCallout[]> {
  const resolved: ResolvedCallout[] = [];
  if (!screen.callouts) return resolved;

  for (const callout of screen.callouts) {
    if (callout.selector) {
      try {
        const locator = page.locator(callout.selector).first();
        const box = await locator.boundingBox();
        if (!box) {
          console.warn(`  ! ${screen.slug}: callout ${callout.n} selector "${callout.selector}" not visible — skipping`);
          continue;
        }
        // The badge's own CSS centers it on (x, y) via `margin: -14px 0 0 -14px`
        // (overlay.ts) — i.e. (x, y) is the badge's CENTER, a 28px circle.
        // Anchoring near the element's TOP-LEFT CORNER is unreliable: form
        // fields commonly have a <label> sitting just a few px above the
        // input (e.g. 8px on the login form), so a badge centered near the
        // corner collides with either the label above or the placeholder
        // text inside, depending on which way it's nudged.
        //
        // Anchor instead to the element's LEFT-CENTER edge, offset further
        // left by half the badge's own radius (14px) plus a small gap, so
        // the badge sits fully outside the control on its left side —
        // clearing both the label above and the placeholder inside — while
        // still sitting close enough to unambiguously point at it.
        const badgeRadius = 14;
        const gap = 6;
        resolved.push({ n: callout.n, x: box.x - badgeRadius - gap, y: box.y + box.height / 2 });
      } catch (err) {
        console.warn(`  ! ${screen.slug}: callout ${callout.n} selector "${callout.selector}" failed to resolve — skipping`, err);
      }
    } else if (callout.x !== undefined && callout.y !== undefined) {
      resolved.push({ n: callout.n, x: callout.x * VIEWPORT.width, y: callout.y * VIEWPORT.height });
    } else {
      console.warn(`  ! ${screen.slug}: callout ${callout.n} has neither selector nor x/y — skipping`);
    }
  }

  return resolved;
}

async function captureScreen(page: Page, screen: Screen): Promise<void> {
  if (screen.auth === 'admin') {
    await seedSession(page, DEFAULT_ADMIN);
  }

  // Make the machine appear unlicensed for this screen only, so
  // components/license-gate.tsx renders its activation card instead of the
  // real (licensed) app. Fake, obviously-placeholder values only — never the
  // real customer name or this dev machine's real hardware fingerprint.
  if (screen.mockUnlicensed) {
    await page.route('**/api/license/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            status: 'unlicensed',
            licensed: false,
            machineId: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX',
            customer: null,
            edition: null,
            expires: null,
            daysRemaining: null,
          },
        }),
      })
    );
  }

  if (screen.setup && POS_SETUPS[screen.setup]) {
    const setupFn = POS_SETUPS[screen.setup];
    await setupFn(page);
    // Setup sequences all start at /pos. If the screen targets a different
    // route (e.g. /pos/x-reading), navigate there after the sequence so the
    // shift state (created in the DB by the setup) is visible to the report.
    //
    // /pos and /pos/customer-display bypass the app's outer auth guard
    // entirely (see app/(app)/use-app-layout.ts isPOSPage); every other
    // /pos/* route (x-reading, z-reading) is a normal guarded (app) page that
    // requires `mock-user-session`, plus its own AdminAuthDialog PIN gate.
    if (screen.route !== '/pos') {
      await seedSession(page, DEFAULT_ADMIN);
      await page.goto(screen.route);
      const adminAuthHeading = page.getByText(/admin authentication required/i);
      const sawAdminAuth = await adminAuthHeading
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (sawAdminAuth) {
        await page.getByLabel('Username').fill(TEST_USERS.admin.username);
        await page.getByLabel('Password').fill(TEST_USERS.admin.password);
        await page.getByRole('button', { name: /authenticate/i }).click();
        await adminAuthHeading.waitFor({ state: 'hidden', timeout: 10_000 });
      }
    }
  } else {
    await page.goto(screen.route);
    if (screen.setup) {
      const setupFn = SETUPS[screen.setup];
      if (!setupFn) throw new Error(`unknown setup sequence "${screen.setup}"`);
      await setupFn(page);
    }
  }

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);

  if (screen.waitFor) {
    await page.locator(screen.waitFor).first().waitFor({ timeout: 15_000 });
  }

  const resolved = await resolveCallouts(page, screen);

  // Toasts (e.g. "Shift Started", "Manual Terminal Connected") use
  // TOAST_REMOVE_DELAY = 1_000_000ms (hooks/use-toast.ts) — they never
  // self-dismiss within our wait, so they'd otherwise bleed into every
  // screenshot taken shortly after a toast-triggering action. Radix's
  // ToastProvider wraps ToastViewport's <ol> in its own `<div role="region">`
  // (the role lives on the DIV, not the OL) — remove that wrapper so the
  // whole toast stack (and its "region" landmark) disappears in one shot.
  //
  // Also strip Next.js dev-mode's floating indicator (`<nextjs-portal>`
  // custom element) — it's dev tooling, not part of the app, and must not
  // appear in a customer-facing manual.
  await page.evaluate(() => {
    document.querySelectorAll('[role="region"]').forEach((el) => el.remove());
    document.querySelectorAll('nextjs-portal').forEach((el) => el.remove());
  });

  await page.addStyleTag({ content: calloutOverlayCss() });
  await page.evaluate((markup) => {
    document.body.insertAdjacentHTML('beforeend', markup);
  }, calloutMarkup(resolved));

  const outPath = path.join(OUTPUT_DIR, `${screen.slug}.png`);
  await page.screenshot({ path: outPath });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Optional slug filter: `npm run manual:capture -- pos-x-reading pos-z-reading`
  // re-shoots just those screens. A full run is ~25 minutes, so fixing one bad
  // screenshot should not require recapturing all of them.
  //
  // Resolved BEFORE launching the browser: a bad slug must fail immediately,
  // not after paying for a browser that would then never be closed.
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = only.length > 0 ? SCREENS.filter((s) => only.includes(s.slug)) : SCREENS;

  if (only.length > 0) {
    const unknown = only.filter((slug) => !SCREENS.some((s) => s.slug === slug));
    if (unknown.length > 0) {
      throw new Error(`Unknown screen slug(s): ${unknown.join(', ')}`);
    }
    console.log(`manual: capturing ${targets.length} of ${SCREENS.length} screens`);
  }

  const browser = await chromium.launch();
  const failed: { slug: string; message: string }[] = [];

  // POS screens resume an active shift automatically, so start each POS
  // sequence from a clean shift/sale state.
  const needsPosReset = targets.some((s) => s.setup);
  if (needsPosReset) {
    await resetPosState();
  }

  for (const screen of targets) {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: VIEWPORT });
    const page = await context.newPage();
    try {
      // Each POS setup sequence assumes a fresh shift state — reset before
      // every POS screen so earlier screens' carts/shifts don't bleed in.
      if (screen.setup) {
        await resetPosState();
      }
      await captureScreen(page, screen);
      console.log(`✓ ${screen.slug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${screen.slug}: ${message}`);
      failed.push({ slug: screen.slug, message });
    } finally {
      await context.close();
    }
  }

  await browser.close();

  console.log('');
  console.log(`Captured ${targets.length - failed.length}/${targets.length} screens.`);
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    for (const f of failed) console.log(`  - ${f.slug}: ${f.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('manual:capture crashed:', err);
  process.exitCode = 1;
});
