import type { Product } from '@/lib/types';
import { cn, formatQuantity } from '@/lib/utils';

const peso = (n: number) =>
    `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Tile({
    label,
    value,
    hint,
    valueClassName,
    hintClassName,
}: {
    label: string;
    value: React.ReactNode;
    hint: React.ReactNode;
    valueClassName?: string;
    hintClassName?: string;
}) {
    return (
        <div className="bg-card px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={cn('mt-1 text-2xl font-bold tracking-tight', valueClassName)}>{value}</div>
            <div className={cn('mt-0.5 text-[11px] text-muted-foreground', hintClassName)}>{hint}</div>
        </div>
    );
}

/**
 * The four numbers that answer "is this product OK?" without scrolling.
 *
 * Margin and stock value come from `products.cost` — NOT from batch costing.
 * Only ~66% of products have inventory_batches rows, while 98.6% have a
 * recorded cost, so a batch-derived figure would blank out for hundreds of
 * products that have a perfectly good cost. The batch-level weighted average
 * belongs on the Stock tab, where the batch table backs it up.
 *
 * A missing cost renders as an em dash, never as a zero margin: `NULL` cost
 * means nobody recorded one, which is a different fact from "sells at cost".
 */
export function GlanceStrip({
    product,
    effectiveReorderPoint,
}: {
    product: Product;
    effectiveReorderPoint: number;
}) {
    const hasCost = typeof product.cost === 'number' && product.cost > 0;
    const hasPrice = typeof product.price === 'number' && product.price > 0;
    const isLow = product.stock <= effectiveReorderPoint;

    const margin = hasCost && hasPrice ? ((product.price - (product.cost as number)) / product.price) * 100 : null;
    const stockValue = hasCost ? product.stock * (product.cost as number) : null;
    const belowBy = Math.max(0, effectiveReorderPoint - product.stock);

    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
            <Tile
                label="On hand"
                value={
                    <span className={cn(isLow && 'text-destructive')}>
                        {formatQuantity(product.stock, product.unitOfMeasure)}
                        <span className="ml-1.5 text-sm font-normal text-muted-foreground">{product.unitOfMeasure}</span>
                    </span>
                }
                hint={
                    isLow && belowBy > 0
                        ? `${formatQuantity(belowBy, product.unitOfMeasure)} below reorder point`
                        : `Reorder at ${formatQuantity(effectiveReorderPoint, product.unitOfMeasure)}`
                }
                hintClassName={isLow && belowBy > 0 ? 'font-medium text-destructive' : undefined}
            />

            <Tile
                label="Retail price"
                value={hasPrice ? peso(product.price) : <span className="text-muted-foreground">&mdash;</span>}
                hint={hasPrice ? `per ${product.unitOfMeasure.toLowerCase()}` : 'No price set'}
            />

            <Tile
                label="Margin"
                value={
                    margin === null ? (
                        <span className="text-muted-foreground">&mdash;</span>
                    ) : (
                        `${margin.toFixed(1)}%`
                    )
                }
                hint={
                    margin === null
                        ? 'No cost recorded'
                        : `${peso(product.price - (product.cost as number))} over ${peso(product.cost as number)} cost`
                }
                valueClassName={margin !== null && margin < 0 ? 'text-destructive' : undefined}
                hintClassName={margin === null ? 'font-medium text-amber-600 dark:text-amber-500' : undefined}
            />

            <Tile
                label="Stock value"
                value={
                    stockValue === null ? (
                        <span className="text-muted-foreground">&mdash;</span>
                    ) : (
                        peso(stockValue)
                    )
                }
                hint={
                    stockValue === null
                        ? 'Needs a cost to value'
                        : `${formatQuantity(product.stock, product.unitOfMeasure)} × ${peso(product.cost as number)} recorded cost`
                }
            />
        </div>
    );
}
