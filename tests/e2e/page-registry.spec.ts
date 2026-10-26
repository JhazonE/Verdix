import { test, expect } from '@playwright/test';
import {
  PAGE_REGISTRY,
  TOGGLEABLE_PAGES,
  DEFAULT_HIDDEN_KEYS,
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

  test('DEFAULT_HIDDEN_KEYS are all real, toggleable pages', () => {
    const toggleable = new Set(TOGGLEABLE_PAGES.map(p => p.key));
    // An unknown or protected key is silently dropped by the disabled-pages
    // route, so the module would never actually hide.
    for (const key of DEFAULT_HIDDEN_KEYS) {
      expect(toggleable.has(key)).toBe(true);
    }
  });

  test('DEFAULT_HIDDEN_KEYS hides repackaging, approvals board and workflow settings', () => {
    expect([...DEFAULT_HIDDEN_KEYS].sort()).toEqual([
      'approvals',
      'approvals_settings',
      'inventory_repackaging',
    ]);
  });
});
