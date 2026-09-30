import { QueryClient, DefaultOptions } from '@tanstack/react-query';
import {
  LayoutDashboard, Package, ClipboardCheck, BarChart3,
  Users, Settings,
} from 'lucide-react';

const queryConfig: DefaultOptions = {
  queries: {
    staleTime: 30 * 1000, // Data is considered stale after 30 seconds
    gcTime: 5 * 60 * 1000, // Cache is garbage collected after 5 minutes
    retry: 1, // Retry failed requests once
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnReconnect: true, // Refetch when reconnecting to network
  },
};

export const queryClient = new QueryClient({ defaultOptions: queryConfig });

export const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', permission: 'view_dashboard' },
  { href: '/products', icon: Package, label: 'Products', permission: 'manage_products' },
];

export const inventoryNavItems = [
  { href: '/inventory', label: 'Stock Levels' },
  { href: '/inventory/stock-counts', label: 'Stock Counts (Snapshots)' },
  { href: '/inventory/repackaging', label: 'Repackaging' },
];

export const salesNavItems = [
  { href: '/sales/orders', label: 'Sales Order' },
  { href: '/sales/invoices', label: 'Sales Invoice/Delivery' },
];

export const customerNavItems = [
  { href: '/customer', label: 'Customer List' },
  { href: '/customer/payment', label: 'Customer Payment' },
  { href: '/customer/balances', label: 'Customer Balances' },
  { href: '/customer/loyalty', label: 'Customer Loyalty Points' },
];

export const suppliersNavItems = [
  { href: '/suppliers/list', label: 'Supplier List' },
  { href: '/suppliers/balance', label: 'Balance to Supplier' },
  { href: '/suppliers/payment', label: 'Payment Suppliers' },
];

export const purchasesNavItems = [
  { href: '/purchases', label: 'Purchase Orders' },
  { href: '/purchases/bad-orders', label: 'Bad Orders' },
];

export const otherNavItems = [
  { href: '/approvals', icon: ClipboardCheck, label: 'Approvals Board', permission: 'view_approvals' },
  { href: '/approvals/settings', icon: Settings, label: 'Workflow Settings', permission: 'manage_approval_settings' },
  { href: '/reports', icon: BarChart3, label: 'Reports', permission: 'view_reports' },
  { href: '/user-management', icon: Users, label: 'User Management', permission: 'manage_users' },
  { href: '/settings', icon: Settings, label: 'Settings', permission: 'manage_settings' },
];
