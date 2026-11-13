'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SALES_SOURCE_OPTIONS, type SalesSourceFilter } from '@/lib/sales-source';

/**
 * Marks a report row as a back-office sales invoice. Renders nothing for a POS
 * row: POS is the default, and a badge on every row would bury the exception.
 * Same blue as the Trans Ref badge on the Sales Invoices page.
 */
export function BackofficeBadge({ source, className }: { source?: string | null; className?: string }) {
  if (String(source ?? '').toLowerCase() !== 'backoffice') return null;
  return (
    <Badge
      variant="outline"
      className={cn('bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0 font-medium', className)}
    >
      Backoffice
    </Badge>
  );
}

/**
 * All / POS / Backoffice selector shared by the sales reports. The value is
 * sent as `?source=` and parsed server-side by parseSalesSource.
 */
export function SalesSourceFilter({
  value,
  onChange,
  className,
}: {
  value: SalesSourceFilter;
  onChange: (v: SalesSourceFilter) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Sales source"
      className={cn('inline-flex items-center rounded-md border bg-background p-0.5 text-sm', className)}
    >
      {SALES_SOURCE_OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'px-3 py-1 rounded-[5px] transition-colors',
              active ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
