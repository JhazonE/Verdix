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

  // The price-checker kiosk (`/price-check`) is fullscreen like POS: no
  // sidebar, no header, no nav. `isChromelessPage` is what the layout keys its
  // chrome bypass on. `isPOSPage` keeps its narrower meaning because
  // `browserPosBlocked` is specifically about POS checkout in a browser.
  //
  // Deliberately NOT used by the auth check below: the kiosk needs its session
  // loaded, because the redirect that pins a Price Inquiry account to this
  // screen reads `user.userType`.
  const isChromelessPage = isPOSPage || pathname === '/price-check';

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
        // Browser POS is CLOSED by default: absent/NULL reads as "not allowed",
        // so a store must opt in from Developer Options before /pos answers a
        // browser. Electron is exempt below and never depends on this value.
        const allowed = result.data?.enableBrowserPos ?? 0;
        setBrowserPosBlocked(isPOSPage && !isDesktopApp() && !Number(allowed));
      })
      .catch(() => {});
  }, [isPOSPage]);

  // Disabled pages (store-wide developer toggles). Skipped on the chromeless
  // screens — POS, customer-display and the price-check kiosk — which render
  // before the sidebar and never consume the disabled set.
  useEffect(() => {
    if (isChromelessPage) { setDisabledLoaded(true); return; }
    fetch(getApiUrl('/developer/disabled-pages'))
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(result => {
        if (result.success && Array.isArray(result.disabled)) {
          setDisabledKeys(new Set(result.disabled));
        }
      })
      .catch(() => {})
      .finally(() => setDisabledLoaded(true));
  }, [isChromelessPage]);

  // Document title
  useEffect(() => { document.title = businessName; }, [businessName]);

  // Force Cashiers to POS, and Price Inquiry accounts to the kiosk.
  //
  // The kiosk pin is what makes the restricted account actually restricted:
  // the customer is standing at an unattended terminal, so a typed URL must
  // not land them in inventory or reports.
  useEffect(() => {
    if (user?.userType === 'Cashier' && pathname !== '/pos') router.push('/pos');
    if (user?.userType === 'Price Inquiry' && pathname !== '/price-check') router.push('/price-check');
  }, [user, pathname, router]);

  const hasPermission = (permission?: string) => {
    if (!user) return false;
    if (user.permissions?.includes('super_admin')) return true;
    if (user.userType === 'Cashier') return permission === 'access_pos';
    if (user.userType === 'Price Inquiry') return permission === 'price_inquiry';
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
    user, isUserLoading, isPOSPage, isChromelessPage,
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
