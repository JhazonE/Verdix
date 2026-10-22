import { ArrowRight, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn, formatCurrency, formatQuantity } from '@/lib/utils';

import {
  FROZEN_CELL,
  FROZEN_EDGE,
  FROZEN_QTY_LEFT,
  FROZEN_TYPE_LEFT,
  parseUnitCost,
  typeConfig,
  type AdjustmentItem,
} from './constants';

export function AdjustmentTableRow({
  adj,
  onUpdate,
  onRemove,
  showExpirationColumn,
}: {
  adj: AdjustmentItem;
  onUpdate: (productId: string, updates: Partial<AdjustmentItem>) => void;
  onRemove: (productId: string) => void;
  showExpirationColumn?: boolean;
}) {
  const newStock = adj.type === 'remove' ? adj.product.stock - adj.quantity : adj.product.stock + adj.quantity;
  const isNegative = newStock < 0;
  const cfg = typeConfig[adj.type];
  const Icon = cfg.icon;
  const lineCost = parseUnitCost(adj.unitCost);

  return (
    <TableRow className="group hover:bg-accent/50 transition-colors border-b border-border last:border-0">
      {/* Product / Type / Quantity are frozen so the row always says WHAT is
          being adjusted while the costs and the delete button scroll into view.
          A sticky cell is transparent by default and would let the scrolling
          columns slide visibly underneath it, so each frozen cell paints its
          own background — including the hover and striping states, which must
          match the rest of the row or the freeze looks like a seam. */}
      <TableCell className={cn(FROZEN_CELL, "left-0 py-4 pl-6 w-[240px] max-w-[240px]")}>
        <div className="flex flex-col gap-0.5">
          {/* A long product name would otherwise widen this column and push
              Note off the row; let it wrap instead. */}
          <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors break-words">
            {adj.product.name}
          </span>
          {/* min-w-0 + truncate: a long barcode or warehouse name is
              unbreakable text, which would otherwise widen this cell past the
              240px the sticky offsets are calculated from and leave the frozen
              columns misaligned once the user scrolls. */}
          <div className="flex items-center gap-2 mt-0.5 min-w-0">
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground truncate">
              {adj.product.sellingUnits?.find((su) => su.isBase)?.barcode || adj.product.barcode}
            </span>
            {adj.product.warehouseName && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 min-w-0">
                <WarehouseIcon className="h-3 w-3 shrink-0" /><span className="truncate">{adj.product.warehouseName}</span>
              </span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(FROZEN_CELL, FROZEN_TYPE_LEFT, "py-4 w-[110px] max-w-[110px]")}>
        <Badge variant="outline" className={cn("gap-1 font-semibold text-xs px-2.5 py-1 rounded-lg border", cfg.color)}>
          <Icon className="h-3 w-3" />
          {cfg.label}
        </Badge>
      </TableCell>
      <TableCell className={cn(FROZEN_CELL, FROZEN_QTY_LEFT, FROZEN_EDGE, "py-4 w-[150px] max-w-[150px]")}>
        <div className="flex items-center gap-1.5">
          <button
            className="w-7 h-7 rounded-md bg-muted hover:bg-muted/70 flex items-center justify-center text-foreground font-bold transition-colors"
            onClick={() => onUpdate(adj.product.id, { quantity: Math.max(1, adj.quantity - 1) })}
          >−</button>
          <Input
            type="number"
            min="1"
            className="h-8 w-14 text-center font-bold text-sm px-1"
            value={adj.quantity}
            onChange={e => onUpdate(adj.product.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
          />
          <button
            className="w-7 h-7 rounded-md bg-muted hover:bg-muted/70 flex items-center justify-center text-foreground font-bold transition-colors"
            onClick={() => onUpdate(adj.product.id, { quantity: adj.quantity + 1 })}
          >+</button>
        </div>
        <p className="text-[10px] text-muted-foreground uppercase mt-1 pl-1">{adj.product.unitOfMeasure}</p>
      </TableCell>
      <TableCell className="py-4">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">₱</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            className="h-8 w-[104px] pl-6 pr-2 text-right font-mono text-sm tabular-nums"
            value={adj.unitCost ?? ''}
            onChange={e => onUpdate(adj.product.id, { unitCost: e.target.value })}
          />
        </div>
        {/* The line's worth, so an entry error shows up as an implausible
            total rather than only as a per-unit figure. */}
        <p className="text-[10px] text-muted-foreground mt-1 pl-1 tabular-nums">
          {lineCost === null ? '—' : formatCurrency(lineCost * adj.quantity)}
        </p>
      </TableCell>
      <TableCell className="py-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-muted-foreground tabular-nums">{formatQuantity(adj.product.stock)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          <span className={cn("text-sm font-bold tabular-nums", isNegative ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
            {formatQuantity(newStock)}
          </span>
          {isNegative && (
            <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4 ml-0.5">Low</Badge>
          )}
        </div>
      </TableCell>
      {showExpirationColumn && (
        <TableCell className="py-4">
          {adj.product.isPerishable ? (
            <Input
              type="date"
              className="h-8 text-xs w-full"
              value={adj.expirationDate || ''}
              onChange={e => onUpdate(adj.product.id, { expirationDate: e.target.value })}
            />
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          )}
        </TableCell>
      )}
      <TableCell className="py-4 pr-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors rounded-lg"
          onClick={() => onRemove(adj.product.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
