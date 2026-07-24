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
