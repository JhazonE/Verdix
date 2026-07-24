'use client';

import React, { Suspense } from 'react';
import { Store } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { QueryClientProvider } from '@tanstack/react-query';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AnimatedSidebarTrigger } from '@/components/AnimatedSidebarTrigger';
import { WindowControls } from '@/components/window-controls';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { NavigationProgress } from '@/components/navigation-progress';
import { pageKeyForHref, isProtectedHref } from '@/lib/page-registry';
import { queryClient } from './layout-nav-config';
import { useAppLayout } from './use-app-layout';
import { AppSidebar } from './AppSidebar';
import { NotificationsBell } from './NotificationsBell';
import { useLicenseHeartbeat } from './use-license-heartbeat';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const {
    user, isUserLoading, isPOSPage,
    businessName, hasPermission, getInitials,
    filteredNavItems, filteredOtherNavItems,
    filteredInventoryNavItems, filteredSalesNavItems,
    filteredCustomerNavItems, filteredSuppliersNavItems,
    filteredPurchasesNavItems,
    disabledKeys, disabledLoaded,
    pathname,
  } = useAppLayout();

  const router = useRouter();

  useLicenseHeartbeat();

  // Seed the sidebar's initial open state from the persisted cookie so a
  // collapsed sidebar stays collapsed across reloads. Read once on mount.
  const [defaultSidebarOpen] = React.useState(() => {
    if (typeof document === 'undefined') return true;
    const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
    return match ? match[1] === 'true' : true;
  });

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

  if (isPOSPage) return <>{children}</>;

  if (isUserLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <SidebarProvider defaultOpen={defaultSidebarOpen} className="h-screen overflow-hidden">
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
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-30 flex items-center h-16 gap-4 px-4 border-b bg-background/80 backdrop-blur-sm sm:px-6 non-printable window-drag">
            <div className="flex items-center gap-4 window-no-drag">
              <AnimatedSidebarTrigger />
              <AppBreadcrumbs />
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              {businessName && (
                <>
                  <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-border/60 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent py-1.5 pl-2 pr-4 shadow-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20">
                      <Store className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-sm font-bold tracking-tight text-foreground/90">{businessName}</span>
                  </div>
                  <div className="hidden sm:block h-6 w-px bg-border/60" />
                </>
              )}
              <NotificationsBell user={user} />
              <WindowControls />
            </div>
          </header>
          <main className="flex-1 flex flex-col overflow-auto p-4 sm:p-6 min-h-0">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </QueryClientProvider>
  );
}
