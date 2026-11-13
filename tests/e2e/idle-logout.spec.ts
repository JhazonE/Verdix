import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_ADMIN } from './helpers/auth';

/**
 * Back-office idle timeout (lib/idle-session.ts, hooks/use-idle-logout.ts).
 *
 * The stamp is seeded instead of waiting 15 real minutes. The init script
 * seeds only on the FIRST load: helpers/auth.ts's seedSession re-runs on
 * every navigation and would re-create the session on /login after expiry.
 */
async function seedIdle(page: Page, idleMs: number) {
  await page.addInitScript(({ user, idleMs }) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('mock-user-session', JSON.stringify({ ...user, email: user.username }));
    localStorage.setItem('session-last-activity', String(Date.now() - idleMs));
  }, { user: DEFAULT_ADMIN, idleMs });
}

const MIN = 60_000;

test.describe('Idle session timeout', () => {
  test('a session idle past the timeout is signed out with an explanation', async ({ page }) => {
    await seedIdle(page, 20 * MIN);
    await page.goto('/settings');

    await expect(page).toHaveURL(/\/login\?expired=1$/);
    await expect(page.getByText('Session expired')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('mock-user-session'))).toBeNull();
  });

  test('the last minute shows a warning, and Stay signed in keeps the session', async ({ page }) => {
    await seedIdle(page, 14 * MIN + 20_000);
    await page.goto('/settings');

    await expect(page.getByText('Are you still there?')).toBeVisible();
    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(page.getByText('Are you still there?')).toBeHidden();

    const stamp = await page.evaluate(() => Number(localStorage.getItem('session-last-activity')));
    expect(Date.now() - stamp).toBeLessThan(10_000);
    await expect(page).toHaveURL(/\/settings/);
  });

  test('POS is left completely alone: no logout, no activity tracking', async ({ page }) => {
    await seedIdle(page, 20 * MIN);
    await page.goto('/pos');
    const before = await page.evaluate(() => localStorage.getItem('session-last-activity'));

    await page.mouse.move(100, 100);
    await page.mouse.move(300, 300);
    await page.keyboard.press('Shift');
    await page.waitForTimeout(2_500);

    await expect(page).toHaveURL(/\/pos$/);
    expect(await page.evaluate(() => localStorage.getItem('mock-user-session'))).not.toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('session-last-activity'))).toBe(before);
  });

  test('going from POS back to the back office restarts the clock', async ({ page }) => {
    await seedIdle(page, 20 * MIN);
    await page.goto('/pos');
    // Browser POS is off by default, so /pos shows a notice with an in-app
    // link back — a client-side navigation, exactly like leaving POS.
    await page.getByRole('button', { name: 'Back to Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForTimeout(2_000);
    await expect(page).toHaveURL(/\/dashboard/);
    expect(await page.evaluate(() => localStorage.getItem('mock-user-session'))).not.toBeNull();
  });

  test('a session from before this feature (no stamp) is not expired on upgrade', async ({ page }) => {
    await page.addInitScript((user) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('mock-user-session', JSON.stringify({ ...user, email: user.username }));
      localStorage.removeItem('session-last-activity');
    }, DEFAULT_ADMIN);
    await page.goto('/settings');
    await page.waitForTimeout(2_000);
    await expect(page).toHaveURL(/\/settings/);
  });
});
