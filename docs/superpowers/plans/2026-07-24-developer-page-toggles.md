# Developer Options — Page Enable/Disable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hidden, super-admin-only `/developer/options` page where each sidebar page can be toggled off; a disabled page disappears from the sidebar and its URL redirects to `/dashboard`.

**Architecture:** A central page registry (`lib/page-registry.ts`) lists every toggleable page with a stable key. A `disabled_pages` DB table stores the disabled keys, read/written through `/api/developer/disabled-pages`. `use-app-layout.ts` fetches the disabled set on mount, filters the nav lists passed to the sidebar, and drives a redirect guard in the `(app)` layout. The developer page reads/writes the set through the API.

**Tech Stack:** Next.js 16 (App Router, client components), React, `mysql2/promise` via `lib/mysql.ts` (`query()`), shadcn `Switch`, Playwright (E2E, port 3100).

## Global Constraints

- MySQL only, raw SQL via `query()` from `lib/mysql.ts`. No ORM.
- API routes return `NextResponse.json({ success, ... })`; lazily create tables/columns (matching `app/api/pos-settings/route.ts`).
- Client auth comes from `localStorage['mock-user-session']` → `{ permissions?: string[], userType?: string }`. Super admin = `permissions.includes('super_admin')`.
- API base URL: use `getApiUrl(path)` / `API_BASE_URL` from `@/lib/api-config`.
- E2E tests are API-level where possible, use the `request` fixture and `testQuery` from `./helpers/db`, run on port 3100 against `verdix_test`, `workers: 1`.
- Protected (never-toggleable) pages: `/dashboard`, `/settings`, `/user-management`, and any path starting with `/developer`.

---

### Task 1: Page registry

**Files:**
- Create: `lib/page-registry.ts`
- Test: `tests/e2e/page-registry.spec.ts` (unit-style, run via Playwright test runner)

**Interfaces:**
- Consumes: nav item shapes from `app/(app)/layout-nav-config.ts` (`{ href, label }` and `{ href, label, permission }`).
- Produces:
  - `type RegistryPage = { key: string; href: string; label: string; section: string; protected?: boolean }`
  - `PAGE_REGISTRY: RegistryPage[]` — every page, including protected ones.
  - `TOGGLEABLE_PAGES: RegistryPage[]` — `PAGE_REGISTRY.filter(p => !p.protected)`.
  - `isProtectedHref(href: string): boolean`
  - `pageKeyForHref(href: string): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/page-registry.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import {
  PAGE_REGISTRY,
  TOGGLEABLE_PAGES,
  isProtectedHref,
  pageKeyForHref,
} from '../../lib/page-registry';

test.describe('page-registry', () => {
  test('every registry key is unique', () => {
    const keys = PAGE_REGISTRY.map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every registry href is unique', () => {
    const hrefs = PAGE_REGISTRY.map(p => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test('protected pages are excluded from TOGGLEABLE_PAGES', () => {
    expect(TOGGLEABLE_PAGES.some(p => p.href === '/dashboard')).toBe(false);
    expect(TOGGLEABLE_PAGES.some(p => p.href === '/settings')).toBe(false);
    expect(TOGGLEABLE_PAGES.some(p => p.href === '/user-management')).toBe(false);
  });

  test('sales order and invoice are toggleable', () => {
    expect(TOGGLEABLE_PAGES.some(p => p.href === '/sales/orders')).toBe(true);
    expect(TOGGLEABLE_PAGES.some(p => p.href === '/sales/invoices')).toBe(true);
  });

  test('isProtectedHref covers dashboard, settings, user-management, developer', () => {
    expect(isProtectedHref('/dashboard')).toBe(true);
    expect(isProtectedHref('/settings')).toBe(true);
    expect(isProtectedHref('/user-management')).toBe(true);
    expect(isProtectedHref('/developer/options')).toBe(true);
    expect(isProtectedHref('/sales/orders')).toBe(false);
  });

  test('pageKeyForHref round-trips a known page', () => {
    const key = pageKeyForHref('/sales/orders');
    expect(key).toBeTruthy();
    expect(PAGE_REGISTRY.find(p => p.key === key)?.href).toBe('/sales/orders');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/page-registry.spec.ts --project=chromium`
Expected: FAIL — cannot resolve `../../lib/page-registry`.

- [ ] **Step 3: Write the registry**

