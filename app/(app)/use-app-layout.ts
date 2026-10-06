'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getApiUrl } from '@/lib/api-config';
import {
  navItems, otherNavItems,
  inventoryNavItems, salesNavItems, customerNavItems,
  suppliersNavItems, purchasesNavItems,
} from './layout-nav-config';
import { pageKeyForHref } from '@/lib/page-registry';
import { isDesktopApp } from '@/lib/is-desktop-app';

type AppUser = { email: string; permissions?: string[]; userType?: string };

export function useAppLayout() {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser] = useState<AppUser | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const [businessName, setBusinessName] = useState('VENDIX');
  const [disabledKeys, setDisabledKeys] = useState<Set<string>>(new Set());
  const [disabledLoaded, setDisabledLoaded] = useState(false);
  const [browserPosBlocked, setBrowserPosBlocked] = useState(false);

  const isPOSPage = pathname === '/pos' || pathname === '/pos/customer-display';

  // Auth check
  useEffect(() => {
    if (isPOSPage) { setIsUserLoading(false); return; }
    const session = localStorage.getItem('mock-user-session');
    if (session) setUser(JSON.parse(session));
    else router.push('/login');
    setIsUserLoading(false);
  }, [router, pathname]);

  // Business name, plus the browser-POS switch (Developer Options).
  //
  // The gate deliberately applies ONLY to real browsers: the Electron desktop
  // window is the intended POS terminal and must never be locked out by it.
  // A failed fetch leaves the block off — an unreachable settings API is not a
  // reason to strand a cashier mid-shift.
  useEffect(() => {
    fetch(getApiUrl('/pos-settings'))
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(result => {
        if (!result.success) return;
        if (result.data?.businessName) setBusinessName(result.data.businessName);
        // Absent/NULL means "allowed" so an install predating the column keeps working.
        const allowed = result.data?.enableBrowserPos ?? 1;
        setBrowserPosBlocked(isPOSPage && !isDesktopApp() && !Number(allowed));
      })
      .catch(() => {});
  }, [isPOSPage]);

  // Disabled pages (store-wide developer toggles). Skipped on POS/customer-display,
  // which render before the sidebar and never consume the disabled set.
  useEffect(() => {
    if (isPOSPage) { setDisabledLoaded(true); return; }
    fetch(getApiUrl('/developer/disabled-pages'))
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(result => {
        if (result.success && Array.isArray(result.disabled)) {
          setDisabledKeys(new Set(result.disabled));
        }
      })
      .catch(() => {})
      .finally(() => setDisabledLoaded(true));
  }, [isPOSPage]);

  // Document title
  useEffect(() => { document.title = businessName; }, [businessName]);

  // Force Cashiers to POS
  useEffect(() => {
    if (user?.userType === 'Cashier' && pathname !== '/pos') router.push('/pos');
  }, [user, pathname, router]);

  const hasPermission = (permission?: string) => {
    if (!user) return false;
    if (user.permissions?.includes('super_admin')) return true;
    if (user.userType === 'Cashier') return permission === 'access_pos';
    if (permission && !user.permissions?.includes(permission)) return false;
    return true;
  };

  const getInitials = (email?: string | null) =>
    email ? email.substring(0, 2).toUpperCase() : '..';

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

  return {
    user, isUserLoading, isPOSPage,
    businessName,
    browserPosBlocked,
    hasPermission, getInitials,
    filteredNavItems, filteredOtherNavItems,
    filteredInventoryNavItems, filteredSalesNavItems,
    filteredCustomerNavItems, filteredSuppliersNavItems,
    filteredPurchasesNavItems,
    disabledKeys, disabledLoaded,
    pathname,
  };
}
