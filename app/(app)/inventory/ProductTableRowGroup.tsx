'use client';

import { useState } from 'react';
import { ChevronDown, CornerDownRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { cn, formatStockQuantity } from '@/lib/utils';

import type { ProductWithChildren } from './product-list-types';
import { ProductRowActions } from './ProductRowActions';
import { getStockStatus, useStockStatus } from './use-stock-status';

export function ProductTableRowGroup({ productGroup, onSuccess, requireAdjustmentConfirmation, requireTransferConfirmation }: { productGroup: ProductWithChildren, onSuccess?: () => void, requireAdjustmentConfirmation?: boolean, requireTransferConfirmation?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = productGroup.children && productGroup.children.length > 0;

  const displayStock = productGroup.stock;
  const { badgeVariant, badgeTextFull: badgeText } = useStockStatus(
    displayStock,
    productGroup.reorderPoint,
    productGroup.type,
  );

  return (
    <>
      <TableRow className={cn(hasChildren && isExpanded ? "border-b-0" : "")}>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            {hasChildren && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
              </Button>
            )}
            {!hasChildren && <div className="w-6" />}
            {productGroup.name}
            {hasChildren && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                Group
              </Badge>
            )}
            {productGroup.hasPendingApproval && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-500 text-amber-500 bg-amber-500/10">
                Pending
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell>{productGroup.sku}</TableCell>
        <TableCell className="font-mono text-xs">{productGroup.barcode || '-'}</TableCell>
        <TableCell>
          <span className="font-medium">{formatStockQuantity(displayStock, productGroup.unitOfMeasure)}</span> <span className="text-muted-foreground text-xs">{productGroup.unitOfMeasure}</span>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <Badge variant={badgeVariant} className="text-xs">{badgeText}</Badge>
            {productGroup.type === 'service' && (
              <Badge variant="secondary" className="text-xs">Service</Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{formatStockQuantity(productGroup.reorderPoint, productGroup.unitOfMeasure)}</TableCell>
        <TableCell className="text-right whitespace-nowrap">
          <ProductRowActions
            product={productGroup}
            onSuccess={onSuccess}
            requireAdjustmentConfirmation={requireAdjustmentConfirmation}
            requireTransferConfirmation={requireTransferConfirmation}
          />
        </TableCell>
      </TableRow>
      {isExpanded && hasChildren && productGroup.children!.map((child) => {
          const { badgeVariant: childBadgeVariant, badgeTextFull: childBadgeText } =
            getStockStatus(child.stock, child.reorderPoint, child.type);

          return (
            <TableRow key={child.id} className="bg-muted/30">
              <TableCell className="font-medium pl-8">
                <div className="flex items-center gap-2 text-sm">
                  <CornerDownRight className="h-4 w-4 text-muted-foreground" />
                  {child.name}
                  {child.hasPendingApproval && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-500 text-amber-500 bg-amber-500/10">
                      Pending
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-sm">{child.sku}</TableCell>
              <TableCell className="text-sm font-mono text-xs">{child.barcode || '-'}</TableCell>
              <TableCell className="text-sm">
                 <span className="font-medium">{formatStockQuantity(child.stock, child.unitOfMeasure)}</span> <span className="text-muted-foreground text-xs">{child.unitOfMeasure}</span>
              </TableCell>
              <TableCell>
                 <div className="flex items-center gap-1.5">
                   <Badge variant={childBadgeVariant} className="text-xs">{childBadgeText}</Badge>
                   {child.type === 'service' && (
                     <Badge variant="secondary" className="text-xs">Service</Badge>
                   )}
                 </div>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">{formatStockQuantity(child.reorderPoint, child.unitOfMeasure)}</TableCell>
              <TableCell className="text-right">
                  <ProductRowActions
                    product={child}
                    onSuccess={onSuccess}
                    requireAdjustmentConfirmation={requireAdjustmentConfirmation}
                    requireTransferConfirmation={requireTransferConfirmation}
                  />
              </TableCell>
            </TableRow>
          );
      })}
    </>
  );
}