Create `lib/page-registry.ts`:

```ts
export type RegistryPage = {
  key: string;
  href: string;
  label: string;
  section: string;
  protected?: boolean;
};

// Stable keys are hand-assigned so renaming a label never orphans a stored setting.
// Sections mirror the sidebar groups. Protected pages can never be toggled off.
export const PAGE_REGISTRY: RegistryPage[] = [
  // Platform
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard', section: 'Platform', protected: true },
  { key: 'products', href: '/products', label: 'Products', section: 'Platform' },

  // Inventory
  { key: 'inventory', href: '/inventory', label: 'Stock Levels', section: 'Inventory' },
  { key: 'inventory_stock_counts', href: '/inventory/stock-counts', label: 'Stock Counts (Snapshots)', section: 'Inventory' },
  { key: 'inventory_repackaging', href: '/inventory/repackaging', label: 'Repackaging', section: 'Inventory' },
  { key: 'inventory_history', href: '/inventory/history', label: 'Adjustment History', section: 'Inventory' },
  { key: 'inventory_movement', href: '/inventory/movement', label: 'Stock Movement', section: 'Inventory' },

  // Sales
  { key: 'sales', href: '/sales', label: 'POS Sales Transaction', section: 'Sales' },
  { key: 'sales_details', href: '/sales/details', label: 'POS Sales Detail', section: 'Sales' },
  { key: 'sales_by_product', href: '/sales/by-product', label: 'Sales by Product/Service', section: 'Sales' },
  { key: 'sales_by_date', href: '/sales/by-date', label: 'Sales by Date', section: 'Sales' },
  { key: 'sales_orders', href: '/sales/orders', label: 'Sales Order', section: 'Sales' },
  { key: 'sales_invoices', href: '/sales/invoices', label: 'Sales Invoice/Delivery', section: 'Sales' },
  { key: 'sales_cash_transfer', href: '/sales/cash-transfer', label: 'POS Cash Transfer', section: 'Sales' },
  { key: 'sales_returns', href: '/sales/returns', label: 'Merchandise Credits', section: 'Sales' },
  { key: 'sales_voids', href: '/sales/voids', label: 'Post Void', section: 'Sales' },
  { key: 'sales_z_reading', href: '/sales/z-reading', label: 'POS Z-Reading', section: 'Sales' },
  { key: 'sales_x_reading', href: '/sales/x-reading', label: 'POS X-Reading', section: 'Sales' },
  { key: 'sales_overall_reading', href: '/sales/overall-reading', label: 'POS Overall Reading', section: 'Sales' },
  { key: 'sales_analysis', href: '/sales/analysis', label: 'Sales Analysis', section: 'Sales' },

  // Customers
  { key: 'customer', href: '/customer', label: 'Customer List', section: 'Customers' },
  { key: 'customer_payment', href: '/customer/payment', label: 'Customer Payment', section: 'Customers' },
  { key: 'customer_balances', href: '/customer/balances', label: 'Customer Balances', section: 'Customers' },
  { key: 'customer_loyalty', href: '/customer/loyalty', label: 'Customer Loyalty Points', section: 'Customers' },

  // Suppliers
  { key: 'suppliers_list', href: '/suppliers/list', label: 'Supplier List', section: 'Suppliers' },
  { key: 'suppliers_balance', href: '/suppliers/balance', label: 'Balance to Supplier', section: 'Suppliers' },
  { key: 'suppliers_payment', href: '/suppliers/payment', label: 'Payment Suppliers', section: 'Suppliers' },

  // Purchases
  { key: 'purchases', href: '/purchases', label: 'Purchase Orders', section: 'Purchases' },
  { key: 'purchases_bad_orders', href: '/purchases/bad-orders', label: 'Bad Orders', section: 'Purchases' },

  // Management
  { key: 'approvals', href: '/approvals', label: 'Approvals Board', section: 'Management' },
  { key: 'approvals_settings', href: '/approvals/settings', label: 'Workflow Settings', section: 'Management' },
  { key: 'reports', href: '/reports', label: 'Reports', section: 'Management' },
  { key: 'user_management', href: '/user-management', label: 'User Management', section: 'Management', protected: true },
  { key: 'settings', href: '/settings', label: 'Settings', section: 'Management', protected: true },
];

export const TOGGLEABLE_PAGES: RegistryPage[] = PAGE_REGISTRY.filter(p => !p.protected);

const PROTECTED_HREFS = new Set(
  PAGE_REGISTRY.filter(p => p.protected).map(p => p.href),
);

export function isProtectedHref(href: string): boolean {
  if (href.startsWith('/developer')) return true;
  return PROTECTED_HREFS.has(href);
}

export function pageKeyForHref(href: string): string | undefined {
  return PAGE_REGISTRY.find(p => p.href === href)?.key;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/e2e/page-registry.spec.ts --project=chromium`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/page-registry.ts tests/e2e/page-registry.spec.ts
