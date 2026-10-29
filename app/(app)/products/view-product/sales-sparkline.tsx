'use client';

import { useQuery } from '@tanstack/react-query';
import type { Product } from '@/lib/types';
import { cn, formatQuantity } from '@/lib/utils';

type Point = { date: string; units: number };

/**
 * Daily units sold over the last two weeks, plus the cover estimate that
 * follows from it.
 *
 * The chart is drawn only when the product has actually sold something. A row
 * of zero-height bars would read as a real trend line sitting at the floor,
 * when what it means is that there is nothing to plot — so that case gets a
 * sentence instead.
 */
export function SalesSparkline({
    product,
    effectiveReorderPoint,
}: {
    product: Product;
    effectiveReorderPoint: number;
}) {
    const { data: response, isLoading } = useQuery({
        queryKey: ['productSalesHistory', product.id],
        queryFn: async () => {
            const res = await fetch(`/api/products/${product.id}/sales-history?days=14`);
            if (!res.ok) throw new Error('Failed to fetch sales history');
            return res.json();
        },
    });

    const series: Point[] = response?.data?.series ?? [];
    const hasSales: boolean = response?.data?.hasSales ?? false;
    const avgPerDay: number = response?.data?.avgPerDay ?? 0;

    // Prefer the measured rate over the stored avgDailySales, which is a
    // longer-run figure maintained elsewhere; fall back to it when this window
    // is empty but the product has a stored rate.
    const rate = avgPerDay > 0 ? avgPerDay : Number(product.avgDailySales) || 0;
    const daysOfCover = rate > 0 ? Math.floor(product.stock / rate) : null;
    const isLow = product.stock <= effectiveReorderPoint;

    const peak = series.reduce((max, point) => Math.max(max, point.units), 0);
    const lastIndex = series.length - 1;

    return (
        <div className="flex flex-col">
            <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Sales velocity
                </h3>
                <span className="text-[11px] text-muted-foreground">last 14 days</span>
            </div>

            <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight">{rate.toFixed(1)}</span>
                <span className="text-xs text-muted-foreground">
                    {product.unitOfMeasure?.toLowerCase() || 'units'} sold / day
                </span>
            </div>

            {daysOfCover !== null ? (
                <p className={cn('mt-1 text-xs', isLow ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    &asymp; {daysOfCover} {daysOfCover === 1 ? 'day' : 'days'} of cover left
                </p>
            ) : (
                <p className="mt-1 text-xs text-muted-foreground">No sales rate yet &mdash; cover cannot be estimated.</p>
            )}

            {isLoading ? (
                <div className="mt-4 h-14 animate-pulse rounded bg-muted" />
            ) : hasSales ? (
                <>
                    <div
                        className="mt-4 flex h-14 items-end gap-1"
                        role="img"
                        aria-label={`Daily units sold over the last ${series.length} days, peaking at ${formatQuantity(peak, product.unitOfMeasure)}`}
                    >
                        {series.map((point, index) => {
                            // A day with sales always gets a visible sliver, so a
                            // low day is distinguishable from a quiet one.
                            const height = peak > 0 ? (point.units / peak) * 100 : 0;
                            return (
                                <span
                                    key={point.date}
                                    className={cn(
                                        'flex-1 rounded-t-sm',
                                        index === lastIndex ? 'bg-primary' : 'bg-primary/35'
                                    )}
                                    style={{ height: point.units > 0 ? `${Math.max(height, 6)}%` : '2px' }}
                                />
                            );
                        })}
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                        <span>14 days ago</span>
                        <span>today</span>
                    </div>
                </>
            ) : (
                <p className="mt-4 rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                    No sales recorded in the last 14 days.
                </p>
            )}

            {product.reorderPoint !== undefined && product.reorderPoint !== null && (
                <p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
                    Reorder point is {formatQuantity(effectiveReorderPoint, product.unitOfMeasure)}.
                </p>
            )}
        </div>
    );
}
