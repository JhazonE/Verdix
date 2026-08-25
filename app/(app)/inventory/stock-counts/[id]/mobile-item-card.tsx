'use client';

import { memo, useState } from 'react';
import { ChevronDown, ChevronUp, Package, TrendingDown, TrendingUp } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn, formatCurrency, toSafeNumber } from '@/lib/utils';

// Memoized: the parent re-renders on every search keystroke (typed text is its own
// state, separate from the applied filter), and without memo every row — with its
// own conditional classNames and inputs — re-rendered on every keystroke too, which
// is what made the search box feel laggy despite filtering itself being unaffected.
export const MobileItemCard = memo(function MobileItemCard({
  item,
  isCompleted,
  onChange,
  onEnter,
}: {
  item: any;
  isCompleted: boolean;
  onChange: (id: string, value: string) => void;
  onEnter: () => void;
}) {
  const variance =
    item.counted_quantity !== null
      ? item.counted_quantity - item.snapshot_quantity
      : null;

  const [expanded, setExpanded] = useState(false);

  const isCounted = item.counted_quantity !== null;
  const hasVariance = variance !== null && variance !== 0;

  // Actual on-hand value — always shown, even when count is 0/uncounted (treated as 0).
  const actualQty = toSafeNumber(item.counted_quantity);
  const costAmount = actualQty * toSafeNumber(item.product_cost);
  const retailAmount = actualQty * toSafeNumber(item.product_retail);

  return (
    <div
      className={cn(
        'bg-card border rounded-2xl overflow-hidden transition-all duration-200',
        isCounted
          ? hasVariance
            ? variance! < 0
              ? 'border-red-300 dark:border-red-800'
              : 'border-emerald-300 dark:border-emerald-800'
            : 'border-emerald-200 dark:border-emerald-900'
          : 'border-border'
      )}
    >
      {/* Card header – always visible */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Icon */}
        <div
          className={cn(
            'flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center',
            isCounted
              ? hasVariance
                ? variance! < 0
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-emerald-100 dark:bg-emerald-900/30'
                : 'bg-emerald-100 dark:bg-emerald-900/30'
              : 'bg-muted'
          )}
        >
          <Package
            className={cn(
              'h-4 w-4',
              isCounted
                ? hasVariance
                  ? variance! < 0
                    ? 'text-red-500'
                    : 'text-emerald-500'
                  : 'text-emerald-500'
                : 'text-muted-foreground'
            )}
          />
        </div>

        {/* Name + Barcode */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm leading-tight truncate">{item.product_name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {item.product_barcode || 'No Barcode'}
          </p>
        </div>

        {/* Right side: counted qty / variance chip + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isCounted ? (
            <span
              className={cn(
                'text-xs font-bold px-2 py-0.5 rounded-full',
                hasVariance
                  ? variance! < 0
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              )}
            >
              {item.counted_quantity}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">Pending</span>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/60 pt-3 space-y-3">
          {/* Stats row */}
          <div className="grid gap-2 text-center grid-cols-3">
            <div className="bg-muted/50 rounded-xl py-2 px-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Snapshot
              </p>
              <p className="text-sm font-semibold">{item.snapshot_quantity}</p>
            </div>
            <div className="bg-muted/50 rounded-xl py-2 px-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Counted
              </p>
              <p className="text-sm font-semibold">
                {isCounted ? item.counted_quantity : '—'}
              </p>
            </div>
            <div
              className={cn(
                'rounded-xl py-2 px-1',
                !isCounted
                  ? 'bg-muted/50'
                  : (variance ?? 0) === 0
                  ? 'bg-emerald-50 dark:bg-emerald-900/20'
                  : (variance ?? 0) < 0
                  ? 'bg-red-50 dark:bg-red-900/20'
                  : 'bg-emerald-50 dark:bg-emerald-900/20'
              )}
            >
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Variance
              </p>
              {!isCounted ? (
                <p className="text-sm font-semibold text-muted-foreground">—</p>
              ) : (variance ?? 0) === 0 ? (
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  ±0
                </p>
              ) : (variance ?? 0) < 0 ? (
                <p className="flex items-center justify-center gap-0.5 text-sm font-semibold text-red-600 dark:text-red-400">
                  <TrendingDown className="h-3 w-3" />
                  {variance}
                </p>
              ) : (
                <p className="flex items-center justify-center gap-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  <TrendingUp className="h-3 w-3" />
                  +{variance}
                </p>
              )}
            </div>
          </div>

          {/* Money row — actual on-hand value + variance value (always shown) */}
          <div className="grid gap-2 text-center grid-cols-3">
            <div className="bg-muted/50 rounded-xl py-2 px-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Cost Amount
              </p>
              <p className="text-sm font-semibold">{formatCurrency(costAmount)}</p>
            </div>
            <div className="bg-muted/50 rounded-xl py-2 px-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Retail Amount
              </p>
              <p className="text-sm font-semibold">{formatCurrency(retailAmount)}</p>
            </div>
            <div
              className={cn(
                'rounded-xl py-2 px-1',
                !isCounted || (variance ?? 0) === 0
                  ? 'bg-muted/50'
                  : (variance ?? 0) < 0
                  ? 'bg-red-50 dark:bg-red-900/20'
                  : 'bg-emerald-50 dark:bg-emerald-900/20'
              )}
            >
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Variance Amount
              </p>
              <p
                className={cn(
                  'text-sm font-semibold',
                  !isCounted || (variance ?? 0) === 0
                    ? 'text-muted-foreground'
                    : (variance ?? 0) < 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                )}
              >
                {!isCounted ? '—' : formatCurrency((variance ?? 0) * toSafeNumber(item.product_cost))}
              </p>
            </div>
          </div>

          {/* Input (only when in progress) */}
          {!isCompleted && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground min-w-[80px]">
                Enter count:
              </label>
              <Input
                type="number"
                min="0"
                className="flex-1 text-center h-9 text-base font-semibold"
                value={item.counted_quantity ?? ''}
                onChange={(e) => onChange(item.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setExpanded(false);
                    onEnter();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                inputMode="numeric"
                placeholder="0"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