git commit -m "feat(developer): page registry for toggleable pages"
```

---

### Task 2: disabled-pages API

**Files:**
- Create: `app/api/developer/disabled-pages/route.ts`
- Test: `tests/e2e/disabled-pages-api.spec.ts`

**Interfaces:**
- Consumes: `query` from `../../../../lib/mysql`; `PAGE_REGISTRY` from `@/lib/page-registry` (to validate keys server-side); `isProtectedHref` is NOT used here — protection is enforced by rejecting keys whose registry entry is `protected`.
- Produces:
  - `GET` → `{ success: true, disabled: string[] }`
  - `POST` body `{ disabled: string[] }` → `{ success: true }`. Filters out unknown and protected keys before persisting.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/disabled-pages-api.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';

test.describe('disabled-pages API', () => {
  test.afterEach(async () => {
    await testQuery('DELETE FROM disabled_pages');
  });

  test('GET returns empty list when nothing disabled', async ({ request }) => {
    await testQuery('DELETE FROM disabled_pages').catch(() => {});
    const res = await request.get('/api/developer/disabled-pages');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.disabled)).toBe(true);
    expect(body.disabled).toEqual([]);
  });

  test('POST persists valid keys and GET returns them', async ({ request }) => {
    const res = await request.post('/api/developer/disabled-pages', {
      data: { disabled: ['sales_orders', 'sales_invoices'] },
    });
    expect((await res.json()).success).toBe(true);

    const get = await request.get('/api/developer/disabled-pages');
    const body = await get.json();
    expect(body.disabled.sort()).toEqual(['sales_invoices', 'sales_orders']);
  });

  test('POST rejects protected and unknown keys', async ({ request }) => {
    await request.post('/api/developer/disabled-pages', {
      data: { disabled: ['settings', 'dashboard', 'not_a_real_key', 'sales_orders'] },
    });
    const get = await request.get('/api/developer/disabled-pages');
    const body = await get.json();
    expect(body.disabled).toEqual(['sales_orders']);
  });

  test('POST replaces the full set', async ({ request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['sales_orders'] } });
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['reports'] } });
    const get = await request.get('/api/developer/disabled-pages');
    expect((await get.json()).disabled).toEqual(['reports']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/disabled-pages-api.spec.ts --project=chromium`
Expected: FAIL — route returns 404.

- [ ] **Step 3: Write the route**

Create `app/api/developer/disabled-pages/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../../lib/mysql';
import { PAGE_REGISTRY } from '@/lib/page-registry';

const TOGGLEABLE_KEYS = new Set(
  PAGE_REGISTRY.filter(p => !p.protected).map(p => p.key),
);

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS disabled_pages (
      page_key VARCHAR(100) NOT NULL PRIMARY KEY,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

export async function GET() {
  try {
    await ensureTable();
    const rows = await query('SELECT page_key FROM disabled_pages');
    return NextResponse.json({
      success: true,
      disabled: rows.map((r: any) => r.page_key),
    });
  } catch (error) {
    console.error('Error fetching disabled pages:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch disabled pages' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureTable();
    const body = await request.json();
    const requested: string[] = Array.isArray(body.disabled) ? body.disabled : [];
    // Only persist keys that are known AND toggleable — drops protected/unknown.
    const valid = [...new Set(requested)].filter(k => TOGGLEABLE_KEYS.has(k));

    await query('DELETE FROM disabled_pages');
    for (const key of valid) {
      await query('INSERT INTO disabled_pages (page_key) VALUES (?)', [key]);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating disabled pages:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update disabled pages' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/e2e/disabled-pages-api.spec.ts --project=chromium`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/developer/disabled-pages/route.ts tests/e2e/disabled-pages-api.spec.ts
