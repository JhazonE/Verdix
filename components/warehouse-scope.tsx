'use client';

import { Warehouse as WarehouseIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Warehouse } from '@/lib/types';

export const ALL_WAREHOUSES = 'all';

/**
 * Which warehouse's stock the list is showing.
 *
 * This is deliberately NOT one of the filters in the Refine dialog. A
 * `products` row is warehouse-specific — the same item in STORE and BODEGA is
 * two rows (see per-warehouse-product-rows) — so the warehouse decides what
 * the Stock column MEANS, not merely which rows survive a filter. Hidden in a
 * dialog it read as "someone has filtered things away"; in the open, as a
 * labelled scope, it reads as a place you are standing.
 *
 * Counts are shown beside each name so a near-empty warehouse is legible
 * BEFORE it is picked — a thin table is then expected rather than alarming.
 * They are omitted entirely when unavailable rather than rendered as 0, since
 * a wrong count is worse than none.
 */
export function WarehouseScope({
  warehouses,
  value,
  onChange,
  counts,
  total,
  className,
}: {
  warehouses: Warehouse[];
  value: string;
  onChange: (value: string) => void;
  /** Product rows per warehouse id. Omit to render without counts. */
  counts?: Record<string, number>;
  /** Rows across every warehouse, for the "All" option. */
  total?: number;
  className?: string;
}) {
  // Retired warehouses are dropped: they hold no current stock to look at, and
  // the server's own default-warehouse query excludes them too. A warehouse
  // the user is somehow already scoped to is kept, so the control can always
  // show its own current value.
  const visible = warehouses.filter((w) => w.isActive !== false || w.id === value);

  // With one warehouse there is no scope to choose: a single-location store
  // would get a control whose only two options show the same rows.
  if (visible.length < 2) return null;

  // The main warehouse leads. `getWarehouses` orders by name, which put BODEGA
  // before STORE — so the scope people are nearly always in sat second, and the
  // control read as an alphabetical list rather than "here, then elsewhere".
  // Only the main one is promoted; the rest keep the server's ordering so the
  // list does not reshuffle as warehouses are added.
  const ordered = [...visible].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));

  const options = [
    ...ordered.map((w) => ({
      id: w.id,
      label: w.name,
      count: counts?.[w.id],
    })),
    { id: ALL_WAREHOUSES, label: 'All warehouses', count: total },
  ];

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Viewing stock in
      </span>
      <div
        role="group"
        aria-label="Warehouse scope"
        className="flex flex-wrap gap-1 rounded-xl border bg-muted/50 p-1"
      >
        {options.map((option) => {
          const isActive = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              aria-pressed={isActive}
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors',
                isActive
                  ? 'border border-primary bg-background font-semibold text-foreground shadow-sm'
                  : 'border border-transparent font-medium text-muted-foreground hover:bg-background/60',
              )}
            >
              {option.id !== ALL_WAREHOUSES && (
                <WarehouseIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{option.label}</span>
              {/* Rendered only when a count is genuinely known — `0` is a real
                  count and must still show, so this tests for undefined. */}
              {option.count !== undefined && (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
