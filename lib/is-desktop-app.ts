/**
 * Is this page running inside the Electron desktop app, rather than a plain
 * web browser?
 *
 * `preload.js` exposes `window.electronAPI` through contextBridge, so its
 * presence is the signal the rest of the app already uses (see
 * `components/window-controls.tsx` and `lib/use-printer.ts`). This file exists
 * so the browser-POS gate has ONE definition of "browser" instead of another
 * inline check that could drift from the others.
 *
 * Returns false during SSR, where there is no window at all. Callers that gate
 * access must therefore only act once mounted on the client — treating SSR as
 * "browser" would otherwise flash a blocked screen inside the desktop app.
 */
export function isDesktopApp(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).electronAPI);
}