git commit -m "feat(developer): disabled-pages API with table + key validation"
```

---

### Task 3: Layout hook — fetch disabled set and filter nav

**Files:**
- Modify: `app/(app)/use-app-layout.ts`
- Test: `tests/e2e/developer-page-toggles.spec.ts` (created here; asserts sidebar hiding via the running app)

**Interfaces:**
- Consumes: `getApiUrl` from `@/lib/api-config`; `navItems`, `otherNavItems`, `inventoryNavItems`, `salesNavItems`, `customerNavItems`, `suppliersNavItems`, `purchasesNavItems` from `./layout-nav-config`; `pageKeyForHref`, `isProtectedHref` from `@/lib/page-registry`.
- Produces (added to the hook's return object):
  - `disabledKeys: Set<string>`
  - `disabledLoaded: boolean`
  - `filteredInventoryNavItems`, `filteredSalesNavItems`, `filteredCustomerNavItems`, `filteredSuppliersNavItems`, `filteredPurchasesNavItems` — each `{ href: string; label: string }[]` with disabled hrefs removed.
  - `filteredNavItems` and `filteredOtherNavItems` now also drop disabled hrefs (in addition to the existing permission filter).

- [ ] **Step 1: Write the failing E2E test (sidebar hiding)**

Create `tests/e2e/developer-page-toggles.spec.ts`. Authentication uses the real
`seedSession` helper from `./helpers/auth` (prepopulates the `mock-user-session`
localStorage key before navigation — no login form needed). The developer page and the
super-admin logic key off `permissions` containing `'super_admin'`, so seed a session
with that permission.

```ts
import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';

const SUPER_ADMIN = { ...DEFAULT_ADMIN, permissions: ['super_admin'] };

