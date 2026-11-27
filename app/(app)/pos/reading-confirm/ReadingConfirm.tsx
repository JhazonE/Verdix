'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, LogOut, X } from 'lucide-react';

type Props = {
  open: boolean;
  title: string;
  description: ReactNode;
  yesLabel: string;
  noLabel: string;
  onYes: () => void;
  onNo: () => void;
  /** Shows a corner "×" Cancel and is what Escape does. Omitted → Escape means No. */
  onCancel?: () => void;
  icon?: 'print' | 'close';
};

/**
 * Yes/No prompt used by the POS reading drawers (X, Z, Overall) — both the
 * "Print this reading?" question and the "Close this reading?" question.
 *
 * Rendered inline (no portal) on purpose: the readings live in Radix Sheets,
 * and a Radix Dialog portaled from inside a Sheet has been seen to trip the
 * Sheet's outside-click dismissal (see ZReadingDialog's comments).
 *
 * Keys: Y = yes, N = no, Esc = cancel (or no). They're caught in the capture
 * phase and stopped, so Escape here never also reaches the Sheet behind it.
 */
export function ReadingConfirm({ open, title, description, yesLabel, noLabel, onYes, onNo, onCancel, icon = 'print' }: Props) {
  const yesRef = useRef<HTMLButtonElement>(null);
  // Callers pass inline handlers; keep the latest in a ref so the effect below
  // runs once per open instead of re-binding (and re-focusing) every render.
  const handlersRef = useRef({ onYes, onNo, onCancel });
  handlersRef.current = { onYes, onNo, onCancel };

  useEffect(() => {
    if (!open) return;
    yesRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      let handler: (() => void) | undefined;
      if (e.key === 'Escape') handler = h.onCancel ?? h.onNo;
      else if (e.key === 'y' || e.key === 'Y') handler = h.onYes;
      else if (e.key === 'n' || e.key === 'N') handler = h.onNo;
      if (!handler) return;
      e.preventDefault();
      e.stopPropagation();
      handler();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const Icon = icon === 'close' ? LogOut : Printer;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] print:hidden" role="dialog" aria-modal="true" aria-labelledby="reading-confirm-title">
      <div className="relative w-full max-w-md rounded-xl border bg-background shadow-2xl">
        {/* Cancel lives in the corner rather than as a third footer button:
            three buttons never fit one row at this width and wrapped. */}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            title="Cancel (Esc)"
            className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="flex flex-col items-center px-6 pb-2 pt-7 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary ring-8 ring-primary/5">
            <Icon className="h-6 w-6" />
          </div>
          <h2 id="reading-confirm-title" className="mt-4 text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 p-6 pt-5">
          <Button variant="outline" className="h-11 justify-between gap-2 px-4" onClick={onNo}>
            <span className="truncate">{noLabel}</span>
            <Kbd>N</Kbd>
          </Button>
          <Button ref={yesRef} className="h-11 justify-between gap-2 px-4" onClick={onYes}>
            <span className="truncate">{yesLabel}</span>
            <Kbd inverted>Y</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children, inverted }: { children: ReactNode; inverted?: boolean }) {
  return (
    <kbd
      className={
        'hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none sm:inline-block ' +
        (inverted ? 'border-primary-foreground/30 text-primary-foreground/80' : 'border-border text-muted-foreground')
      }
    >
      {children}
    </kbd>
  );
}

/**
 * Props for a reading drawer's SheetContent that stop it closing on an
 * outside click and turn Escape into a request to close (so the caller can
 * show its "Close?" prompt) instead of an immediate close.
 */
export function guardedSheetProps(requestClose: () => void) {
  return {
    onInteractOutside: (e: Event) => e.preventDefault(),
    onEscapeKeyDown: (e: KeyboardEvent) => { e.preventDefault(); requestClose(); },
  };
}
