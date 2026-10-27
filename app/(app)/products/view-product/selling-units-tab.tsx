'use client';

import { useQuery } from '@tanstack/react-query';
import type { Product } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Info } from 'lucide-react';

const peso = (n: number) =>
    `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type PriceLevel = { id: string; name: string; is_default?: boolean | number };

/**
 * Price levels are per SELLING UNIT, so a Case can carry a different Wholesale
 * price than the Piece it is packed from. A unit with no override for a level
 * falls back to its OWN `price` column — never another unit's, never a computed
 * multiple of one — which is why a blank cell here reads as "falls back", not
 * as zero.
 *
 * A row may also carry a quantity tier in `minQuantity`. `0` is the only
 * encoding of "no tier". A tiered row competes on ANY price level once the
 * cart reaches its threshold, counted in the owning unit's own terms, so it is
 * labelled separately from an untiered (level-scoped) override.
 */
export function SellingUnitsTab({ product }: { product: Product }) {
    const { data: levelsResponse } = useQuery({
        queryKey: ['priceLevels'],
        queryFn: async () => {
            const response = await fetch('/api/price-levels');
            if (!response.ok) throw new Error('Failed to fetch price levels');
            return response.json();
        },
    });

    const levels: PriceLevel[] = Array.isArray(levelsResponse)
        ? levelsResponse
        : levelsResponse?.data ?? [];

    const units = (product.sellingUnits ?? []).slice().sort((a, b) => {
        if (a.isBase && !b.isBase) return -1;
        if (!a.isBase && b.isBase) return 1;
        return (a.factor ?? 1) - (b.factor ?? 1);
    });

    if (units.length === 0) {
        return (
            <div className="rounded-xl border border-dashed p-8 text-center">
                <p className="text-sm text-muted-foreground">
                    This product has no selling units recorded yet. Open Edit Product to add them.
                </p>
            </div>
        );
    }

    const defaultLevelId = levels.find((l) => l.is_default)?.id;

    // Every tiered override across all units, which is what a cashier actually
    // needs to see: these fire regardless of the customer's price level.
    const tiers = units.flatMap((unit) =>
        (unit.priceLevels ?? [])
            .filter((pl) => (pl.minQuantity ?? 0) > 0)
            .map((pl) => ({
                unitName: unit.name,
                unitPrice: unit.price,
                levelName: levels.find((l) => l.id === pl.levelId)?.name ?? 'Unnamed level',
                minQuantity: pl.minQuantity as number,
                price: pl.price,
            }))
    );

    const marginFor = (unit: (typeof units)[number]) => {
        if (typeof unit.cost !== 'number' || unit.cost <= 0) return null;
        if (typeof unit.price !== 'number' || unit.price <= 0) return null;
        return ((unit.price - unit.cost) / unit.price) * 100;
    };

    return (
        <div className="space-y-5">
            <div className="overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Price by unit and level
                    </h3>
                    <span className="text-[11px] text-muted-foreground">
                        Blank = falls back to that unit&rsquo;s own price
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr className="bg-muted/20">
                                <th scope="col" className="px-4 py-2 text-left text-[11px] font-semibold text-muted-foreground">
                                    Selling unit
                                </th>
                                <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground">
                                    Factor
                                </th>
                                <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground">
                                    Barcode
                                </th>
                                <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground">
                                    Cost
                                </th>
                                <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground">
                                    Price
                                </th>
                                {levels.map((level) => (
                                    <th
                                        key={level.id}
                                        scope="col"
                                        className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground"
                                    >
                                        {level.name}
                                    </th>
                                ))}
                                <th scope="col" className="px-4 py-2 text-right text-[11px] font-semibold text-muted-foreground">
                                    Margin
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {units.map((unit, index) => {
                                const margin = marginFor(unit);
                                return (
                                    <tr key={unit.id ?? index} className={cn('border-t', unit.isBase && 'bg-muted/20')}>
                                        <td className="px-4 py-2.5">
                                            <span className="inline-flex items-center gap-2">
                                                <span className="font-medium">{unit.name}</span>
                                                {unit.isBase && (
                                                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-bold">
                                                        BASE
                                                    </Badge>
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{unit.factor}</td>
                                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                                            {unit.barcode || <span className="text-muted-foreground/60">&mdash;</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">
                                            {typeof unit.cost === 'number' ? peso(unit.cost) : <span className="text-muted-foreground/60">&mdash;</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-bold">{peso(unit.price ?? 0)}</td>

                                        {levels.map((level) => {
                                            const override = (unit.priceLevels ?? []).find((pl) => pl.levelId === level.id);
                                            if (!override) {
                                                return (
                                                    <td key={level.id} className="px-3 py-2.5 text-right text-muted-foreground/60">
                                                        &mdash;
                                                    </td>
                                                );
                                            }
                                            const tier = override.minQuantity ?? 0;
                                            return (
                                                <td key={level.id} className="px-3 py-2.5 text-right">
                                                    {peso(override.price)}
                                                    {tier > 0 && (
                                                        <span className="block text-[10px] font-semibold text-amber-600 dark:text-amber-500">
                                                            {tier}+ only
                                                        </span>
                                                    )}
                                                </td>
                                            );
                                        })}

                                        <td className="px-4 py-2.5 text-right font-semibold">
                                            {margin === null ? (
                                                <span className="text-muted-foreground/60">&mdash;</span>
                                            ) : (
                                                <span className={cn(margin < 0 && 'text-destructive')}>{margin.toFixed(1)}%</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {levels.length === 0 && (
                    <p className="border-t px-4 py-2.5 text-[11px] text-muted-foreground">
                        No price levels are configured, so every unit sells at its own price.
                    </p>
                )}
            </div>

            {tiers.length > 0 && (
                <div className="rounded-xl border p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Quantity breaks in effect
                    </h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        A tiered row applies on any price level once the cart reaches its threshold, counted in that
                        unit&rsquo;s own terms.
                    </p>

                    <div className="mt-3 space-y-2">
                        {tiers.map((tier, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
                            >
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold">
                                        {tier.unitName} &mdash; buy {tier.minQuantity} or more
                                    </div>
                                    <div className="text-[11px] text-amber-700 dark:text-amber-500">
                                        {tier.levelName} tier &middot; fires for any customer
                                    </div>
                                </div>
                                <div className="whitespace-nowrap text-right">
                                    <div className="text-sm font-bold text-amber-700 dark:text-amber-500">{peso(tier.price)}</div>
                                    {tier.unitPrice > tier.price && (
                                        <div className="text-[10px] text-muted-foreground line-through">{peso(tier.unitPrice)}</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-3 flex items-start gap-2 border-t pt-3">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            The base unit&rsquo;s {defaultLevelId ? 'default-level' : 'shelf'} price stays untiered, so a bulk
                            price is never advertised as the price of one.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