test.describe('developer page toggles — sidebar', () => {
  test.afterEach(async () => {
    await testQuery('DELETE FROM disabled_pages').catch(() => {});
  });

  test('disabling sales_orders hides the Sales Order link', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['sales_orders'] } });

    await seedSession(page, SUPER_ADMIN);
    await page.goto('/dashboard');
    // Open the Sales section so its sub-links render.
    await page.getByRole('button', { name: 'Sales' }).click();

    await expect(page.getByRole('link', { name: 'Sales Invoice/Delivery' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sales Order' })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/developer-page-toggles.spec.ts --project=chromium`
Expected: FAIL — "Sales Order" link is still visible (filter not wired yet).

- [ ] **Step 3: Wire the hook**

Modify `app/(app)/use-app-layout.ts`. Add the import and the fetch + filtering. Full changed regions:

Add to imports at top:

```ts
import {
  navItems, otherNavItems,
  inventoryNavItems, salesNavItems, customerNavItems,
  suppliersNavItems, purchasesNavItems,
} from './layout-nav-config';
import { pageKeyForHref } from '@/lib/page-registry';
```

Add state near the other `useState` calls:

```ts
  const [disabledKeys, setDisabledKeys] = useState<Set<string>>(new Set());
  const [disabledLoaded, setDisabledLoaded] = useState(false);
```

Add an effect (after the business-name effect):

```ts
  // Disabled pages (store-wide developer toggles).
  useEffect(() => {
    fetch(getApiUrl('/developer/disabled-pages'))
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(result => {
        if (result.success && Array.isArray(result.disabled)) {
          setDisabledKeys(new Set(result.disabled));
        }
      })
      .catch(() => {})
      .finally(() => setDisabledLoaded(true));
  }, []);
```

Add a helper and the filtered lists (replace the existing `filteredNavItems` / `filteredOtherNavItems` definitions):

```ts
  const isEnabled = (href: string) => {
    const key = pageKeyForHref(href);
    return !key || !disabledKeys.has(key);
  };

  const filteredNavItems = navItems.filter(
    item => hasPermission(item.permission) && isEnabled(item.href),
  );
  const filteredOtherNavItems = otherNavItems.filter(
    item => hasPermission(item.permission) && isEnabled(item.href),
  );

  const filteredInventoryNavItems = inventoryNavItems.filter(i => isEnabled(i.href));
  const filteredSalesNavItems = salesNavItems.filter(i => isEnabled(i.href));
  const filteredCustomerNavItems = customerNavItems.filter(i => isEnabled(i.href));
  const filteredSuppliersNavItems = suppliersNavItems.filter(i => isEnabled(i.href));
  const filteredPurchasesNavItems = purchasesNavItems.filter(i => isEnabled(i.href));
```

Extend the returned object:

```ts
  return {
    user, isUserLoading, isPOSPage,
    businessName,
    hasPermission, getInitials,
    filteredNavItems, filteredOtherNavItems,
    filteredInventoryNavItems, filteredSalesNavItems,
    filteredCustomerNavItems, filteredSuppliersNavItems,
    filteredPurchasesNavItems,
    disabledKeys, disabledLoaded,
    pathname,
  };
```

- [ ] **Step 4: Pass filtered section lists into AppSidebar**

Modify `app/(app)/AppSidebar.tsx`. Change the `Props` type to accept the section lists, and use them instead of importing the raw configs.

Replace the section-config import (lines 23-26) — remove `inventoryNavItems, salesNavItems, customerNavItems, suppliersNavItems, purchasesNavItems` from the `./layout-nav-config` import (keep the import only if other names are still used; here none are, so delete the whole `import { ... } from './layout-nav-config';` block).

Extend `Props`:

```ts
type Props = {
  user: AppUser;
  hasPermission: (permission?: string) => boolean;
  filteredNavItems: { href: string; icon: any; label: string; permission?: string }[];
  filteredOtherNavItems: { href: string; icon: any; label: string; permission?: string }[];
  inventoryNavItems: { href: string; label: string }[];
  salesNavItems: { href: string; label: string }[];
  customerNavItems: { href: string; label: string }[];
  suppliersNavItems: { href: string; label: string }[];
  purchasesNavItems: { href: string; label: string }[];
  pathname: string;
  getInitials: (email?: string | null) => string;
};
```

Add the five names to the destructured params:

```ts
export function AppSidebar({
  user, hasPermission,
  filteredNavItems, filteredOtherNavItems,
  inventoryNavItems, salesNavItems, customerNavItems,
  suppliersNavItems, purchasesNavItems,
  pathname, getInitials,
}: Props) {
```

The existing `buildNavIndex([...])` call and the five `CollapsibleNavSection` usages already reference these names, so they now consume the filtered props automatically (search results also drop disabled pages).

- [ ] **Step 5: Pass props from the layout**

Modify `app/(app)/layout.tsx`. Pull the new values from the hook and forward them:

```tsx
  const {
    user, isUserLoading, isPOSPage,
    businessName, hasPermission, getInitials,
    filteredNavItems, filteredOtherNavItems,
    filteredInventoryNavItems, filteredSalesNavItems,
    filteredCustomerNavItems, filteredSuppliersNavItems,
    filteredPurchasesNavItems,
    pathname,
  } = useAppLayout();
```

```tsx
        <AppSidebar
          user={user}
          hasPermission={hasPermission}
          filteredNavItems={filteredNavItems}
          filteredOtherNavItems={filteredOtherNavItems}
          inventoryNavItems={filteredInventoryNavItems}
          salesNavItems={filteredSalesNavItems}
          customerNavItems={filteredCustomerNavItems}
          suppliersNavItems={filteredSuppliersNavItems}
          purchasesNavItems={filteredPurchasesNavItems}
          pathname={pathname}
          getInitials={getInitials}
        />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx playwright test tests/e2e/developer-page-toggles.spec.ts --project=chromium`
Expected: PASS — "Sales Order" link absent, "Sales Invoice/Delivery" visible.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: prints nothing (baseline empty; .next noise filtered).
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/use-app-layout.ts app/\(app\)/AppSidebar.tsx app/\(app\)/layout.tsx tests/e2e/developer-page-toggles.spec.ts
git commit -m "feat(developer): hide disabled pages from sidebar and search"
```

---

### Task 4: URL redirect guard

**Files:**
- Modify: `app/(app)/layout.tsx`
- Test: extend `tests/e2e/developer-page-toggles.spec.ts`

**Interfaces:**
- Consumes: `disabledKeys`, `disabledLoaded`, `pathname` from the hook; `pageKeyForHref`, `isProtectedHref` from `@/lib/page-registry`; `useRouter` from `next/navigation`.
- Produces: navigating to a disabled page URL replaces to `/dashboard`.

- [ ] **Step 1: Write the failing test (append to the spec)**

Add to `tests/e2e/developer-page-toggles.spec.ts` inside the describe block:

```ts
  test('navigating to a disabled page URL redirects to dashboard', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['sales_orders'] } });

    await seedSession(page, SUPER_ADMIN);
    await page.goto('/sales/orders');
    await page.waitForURL('**/dashboard');
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('re-enabling a page restores the link and the URL', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: [] } });

    await seedSession(page, SUPER_ADMIN);
    await page.goto('/sales/orders');
    // Should stay on /sales/orders, not redirect.
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/sales/orders');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/developer-page-toggles.spec.ts --project=chromium -g "redirects to dashboard"`
Expected: FAIL — page stays on `/sales/orders` (no guard yet).

