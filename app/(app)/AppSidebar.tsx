'use client';

import Link from 'next/link';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useSidebar } from '@/components/ui/sidebar';
import { Input } from '@/components/ui/input';
import {
  Warehouse, ChartNoAxesCombined, User as UserIcon,
  ShoppingCart, Users, ChevronDown, LogOut, Search,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { handleSignOut } from '../auth-actions';
import { buildNavIndex, filterNavIndex, matchSegments } from '@/lib/sidebar-search';
import { useMemo, useRef, useState, useEffect } from 'react';

type AppUser = { email: string; permissions?: string[]; userType?: string };

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

export function AppSidebar({
  user, hasPermission,
  filteredNavItems, filteredOtherNavItems,
  inventoryNavItems, salesNavItems, customerNavItems,
  suppliersNavItems, purchasesNavItems,
  pathname, getInitials,
}: Props) {
  const isSalesPage = pathname.startsWith('/sales');
  const isInventoryPage = pathname.startsWith('/inventory');
  const isCustomerPage = pathname.startsWith('/customer');
  const isSuppliersPage = pathname.startsWith('/suppliers');
  const isPurchasesPage = pathname.startsWith('/purchases');

  const hasOperations = hasPermission('manage_inventory') || hasPermission('view_sales') ||
    hasPermission('manage_customers') || hasPermission('manage_purchases') || hasPermission('manage_suppliers');

  const { state: sidebarState, setOpen } = useSidebar();
  const isCollapsed = sidebarState === 'collapsed';
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const navIndex = useMemo(() => buildNavIndex([
    { section: null, items: filteredNavItems },
    { section: 'Inventory', items: inventoryNavItems },
    { section: 'Sales', items: salesNavItems },
    { section: 'Customers', items: customerNavItems },
    { section: 'Purchases', items: purchasesNavItems },
    { section: 'Suppliers', items: suppliersNavItems },
    { section: null, items: filteredOtherNavItems },
  ]), [filteredNavItems, filteredOtherNavItems]);

  const matches = filterNavIndex(navIndex, query);
  const isSearching = query.trim().length > 0;

  // Ctrl/Cmd+K focuses the search box.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setOpen]);

  return (
    <Sidebar className="non-printable border-r" collapsible="icon">
      <SidebarHeader className="h-20 border-b border-sidebar-border sticky top-0 bg-gradient-to-b from-sidebar to-sidebar/95 backdrop-blur-xl z-10 px-6 group-data-[collapsible=icon]:px-0 justify-center shadow-sm">
        <div className="flex items-center gap-3 transition-all duration-300 group-data-[collapsible=icon]:justify-center">
          <Logo variant="icon" size={36} />
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <h1 className="text-xl font-extrabold font-headline tracking-tight text-sidebar-foreground">VENDIX</h1>
            <span className="text-[10px] uppercase font-bold text-primary tracking-[0.2em] mt-0.5 opacity-90">Enterprise</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-6 gap-2 overflow-y-auto flex-1 group-data-[collapsible=icon]:px-0">
        {isCollapsed ? (
          <button
            type="button"
            aria-label="Search navigation"
            title="Search (Ctrl+K)"
            onClick={() => { setOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }}
            className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Search className="size-4" />
          </button>
        ) : (
          <div className="relative px-1 mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setQuery(''); searchRef.current?.blur(); }
                if (e.key === 'Enter' && matches.length > 0) {
                  window.location.assign(matches[0].href);
                }
              }}
              placeholder="Search... (Ctrl+K)"
              className="h-9 pl-9 text-sm bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus-visible:ring-1"
            />
          </div>
        )}

        {isSearching ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.1em] font-bold text-muted-foreground/80 px-4 mb-3">
              Results ({matches.length})
            </SidebarGroupLabel>
            <SidebarMenu>
              {matches.length === 0 && (
                <div className="px-4 py-2 text-[13px] text-muted-foreground">No pages found.</div>
              )}
              {matches.map(m => (
                <SidebarMenuItem key={m.href}>
                  <Link href={m.href}>
                    <SidebarMenuButton isActive={pathname === m.href} className="gap-3 px-4 py-2 font-medium rounded-lg">
                      <span className="text-[14px]">
                        {matchSegments(m.label, query).map((seg, i) =>
                          seg.match
                            ? <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5">{seg.text}</mark>
                            : <span key={i}>{seg.text}</span>,
                        )}
                        {m.section && <span className="ml-1 text-[11px] text-muted-foreground">· {m.section}</span>}
                      </span>
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          <>
            {filteredNavItems.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.1em] font-bold text-muted-foreground/80 px-4 mb-3">Platform</SidebarGroupLabel>
                <SidebarMenu>
                  {filteredNavItems.map(item => (
                    <SidebarMenuItem key={item.href}>
                      <Link href={item.href}>
                        <SidebarMenuButton isActive={pathname === item.href} tooltip={{ children: item.label }} className="relative gap-3 px-4 py-2.5 font-medium rounded-lg transition-all duration-200 hover:shadow-sm data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1/2 data-[active=true]:before:h-5 data-[active=true]:before:w-1 data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:rounded-r-full data-[active=true]:before:bg-primary data-[active=true]:text-primary">
                          <item.icon />
                          <span className="text-[14px]">{item.label}</span>
                        </SidebarMenuButton>
                      </Link>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            )}

            {hasOperations && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.1em] font-bold text-muted-foreground/80 px-4 mb-3">Operations</SidebarGroupLabel>
                <SidebarMenu>
                  {hasPermission('manage_inventory') && (
                    <CollapsibleNavSection label="Inventory" icon={Warehouse} isActive={isInventoryPage} items={inventoryNavItems} pathname={pathname} />
                  )}
                  {hasPermission('view_sales') && (
                    <CollapsibleNavSection label="Sales" icon={ChartNoAxesCombined} isActive={isSalesPage} items={salesNavItems} pathname={pathname} />
                  )}
                  {hasPermission('manage_customers') && (
                    <CollapsibleNavSection label="Customers" icon={UserIcon} isActive={isCustomerPage} items={customerNavItems} pathname={pathname} />
                  )}
                  {hasPermission('manage_purchases') && (
                    <CollapsibleNavSection label="Purchases" icon={ShoppingCart} isActive={isPurchasesPage} items={purchasesNavItems} pathname={pathname} />
                  )}
                  {hasPermission('manage_suppliers') && (
                    <CollapsibleNavSection label="Suppliers" icon={Users} isActive={isSuppliersPage} items={suppliersNavItems} pathname={pathname} />
                  )}
                </SidebarMenu>
              </SidebarGroup>
            )}

            {filteredOtherNavItems.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.1em] font-bold text-muted-foreground/80 px-4 mb-3">Management</SidebarGroupLabel>
                <SidebarMenu>
                  {filteredOtherNavItems.map(item => (
                    <SidebarMenuItem key={item.href}>
                      <Link href={item.href}>
                        <SidebarMenuButton isActive={pathname === item.href} tooltip={{ children: item.label }} className="relative gap-3 px-4 py-2.5 font-medium rounded-lg transition-all duration-200 hover:shadow-sm data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1/2 data-[active=true]:before:h-5 data-[active=true]:before:w-1 data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:rounded-r-full data-[active=true]:before:bg-primary data-[active=true]:text-primary">
                          <item.icon />
                          <span className="text-[14px]">{item.label}</span>
                        </SidebarMenuButton>
                      </Link>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="sticky bottom-0 bg-gradient-to-t from-sidebar to-sidebar/95 backdrop-blur-xl border-t border-sidebar-border mt-auto shadow-lg">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 overflow-hidden rounded-lg p-3 text-left text-sm text-sidebar-foreground outline-none ring-sidebar-ring transition-all duration-200 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:ring-2 hover:shadow-sm">
              <Avatar className="size-9 ring-2 ring-sidebar-border shadow-sm">
                <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-semibold border border-primary/20">
                  {getInitials(user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col truncate">
                <span className="text-sm font-semibold">{user.email || 'Anonymous'}</span>
                <span className="text-[11px] text-muted-foreground">View Profile</span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">My Account</p>
                <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleSignOut()}>
              <LogOut className="mr-2 h-4 w-4" /><span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

type SectionProps = {
  label: string;
  icon: any;
  isActive: boolean;
  items: { href: string; label: string }[];
  pathname: string;
};

function CollapsibleNavSection({ label, icon: Icon, isActive, items, pathname }: SectionProps) {
  return (
    <SidebarMenuItem>
      <Collapsible defaultOpen={isActive} className="group/collapsible group-data-[collapsible=icon]:items-center">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={isActive} tooltip={{ children: label }} className="relative justify-between gap-3 px-4 py-2.5 font-medium rounded-lg transition-all duration-200 hover:shadow-sm data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1/2 data-[active=true]:before:h-5 data-[active=true]:before:w-1 data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:rounded-r-full data-[active=true]:before:bg-primary data-[active=true]:text-primary">
            <div className="flex items-center gap-3">
              <Icon />
              <span className="text-[14px]">{label}</span>
            </div>
            <ChevronDown className="size-4 text-muted-foreground/60 transition-transform duration-300 group-data-[state=open]/collapsible:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="ml-5 border-l-2 border-sidebar-border/40 pl-3 my-2 space-y-1">
            {items.map(item => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuSubButton asChild isActive={pathname === item.href} className="relative text-[13px] h-9 rounded-md hover:bg-sidebar-accent/50 transition-colors duration-200 data-[active=true]:before:absolute data-[active=true]:before:-left-[13px] data-[active=true]:before:top-1/2 data-[active=true]:before:h-1.5 data-[active=true]:before:w-1.5 data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary">
                  <Link href={item.href}>{item.label}</Link>
                </SidebarMenuSubButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
