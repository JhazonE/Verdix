export type Callout = { n: number; selector?: string; x?: number; y?: number };
export type AuthMode = 'admin' | 'pos' | 'none';

export type Screen = {
  /** Filename stem for the PNG, and the key content.ts references. */
  slug: string;
  route: string;
  /** Figure caption text. */
  title: string;
  auth: AuthMode;
  callouts?: Callout[];
  /** Optional selector to await before shooting, for slow-loading screens. */
  waitFor?: string;
  /** Named POS sequence to run before shooting (see capture.ts). */
  setup?: string;
  /**
   * Mock `/api/license/status` as unlicensed for this screen only, so
   * `components/license-gate.tsx` renders its activation card instead of the
   * real (licensed) app. Scoped per-screen — never applied globally, or every
   * other screenshot would break (LicenseGate blocks the whole app when
   * unlicensed). See capture.ts.
   */
  mockUnlicensed?: boolean;
};

const ROOT_ROUTES = new Set(['/login', '/signup', '/activate']);

export function routeToPageFile(route: string): string {
  const clean = route.split('?')[0].replace(/\/$/, '');
  if (ROOT_ROUTES.has(clean)) return `app${clean}/page.tsx`;
  return `app/(app)${clean}/page.tsx`;
}

export const SCREENS: Screen[] = [
  // Ch.1 Getting Started
  { slug: 'login', route: '/login', title: 'The login screen', auth: 'none',
    callouts: [{ n: 1, selector: 'input#username' }, { n: 2, selector: 'input#password' }] },
  { slug: 'activate-online', route: '/login', title: 'License activation — Online', auth: 'none',
    mockUnlicensed: true },
  { slug: 'activate-offline', route: '/login', title: 'License activation — Offline', auth: 'none',
    mockUnlicensed: true, setup: 'activateOfflineTab' },
  { slug: 'dashboard', route: '/dashboard', title: 'The dashboard', auth: 'admin',
    callouts: [{ n: 1, selector: '[data-slot="sidebar"]' }] },

  // Ch.3 Products
  { slug: 'products-list', route: '/products', title: 'The product list', auth: 'admin' },

  // Ch.4 Inventory
  { slug: 'inventory-levels', route: '/inventory', title: 'Stock levels', auth: 'admin' },
  { slug: 'inventory-stock-counts', route: '/inventory/stock-counts', title: 'Stock counts', auth: 'admin' },
  { slug: 'inventory-repackaging', route: '/inventory/repackaging', title: 'Repackaging', auth: 'admin' },
  { slug: 'inventory-history', route: '/inventory/history', title: 'Adjustment history', auth: 'admin' },
  { slug: 'inventory-movement', route: '/inventory/movement', title: 'Stock movement', auth: 'admin' },

  // Ch.5 Purchasing & Suppliers
  { slug: 'purchases', route: '/purchases', title: 'Purchase orders', auth: 'admin' },
  { slug: 'purchases-bad-orders', route: '/purchases/bad-orders', title: 'Bad orders', auth: 'admin' },
  { slug: 'suppliers-list', route: '/suppliers/list', title: 'Supplier list', auth: 'admin' },
  { slug: 'suppliers-balance', route: '/suppliers/balance', title: 'Balance to supplier', auth: 'admin' },
  { slug: 'suppliers-payment', route: '/suppliers/payment', title: 'Supplier payments', auth: 'admin' },

  // Ch.6 Customers
  { slug: 'customer-list', route: '/customer', title: 'Customer list', auth: 'admin' },
  { slug: 'customer-payment', route: '/customer/payment', title: 'Customer payment', auth: 'admin' },
  { slug: 'customer-balances', route: '/customer/balances', title: 'Customer balances', auth: 'admin' },
  { slug: 'customer-loyalty', route: '/customer/loyalty', title: 'Loyalty points', auth: 'admin' },

  // Ch.7 Approvals
  { slug: 'approvals', route: '/approvals', title: 'Approvals board', auth: 'admin' },
  { slug: 'approvals-settings', route: '/approvals/settings', title: 'Workflow settings', auth: 'admin' },

  // Ch.8 Reports
  { slug: 'reports-hub', route: '/reports', title: 'The reports hub', auth: 'admin' },
  { slug: 'reports-sales-summary', route: '/reports/sales/summary', title: 'Sales summary report', auth: 'admin' },
  { slug: 'reports-low-stock', route: '/reports/low-stock', title: 'Low stock report', auth: 'admin' },

  // Ch.9 Settings & Users
  { slug: 'settings', route: '/settings', title: 'Settings', auth: 'admin' },
  { slug: 'settings-pos-setup', route: '/settings/pos-setup', title: 'POS setup', auth: 'admin' },
  { slug: 'settings-pos-terminals', route: '/settings/pos-terminals', title: 'POS terminals', auth: 'admin' },
  { slug: 'settings-tax-rates', route: '/settings/tax-rates', title: 'Tax rates', auth: 'admin' },
  { slug: 'user-management', route: '/user-management', title: 'User management', auth: 'admin' },

  // Ch.2 POS — driven by named setup sequences in capture.ts
  { slug: 'pos-login', route: '/pos', title: 'Cashier login', auth: 'none', setup: 'posLoginForm',
    callouts: [{ n: 1, selector: 'input#username' }, { n: 2, selector: 'input#password' }] },
  { slug: 'pos-start-shift', route: '/pos', title: 'Start shift dialog', auth: 'pos', setup: 'posStartShiftDialog' },
  { slug: 'pos-empty', route: '/pos', title: 'The POS screen', auth: 'pos', setup: 'posShiftStarted' },
  { slug: 'pos-cart', route: '/pos', title: 'Items in the cart', auth: 'pos', setup: 'posWithCart' },
  { slug: 'pos-x-reading', route: '/pos/x-reading', title: 'X-Reading', auth: 'pos', setup: 'posShiftStarted' },
  { slug: 'pos-z-reading', route: '/pos/z-reading', title: 'Z-Reading', auth: 'pos', setup: 'posShiftStarted' },
];