- [ ] **Step 3: Add the guard to the layout**

Modify `app/(app)/layout.tsx`. Add imports:

```tsx
import { useRouter } from 'next/navigation';
import { pageKeyForHref, isProtectedHref } from '@/lib/page-registry';
```

Pull `disabledKeys` and `disabledLoaded` from the hook (extend the existing destructure from Task 3 to include them):

```tsx
    filteredPurchasesNavItems,
    disabledKeys, disabledLoaded,
    pathname,
  } = useAppLayout();

  const router = useRouter();

  // Redirect away from pages disabled via developer options. Wait for the set
  // to load so an enabled page is not redirected during the fetch window.
  React.useEffect(() => {
    if (!disabledLoaded) return;
    if (isProtectedHref(pathname)) return;
    const key = pageKeyForHref(pathname);
    if (key && disabledKeys.has(key)) {
      router.replace('/dashboard');
    }
  }, [disabledLoaded, disabledKeys, pathname, router]);
```

Place this effect above the early `if (isPOSPage) return ...` returns is NOT allowed (hooks must run unconditionally) — it is already above them here because it sits right after the hook destructure and before the conditional returns. Verify no early return precedes it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test tests/e2e/developer-page-toggles.spec.ts --project=chromium`
Expected: PASS (all cases — hide, redirect, re-enable).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: prints nothing (baseline empty; .next noise filtered).
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/layout.tsx tests/e2e/developer-page-toggles.spec.ts
git commit -m "feat(developer): redirect disabled page URLs to dashboard"
```

---

### Task 5: Developer options page

**Files:**
- Create: `app/(app)/developer/options/page.tsx`
- Test: extend `tests/e2e/developer-page-toggles.spec.ts`

**Interfaces:**
- Consumes: `TOGGLEABLE_PAGES` from `@/lib/page-registry`; `getApiUrl` from `@/lib/api-config`; `Switch` from `@/components/ui/switch`; `useToast` from `@/hooks/use-toast`; `Button`, `Card*` from `@/components/ui/*`; `useRouter` from `next/navigation`.
- Produces: a super-admin-gated UI that GETs the disabled set, renders a toggle per toggleable page grouped by section, and POSTs the new set on save.

- [ ] **Step 1: Write the failing test (append to the spec)**

Add to `tests/e2e/developer-page-toggles.spec.ts`:

```ts
  test('developer options page toggles a page off end-to-end', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: [] } });

    await seedSession(page, SUPER_ADMIN);
    await page.goto('/developer/options');

    // Toggle Sales Order off (switch is labelled by the page label).
    const row = page.getByRole('row', { name: /Sales Order/ }).first();
    await row.getByRole('switch').click();
    await page.getByRole('button', { name: /save/i }).click();

    // Confirm it persisted via the API.
    await expect.poll(async () => {
      const r = await request.get('/api/developer/disabled-pages');
      return (await r.json()).disabled;
    }).toContain('sales_orders');
  });
```

Note: the switch layout below uses a plain flex row, not a table `<row>`. Adjust the selector in this test to match the markup written in Step 3 (e.g. `page.getByText('Sales Order').locator('..').getByRole('switch')`). Confirm the selector against the real markup before finalizing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/developer-page-toggles.spec.ts --project=chromium -g "toggles a page off end-to-end"`
Expected: FAIL — `/developer/options` 404s.

- [ ] **Step 3: Write the page**

Create `app/(app)/developer/options/page.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiUrl } from '@/lib/api-config';
import { TOGGLEABLE_PAGES } from '@/lib/page-registry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Save, ShieldAlert } from 'lucide-react';

