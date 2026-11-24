'use client';

import { useEffect } from 'react';
import { getApiUrl } from '@/lib/api-config';
import { applyColorTheme, COLOR_THEME_EVENT } from '@/lib/color-themes';

// Theme changes are rare, so this is deliberately lazy: on mount, when the
// window regains focus, and on a slow timer for an Electron till that stays
// focused all shift. Each check is one single-row SELECT.
const RECHECK_INTERVAL_MS = 2 * 60 * 1000;
const FOCUS_THROTTLE_MS = 15 * 1000;

/**
 * Keeps <html data-color-theme> in step with the store-wide theme saved in the
 * database. Mounted once in ClientLayout, so it covers every page — back office,
 * POS, customer display, price-check kiosk and login alike.
 *
 * The first paint already uses the cached theme (see COLOR_THEME_BOOT_SCRIPT in
 * app/layout.tsx); this only corrects it when another machine changed it.
 */
export function ColorThemeSync() {
  useEffect(() => {
    let cancelled = false;
    let lastFetch = 0;

    const load = () => {
      lastFetch = Date.now();
      fetch(getApiUrl('/app-theme'), { cache: 'no-store' })
        .then(r => r.json())
        .then(result => {
          // On failure keep whatever is showing — never snap back to blue
          // because the database blipped.
          if (!cancelled && result?.success) applyColorTheme(result.theme);
        })
        .catch(() => {});
    };

    const loadIfStale = () => {
      if (Date.now() - lastFetch >= FOCUS_THROTTLE_MS) load();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadIfStale();
    };
    const onLocalChange = (e: Event) => {
      applyColorTheme((e as CustomEvent).detail);
    };

    load();
    const timer = setInterval(load, RECHECK_INTERVAL_MS);
    window.addEventListener('focus', loadIfStale);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(COLOR_THEME_EVENT, onLocalChange);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', loadIfStale);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(COLOR_THEME_EVENT, onLocalChange);
    };
  }, []);

  return null;
}
