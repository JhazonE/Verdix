'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Product } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatQuantity } from '@/lib/utils';

const peso = (n: number) =>
    `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Batch = {
    id: string;
    po_reference?: string | null;
    purchase_order_id?: string | null;
    received_date?: string | null;
    quantity_in: number | string;
    quantity_remaining: number | string;
    unit_cost: number | string;
    source_type?: string | null;
    expirationDate?: string | null;
};

type Movement = {
    id: string;
    movementType: string;
    quantityChange: number;
    newStock: number;
    referenceId?: string;
    referenceType?: string;
    notes?: string;
    createdAt?: string;
};

const MOVEMENT_FILTERS = [
    { key: 'all', label: 'All', types: [] as string[] },
    { key: 'sale', label: 'Sales', types: ['sale', 'out'] },
    { key: 'purchase', label: 'Receipts', types: ['purchase', 'in'] },
    { key: 'adjustment', label: 'Adjustments', types: ['adjustment', 'return'] },
    { key: 'transfer', label: 'Transfers', types: ['transfer'] },
];

function movementBadge(type: string) {
    switch (type) {
        case 'purchase':
        case 'in':
            return { label: 'Received', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' };
        case 'sale':
        case 'out':
            return { label: 'Sale', className: 'bg-muted text-foreground border-border' };
        case 'transfer':
            return { label: 'Transfer', className: 'bg-primary/10 text-primary border-primary/30' };
        case 'adjustment':
            return { label: 'Adjustment', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-500 border-amber-500/30' };
        case 'return':
            return { label: 'Return', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-500 border-amber-500/30' };
        case 'void':
            return { label: 'Void', className: 'bg-destructive/15 text-destructive border-destructive/30' };
        default:
            return { label: type, className: 'bg-muted text-foreground border-border' };
    }
}

const formatDate = (value?: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
};

/**
 * Batches and movements both already have endpoints — they were simply never
 * surfaced on the product itself. Batches come back newest-first from the API;
 * FIFO depletes oldest-first, so they are re-sorted here to match the order
 * stock will actually leave in.
 */
export function StockTab({ product }: { product: Product }) {
    const [filter, setFilter] = useState('all');

    const { data: batchResponse, isLoading: batchesLoading } = useQuery({
        queryKey: ['productBatches', product.id],
        queryFn: async () => {
            const response = await fetch(`/api/inventory-batches?productId=${product.id}&status=active&pageSize=25`);
            if (!response.ok) throw new Error('Failed to fetch batches');
            return response.json();
        },
    });

    const { data: movementResponse, isLoading: movementsLoading } = useQuery({
        queryKey: ['productMovements', product.id],
        queryFn: async () => {
            const response = await fetch(`/api/stock-movements?productId=${product.id}&limit=50`);
            if (!response.ok) throw new Error('Failed to fetch stock movements');
            return response.json();
        },
    });

    const batches: Batch[] = (batchResponse?.data ?? [])
        .slice()
        .sort((a: Batch, b: Batch) => {
            const left = a.received_date ? new Date(a.received_date).getTime() : 0;
            const right = b.received_date ? new Date(b.received_date).getTime() : 0;
            return left - right;
        });

    const movements: Movement[] = movementResponse?.data ?? [];
    const totalMovements = movementResponse?.pagination?.total ?? movements.length;

    const activeFilter = MOVEMENT_FILTERS.find((f) => f.key === filter) ?? MOVEMENT_FILTERS[0];
    const visibleMovements =
        activeFilter.types.length === 0
            ? movements
            : movements.filter((m) => activeFilter.types.includes(m.movementType));

    const batchQty = batches.reduce((sum, b) => sum + Number(b.quantity_remaining || 0), 0);
    const batchValue = batches.reduce(
        (sum, b) => sum + Number(b.quantity_remaining || 0) * Number(b.unit_cost || 0),
        0
    );
    const weightedAvg = batchQty > 0 ? batchValue / batchQty : null;

    return (
        <div className="space-y-5">
            {/* BATCHES */}
            <div className="overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Open batches &mdash; FIFO depletion order
                    </h3>
                    <span className="text-[11px] text-muted-foreground">
                        {batches.length} {batches.length === 1 ? 'batch' : 'batches'}
                        {weightedAvg !== null && <> &middot; weighted avg. {peso(weightedAvg)}</>}
                        {typeof product.cost === 'number' && product.cost > 0 && (
                            <> &middot; recorded cost {peso(product.cost)}</>
                        )}
                    </span>
                </div>

                {batchesLoading ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading batches&hellip;</p>
                ) : batches.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No open batches. This product is not batch-costed, so margin uses its recorded cost.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="bg-muted/20">
                                    <th scope="col" className="px-4 py-2 text-left text-[11px] font-semibold text-muted-foreground">Batch</th>
                                    <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground">Received</th>
                                    <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground">Source</th>
                                    <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground">Unit cost</th>
                                    <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground">Remaining</th>
                                    <th scope="col" className="px-4 py-2 text-left text-[11px] font-semibold text-muted-foreground">Depleted</th>
                                </tr>
                            </thead>
                            <tbody>
                                {batches.map((batch, index) => {
                                    const quantityIn = Number(batch.quantity_in || 0);
                                    const remaining = Number(batch.quantity_remaining || 0);
                                    const depleted = quantityIn > 0 ? ((quantityIn - remaining) / quantityIn) * 100 : 0;
                                    return (
                                        <tr key={batch.id} className={cn('border-t', index === 0 && 'bg-muted/20')}>
                                            <td className="px-4 py-2.5">
                                                <span className="inline-flex items-center gap-2">
                                                    {index === 0 && (
                                                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-bold text-primary">
                                                            NEXT
                                                        </Badge>
                                                    )}
                                                    <span className="font-mono text-xs">{batch.id}</span>
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-muted-foreground">{formatDate(batch.received_date)}</td>
                                            <td className="px-3 py-2.5 text-muted-foreground">
                                                {batch.po_reference || batch.source_type || '—'}
                                            </td>
                                            <td className="px-3 py-2.5 text-right">{peso(Number(batch.unit_cost || 0))}</td>
                                            <td className="px-3 py-2.5 text-right font-semibold">
                                                {formatQuantity(remaining, product.unitOfMeasure)}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <span
                                                    className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
                                                    role="img"
                                                    aria-label={`${Math.round(depleted)} percent of this batch is depleted`}
                                                >
                                                    <span
                                                        className={cn('block h-full rounded-full', index === 0 ? 'bg-primary' : 'bg-primary/50')}
                                                        style={{ width: `${Math.min(100, Math.max(0, depleted))}%` }}
                                                    />
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* MOVEMENTS */}
            <div className="overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stock movement</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {MOVEMENT_FILTERS.map((option) => (
                            <Button
                                key={option.key}
                                type="button"
                                size="sm"
                                variant={filter === option.key ? 'default' : 'outline'}
                                className="h-7 rounded-full px-3 text-xs"
                                onClick={() => setFilter(option.key)}
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                </div>

                {movementsLoading ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading movement history&hellip;</p>
                ) : visibleMovements.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                        {movements.length === 0
                            ? 'No stock movement recorded for this product yet.'
                            : 'No movement of this kind in the last 50 records.'}
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="bg-muted/20">
                                    <th scope="col" className="px-4 py-2 text-left text-[11px] font-semibold text-muted-foreground">When</th>
                                    <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground">Type</th>
                                    <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground">Reference</th>
                                    <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground">Change</th>
                                    {/* No "By" column: stock_movements has no user column, so it
                                        could only ever render an em dash. See
                                        MySqlStockMovementRepository. */}
                                    <th scope="col" className="px-4 py-2 text-right text-[11px] font-semibold text-muted-foreground">Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleMovements.map((movement) => {
                                    const badge = movementBadge(movement.movementType);
                                    const change = Number(movement.quantityChange || 0);
                                    return (
                                        <tr key={movement.id} className="border-t">
                                            <td className="px-4 py-2.5 text-muted-foreground">
                                                {movement.createdAt
                                                    ? new Date(movement.createdAt).toLocaleString(undefined, {
                                                          month: 'short',
                                                          day: 'numeric',
                                                          hour: 'numeric',
                                                          minute: '2-digit',
                                                      })
                                                    : '—'}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <Badge variant="outline" className={cn('px-2 py-0 text-[11px] font-semibold', badge.className)}>
                                                    {badge.label}
                                                </Badge>
                                            </td>
                                            <td className="px-3 py-2.5">
                                                {movement.referenceId || movement.notes || (
                                                    <span className="text-muted-foreground/60">&mdash;</span>
                                                )}
                                            </td>
                                            <td
                                                className={cn(
                                                    'px-3 py-2.5 text-right font-bold',
                                                    change > 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-foreground'
                                                )}
                                            >
                                                {change > 0 ? '+' : ''}
                                                {formatQuantity(change, product.unitOfMeasure)}
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-muted-foreground">
                                                {formatQuantity(Number(movement.newStock || 0), product.unitOfMeasure)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {movements.length > 0 && (
                    <p className="border-t bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
                        Showing {visibleMovements.length} of {totalMovements} movements
                    </p>
                )}
            </div>
        </div>
    );
}
