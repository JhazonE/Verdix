import { cn } from '@/lib/utils';

export interface TotalsItem {
  label: string;
  value: string;
  /** Rendered as the large highlighted figure; use for the grand total. */
  emphasis?: boolean;
}

export function formatPeso(n: number) {
  return `₱${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Totals strip shown at the top of the transaction forms. */
export function FormTotalsBar({ items }: { items: TotalsItem[] }) {
  return (
    <div className="shrink-0 border-b bg-muted/20 px-4 py-3 flex flex-wrap items-stretch gap-3">
      {items.map((item) =>
        item.emphasis ? (
          <div
            key={item.label}
            className="ml-auto flex flex-col justify-center rounded-lg bg-primary/10 border border-primary/20 px-5 py-1.5 text-right"
          >
            <span className="text-[10px] uppercase tracking-wider font-black text-primary">{item.label}</span>
            <span className="font-mono text-2xl font-black text-primary leading-tight">{item.value}</span>
          </div>
        ) : (
          <div
            key={item.label}
            className={cn('flex flex-col justify-center rounded-lg border bg-background px-4 py-1.5 min-w-[110px]')}
          >
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{item.label}</span>
            <span className="font-mono text-sm font-bold text-foreground">{item.value}</span>
          </div>
        ),
      )}
    </div>
  );
}
