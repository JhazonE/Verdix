'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Guards a dirty form against an accidental reload.
 *
 * Browsers draw their own "Reload site?" box for `beforeunload` and it cannot be
 * styled, so F5 / Ctrl+R are intercepted and answered with an in-app dialog
 * instead. `beforeunload` stays as a fallback for what cannot be intercepted
 * (closing the tab or window, the browser's reload button).
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  const [open, setOpen] = useState(false);
  const skipNativePrompt = useRef(false);

  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (skipNativePrompt.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const isReload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r');
      if (!isReload) return;
      e.preventDefault();
      setOpen(true);
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isDirty]);

  const confirmReload = useCallback(() => {
    skipNativePrompt.current = true;
    window.location.reload();
  }, []);

  return { open, setOpen, confirmReload };
}
