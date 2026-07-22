import { ArrowRight, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatQuantity } from '@/lib/utils';

import { typeConfig, type AdjustmentItem } from './constants';

export function AdjustmentMobileCard({
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

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* Card Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-border">
        <div className="flex-1 min-w-0 pr-3">
          <p className="font-semibold text-sm text-foreground leading-snug">{adj.product.name}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{adj.product.sku}</span>
            <Badge variant="outline" className={cn("text-[10px] font-semibold gap-1 h-4 px-1.5 border", cfg.color)}>
              <Icon className="h-2.5 w-2.5" />{cfg.label}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 shrink-0 rounded-xl"
          onClick={() => onRemove(adj.product.id)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Card Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Quantity + Impact Row */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Quantity</p>
            <div className="flex items-center gap-2">
              <button
                className="w-8 h-8 rounded-xl bg-muted hover:bg-muted/70 flex items-center justify-center text-foreground font-bold text-lg transition-colors"
                onClick={() => onUpdate(adj.product.id, { quantity: Math.max(1, adj.quantity - 1) })}
              >−</button>
              <Input
                type="number"
                min="1"
                className="h-8 w-16 text-center font-bold text-sm px-1"
                value={adj.quantity}
                onChange={e => onUpdate(adj.product.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
              />
              <button
                className="w-8 h-8 rounded-xl bg-muted hover:bg-muted/70 flex items-center justify-center text-foreground font-bold text-lg transition-colors"
                onClick={() => onUpdate(adj.product.id, { quantity: adj.quantity + 1 })}
              >+</button>
              <span className="text-[10px] text-muted-foreground uppercase font-bold">{adj.product.unitOfMeasure}</span>
            </div>
          </div>

          {/* Stock Impact */}
          <div className="shrink-0 flex items-center gap-1.5 bg-muted/40 rounded-xl px-3 py-2 border border-border">
            <span className="text-sm font-mono text-muted-foreground">{formatQuantity(adj.product.stock)}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
            <span className={cn("text-sm font-bold", isNegative ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>{formatQuantity(newStock)}</span>
          </div>
        </div>

        {/* Note */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Note (optional)</p>
          <Input
            placeholder="Reason for this item..."
            className="h-8 text-xs"
            value={adj.reason}
            onChange={e => onUpdate(adj.product.id, { reason: e.target.value })}
          />
        </div>

        {showExpirationColumn && adj.product.isPerishable && (
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-muted-foreground font-semibold">Expiry (Optional)</label>
            <Input
              type="date"
              className="h-8 text-xs w-full"
              value={adj.expirationDate || ''}
              onChange={e => onUpdate(adj.product.id, { expirationDate: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
