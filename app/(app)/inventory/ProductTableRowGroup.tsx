'use client';

import { useState } from 'react';
import { ChevronDown, CornerDownRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { cn, formatCurrency, formatStockQuantity } from '@/lib/utils';
import { formatUnitBreakdown } from '@/lib/unit-quantity';

import type { ProductWithChildren } from './product-list-types';
import { ProductRowActions } from './ProductRowActions';
import { getStockStatus, useStockStatus } from './use-stock-status';

export function ProductTableRowGroup({ productGroup, onSuccess, requireAdjustmentConfirmation, requireTransferConfirmation, lowStockThreshold }: { productGroup: ProductWithChildren, onSuccess?: () => void, requireAdjustmentConfirmation?: boolean, requireTransferConfirmation?: boolean, lowStockThreshold?: number }) {
  const [isExpanded, setIsExpanded] = useState(productGroup.defaultExpanded ?? false);
  const hasChildren = productGroup.children && productGroup.children.length > 0;
  // Packaging lives in selling units: with more than one, stock reads as a mix
  // ("5 Case + 12 Piece") and the row expands to show each unit's own figures.
  const sellingUnits = productGroup.sellingUnits ?? [];
  const hasUnitBreakdown = productGroup.type !== 'service' && sellingUnits.length > 1;
  const isExpandable = hasChildren || hasUnitBreakdown;

  const displayStock = productGroup.stock;
  const { badgeVariant, badgeTextFull: badgeText } = useStockStatus(
    displayStock,
    productGroup.reorderPoint,
    productGroup.type,
    lowStockThreshold,
  );

  return (
    <>
      <TableRow className={cn(isExpandable && isExpanded ? "border-b-0" : "")}>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            {isExpandable && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
              </Button>
            )}
            {!isExpandable && <div className="w-6" />}
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
        <TableCell className="font-mono text-xs">
          {productGroup.sellingUnits?.find((su) => su.isBase)?.barcode || productGroup.barcode || '-'}
        </TableCell>
        <TableCell>
          {hasUnitBreakdown ? (
            <span className="font-medium">{formatUnitBreakdown(displayStock, sellingUnits)}</span>
          ) : (
            <>
              <span className="font-medium">{formatStockQuantity(displayStock, productGroup.unitOfMeasure)}</span> <span className="text-muted-foreground text-xs">{productGroup.unitOfMeasure}</span>
            </>
          )}
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
      {isExpanded && hasUnitBreakdown && [...sellingUnits].sort((a, b) => a.factor - b.factor).map((unit) => (
        <TableRow key={unit.id} className="bg-muted/30" data-testid="selling-unit-row">
          <TableCell className="pl-8">
            <div className="flex items-center gap-2 text-sm">
              <CornerDownRight className="h-4 w-4 text-muted-foreground" />
              {unit.name}
              <span className="text-xs text-muted-foreground">
                {unit.isBase ? 'base unit' : `×${unit.factor}`}
              </span>
            </div>
          </TableCell>
          <TableCell className="font-mono text-xs">{unit.barcode || '-'}</TableCell>
          <TableCell className="text-sm">
            <span className="font-medium">{parseFloat((displayStock / unit.factor).toFixed(2))}</span>{' '}
            <span className="text-muted-foreground text-xs">{unit.name} equiv.</span>
          </TableCell>
          <TableCell className="text-xs text-muted-foreground" colSpan={2}>
            Cost {unit.cost != null ? formatCurrency(unit.cost) : '-'} · Price {formatCurrency(unit.price)}
          </TableCell>
          <TableCell />
        </TableRow>
      ))}
      {isExpanded && hasChildren && productGroup.children!.map((child) => {
          const { badgeVariant: childBadgeVariant, badgeTextFull: childBadgeText } =
            getStockStatus(child.stock, child.reorderPoint, child.type, lowStockThreshold);

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
              <TableCell className="text-sm font-mono text-xs">
                {child.sellingUnits?.find((su) => su.isBase)?.barcode || child.barcode || '-'}
              </TableCell>
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
