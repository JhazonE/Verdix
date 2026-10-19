'use client';

import { useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { usePriceCheck } from './use-price-check';

/**
 * Self-service price-checker kiosk.
 *
 * Designed for a customer standing in front of an unattended terminal, so
 * every choice here follows from that:
 *
 * - The price is enormous, because it is read at arm's length or further.
 * - The input is held focused at all times, because a barcode scanner types
 *   and sends Enter — the customer should never have to click anything.
 * - The screen clears itself after 10 seconds, because a stale price left on
 *   display is a wrong price for whoever walks up next.
 * - There is no logout, no nav and no cart. The account behind this screen can
 *   reach nothing else (see `use-app-layout.ts`), and the screen gives it no
 *   way to try.
 *
 * Nothing from `product.stock`, `product.cost` or supplier fields is rendered.
 * The products API includes cost in its payload; the kiosk must not surface it.
 */

const IDLE_CLEAR_MS = 10_000;

export function PriceCheckScreen() {
  const { searchTerm, setSearchTerm, result, candidates, notFound, loading, select, clear } =
    usePriceCheck();

  const inputRef = useRef<HTMLInputElement>(null);

  // The scanner is the primary input device, so the field must never lose
  // focus — not after a result renders, not after the idle timer clears it.
  useEffect(() => {
    inputRef.current?.focus();
  }, [result, searchTerm]);

  // Return to idle so the terminal is always ready for the next customer.
  // Reset by each keystroke and by each new result.
  useEffect(() => {
    if (!result && !notFound) return;
    const timer = setTimeout(() => {
      clear();
      inputRef.current?.focus();
    }, IDLE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [result, notFound, searchTerm, clear]);

  const showPickList = !result && !notFound && searchTerm.trim().length > 0 && candidates.length > 1;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Search / scan field */}
      <div className="shrink-0 border-b border-slate-800 p-5">
        <div className="relative mx-auto max-w-3xl">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-500" />
          <input
            ref={inputRef}
            data-testid="kiosk-search"
            autoFocus
            autoComplete="off"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="I-scan ang barcode o i-type ang pangalan…"
            aria-label="Scan a barcode or type a product name"
            className="w-full rounded-2xl border-2 border-slate-700 bg-slate-900 py-5 pl-16 pr-6 text-2xl text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Result / idle / not-found */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center">
        {result ? (
          <div className="flex w-full max-w-4xl flex-col items-center gap-6">
            <h1
              data-testid="kiosk-product-name"
              className="text-4xl font-bold leading-tight text-slate-100 sm:text-5xl"
            >
              {result.product.name}
            </h1>

            <div className="w-full rounded-3xl border-2 border-emerald-500/20 bg-emerald-500/5 py-12">
              <div className="mb-2 text-sm font-bold uppercase tracking-[0.2em] text-emerald-400/70">
                Presyo
              </div>
              <div
                data-testid="kiosk-price"
                className="text-7xl font-black tracking-tighter text-emerald-400 sm:text-8xl"
              >
                ₱
                {result.price.toLocaleString('en-PH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              {result.unitName && (
                <div className="mt-3 text-xl text-slate-400">matag {result.unitName}</div>
              )}
            </div>

            {result.barcode && (
              <div className="font-mono text-sm text-slate-500">{result.barcode}</div>
            )}
          </div>
        ) : notFound ? (
          <div data-testid="kiosk-not-found" className="flex flex-col items-center gap-3">
            <p className="text-3xl font-bold text-amber-400">Wala nakit-an</p>
            <p className="text-lg text-slate-400">
              Walay produkto niini nga barcode. Palihog sulayi pag-usab.
            </p>
            <p className="text-sm text-slate-500">No product found — please try again.</p>
          </div>
        ) : showPickList ? (
          <div className="w-full max-w-3xl">
            <p className="mb-4 text-lg text-slate-400">Pilia ang produkto:</p>
            <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {candidates.slice(0, 8).map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => select(product.id)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-4 text-left text-xl text-slate-100 hover:border-emerald-500 hover:bg-slate-800"
                  >
                    {product.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : loading && searchTerm.trim() ? (
          <p className="text-2xl text-slate-500">Nangita…</p>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Search className="h-20 w-20 text-slate-700" />
            <p className="text-4xl font-bold text-slate-200 sm:text-5xl">I-scan ang barcode</p>
            <p className="text-xl text-slate-500">Scan a barcode to see the price</p>
          </div>
        )}
      </div>
    </div>
  );
}
