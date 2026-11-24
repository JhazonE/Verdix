'use client';

import { useEffect } from 'react';
import { getApiUrl } from '@/lib/api-config';
import { applyColorTheme, isColorPreviewActive } from '@/lib/color-themes';

// Colour changes are rare, so this is deliberately lazy: on mount, when the
// window regains focus, and on a slow timer for an Electron till that stays
// focused all shift. Each check is one single-row SELECT.
const RECHECK_INTERVAL_MS = 2 * 60 * 1000;
const FOCUS_THROTTLE_MS = 15 * 1000;

/**
 * Keeps the document's brand colour in step with the one saved in the
 * database. Mounted once in ClientLayout, so it covers every page — back office,
 * POS, customer display, price-check kiosk and login alike.
 *
 * The first paint already uses the cached colour (see COLOR_THEME_BOOT_SCRIPT
 * in app/layout.tsx); this only corrects it when another machine changed it.
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
          // because the database blipped. Never override a live preview.
          if (cancelled || !result?.success || isColorPreviewActive()) return;
          applyColorTheme(result.color);
        })
        .catch(() => {});
    };

    const loadIfStale = () => {
      if (Date.now() - lastFetch >= FOCUS_THROTTLE_MS) load();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadIfStale();
    };

    load();
    const timer = setInterval(load, RECHECK_INTERVAL_MS);
    window.addEventListener('focus', loadIfStale);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', loadIfStale);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
