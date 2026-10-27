'use client';

import { Warehouse as WarehouseIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/types';
import { isService } from '@/lib/product-type';

/**
 * Which warehouse a product row's stock sits in.
 *
 * A product row IS warehouse-specific — the same item in two warehouses is two
 * rows (see per-warehouse-product-rows) — so without this the list showed two
 * identical names with different stock and no way to tell them apart. Services
 * are not stocked anywhere, so they get nothing rather than a misleading blank.
 */
export function WarehouseLabel({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  if (isService(product)) return null;

  const name = product.warehouseName?.trim();

  if (!name) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        Unassigned
      </span>
    );
  }

  return (
    <Badge variant="outline" className={cn('gap-1 text-xs font-normal', className)}>
      <WarehouseIcon className="h-3 w-3 text-muted-foreground" />
      {name}
    </Badge>
  );
}