export default function DeveloperOptionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Super-admin gate.
  useEffect(() => {
    try {
      const session = JSON.parse(localStorage.getItem('mock-user-session') || '{}');
      if (session?.permissions?.includes('super_admin')) {
        setAuthorized(true);
      } else {
        router.replace('/dashboard');
      }
    } catch {
      router.replace('/dashboard');
    }
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    fetch(getApiUrl('/developer/disabled-pages'))
      .then(res => res.json())
      .then(result => {
        if (result.success) setDisabled(new Set(result.disabled));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authorized]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof TOGGLEABLE_PAGES>();
    for (const p of TOGGLEABLE_PAGES) {
      const list = map.get(p.section) ?? [];
      list.push(p);
      map.set(p.section, list);
    }
    return [...map.entries()];
  }, []);

  const toggle = (key: string, enabled: boolean) => {
    setDisabled(prev => {
      const next = new Set(prev);
      if (enabled) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(getApiUrl('/developer/disabled-pages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: [...disabled] }),
      });
      const body = await res.json();
      if (!body.success) throw new Error();
      toast({ title: 'Saved', description: 'Page visibility updated. Reload to apply everywhere.' });
    } catch {
      toast({ title: 'Save failed', description: 'Could not update page visibility.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!authorized) return null;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" />
            Developer Options
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Enable or disable pages. Disabled pages are hidden from the sidebar and their URLs redirect to the dashboard.
          </p>
        </div>
        <Button onClick={save} disabled={saving || loading}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {grouped.map(([section, pages]) => (
          <Card key={section}>
            <CardHeader>
              <CardTitle>{section}</CardTitle>
              <CardDescription>{pages.length} pages</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pages.map(p => {
                const enabled = !disabled.has(p.key);
                return (
                  <div key={p.key} className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{p.label}</span>
                      <span className="text-xs text-muted-foreground font-mono">{p.href}</span>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => toggle(p.key, v)}
                      aria-label={p.label}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Fix the test selector to match markup**

The markup uses a flex row with the label text and an `aria-label` on the switch. Update the Step 1 test's toggle line to:

```ts
    await page.getByRole('switch', { name: 'Sales Order' }).click();
```

Remove the `row`-based lookup.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test tests/e2e/developer-page-toggles.spec.ts --project=chromium -g "toggles a page off end-to-end"`
Expected: PASS — `sales_orders` appears in the persisted disabled set.

- [ ] **Step 6: Run the full spec + typecheck**

Run: `npx playwright test tests/e2e/developer-page-toggles.spec.ts --project=chromium`
Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: prints nothing (baseline empty; .next noise filtered).
Expected: all PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/developer/options/page.tsx tests/e2e/developer-page-toggles.spec.ts
git commit -m "feat(developer): super-admin page to toggle page visibility"
```

---

### Task 6: Full regression

**Files:** none (verification only).

- [ ] **Step 1: Typecheck (lint is broken repo-wide — do NOT run `npm run lint`)**

Run: `npm run typecheck 2>&1 | grep -v "^\.next" | grep -E "error TS"`
Expected: prints nothing (baseline is empty; `.next/` parse noise is filtered out and must never be "fixed").

- [ ] **Step 3: Run the new specs together**

Run: `npx playwright test tests/e2e/page-registry.spec.ts tests/e2e/disabled-pages-api.spec.ts tests/e2e/developer-page-toggles.spec.ts --project=chromium`
Expected: all PASS.

- [ ] **Step 4: Sanity — clean the test table**

Run: `npm run test:e2e:db` (re-seeds the test DB, clearing `disabled_pages` residue) — only if other suites depend on a clean state.

---

## Self-Review Notes

- **Spec coverage:** registry (Task 1) ✓, DB+API storage (Task 2) ✓, sidebar hiding incl. search (Task 3) ✓, URL guard (Task 4) ✓, super-admin developer page (Task 5) ✓, protected-page enforcement (registry excludes + API filters + guard `isProtectedHref`) ✓, E2E for disable→hide→redirect→re-enable ✓.
- **Placeholders:** none — every code step is complete. Two selector-adjustment notes (Task 3 login helper, Task 5 switch selector) are explicit "verify against real markup" steps, not deferred work.
- **Type consistency:** `pageKeyForHref`, `isProtectedHref`, `TOGGLEABLE_PAGES`, `PAGE_REGISTRY` used identically across tasks; hook's added return keys (`disabledKeys`, `disabledLoaded`, `filtered*NavItems`) match their consumers in `layout.tsx` and `AppSidebar.tsx`.
```
