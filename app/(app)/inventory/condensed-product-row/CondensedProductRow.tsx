'use client';

import { Badge } from '@/components/ui/badge';
import { cn, formatStockQuantity } from '@/lib/utils';
import type { Product } from '@/lib/types';

import { ProductRowActions } from '../ProductRowActions';
import { useStockStatus } from '../use-stock-status';

export function CondensedProductRow({ product, isLast = false, onSuccess, requireAdjustmentConfirmation, requireTransferConfirmation }: { product: Product, isLast?: boolean, onSuccess?: () => void, requireAdjustmentConfirmation?: boolean, requireTransferConfirmation?: boolean }) {
  const displayStock = product.stock;
  const { badgeVariant, badgeTextShort } = useStockStatus(product.stock, product.reorderPoint, product.type);

  return (
    <div className="relative flex items-center gap-3 pl-10 py-1.5 pr-2 hover:bg-muted/30 transition-colors rounded-lg group mx-1">
      <div className={cn(
        "absolute left-5 top-0 w-px bg-muted",
        isLast ? "h-1/2" : "h-full"
      )} />
      <div className="absolute left-5 top-1/2 w-3 h-px bg-muted" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-xs truncate" title={product.name}>{product.name}</span>
          {product.hasPendingApproval && (
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-[9px] text-muted-foreground truncate uppercase font-mono">
          SKU: {product.sku} {product.barcode && `| BC: ${product.barcode}`}
        </p>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="text-right">
          <div className="text-xs font-bold leading-none">{formatStockQuantity(displayStock, product.unitOfMeasure)} <span className="text-[9px] font-normal text-muted-foreground">{product.unitOfMeasure}</span></div>
          <Badge variant={badgeVariant} className="text-[8px] px-1 py-0 h-3.5 mt-0.5 uppercase tracking-tighter">{badgeTextShort}</Badge>
          {product.type === 'service' && (
            <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 mt-0.5 uppercase tracking-tighter">Service</Badge>
          )}
        </div>

        <ProductRowActions
           product={product}
           onSuccess={onSuccess}
           requireAdjustmentConfirmation={requireAdjustmentConfirmation}
           requireTransferConfirmation={requireTransferConfirmation}
        />
      </div>
    </div>
  );
}
