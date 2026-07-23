'use client';

import { useState } from 'react';
import { ClipboardCheck, MoreHorizontal, MoveHorizontal, Pencil } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, formatStockQuantity } from '@/lib/utils';
import type { Product } from '@/lib/types';
import { isService } from '@/lib/product-type';

import { StockAdjustmentDialog } from './stock-adjustment-dialog/StockAdjustmentDialog';
import { StockTransferDialog } from './stock-transfer-dialog/StockTransferDialog';
import { useStockStatus } from './use-stock-status';

export function ProductCard({ product, hasChildren = false, onSuccess, requireAdjustmentConfirmation, requireTransferConfirmation }: { product: Product, hasChildren?: boolean, onSuccess?: () => void, requireAdjustmentConfirmation?: boolean, requireTransferConfirmation?: boolean }) {
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [isCountOpen, setIsCountOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  // Services have no stock to adjust, count, or transfer — the API rejects
  // these anyway (defense in depth), but hide the dead-end menu items too.
  const isProductService = isService(product);

  const displayStock = product.stock;

  const { badgeVariant, badgeTextFull: badgeText } = useStockStatus(
    displayStock,
    product.reorderPoint,
    product.type,
  );

  return (
    <Card className="relative h-full min-h-[220px] flex flex-col shadow-sm hover:shadow-md transition-all duration-300">
      <CardContent className="p-4 flex-1 flex flex-col">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <h3 className="font-medium text-lg flex items-center gap-2 pr-8">
              {product.name}
              {hasChildren && (
                <Badge variant="outline" className="text-xs px-2 py-0.5 whitespace-nowrap">
                  Group
                </Badge>
              )}
            </h3>
            <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
            {product.barcode && (
              <p className="text-sm text-muted-foreground font-mono">BC: {product.barcode}</p>
            )}
          </div>
          <div className={cn("flex items-center gap-2", hasChildren && "mr-10")}>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!isProductService && (
                  <>
                    <DropdownMenuItem onSelect={() => setIsAdjustOpen(true)}>
                      <Pencil className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Adjust Stock</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIsCountOpen(true)}>
                      <ClipboardCheck className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Physical Count</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIsTransferOpen(true)}>
                      <MoveHorizontal className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Transfer Stock</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {!isProductService && (
          <>
            <StockAdjustmentDialog
              product={product}
              onSuccess={onSuccess}
              requireConfirmation={requireAdjustmentConfirmation}
              open={isAdjustOpen}
              onOpenChange={setIsAdjustOpen}
            />
            <StockAdjustmentDialog
              product={product}
              defaultReason="Physical Count"
              onSuccess={onSuccess}
              requireConfirmation={requireAdjustmentConfirmation}
              open={isCountOpen}
              onOpenChange={setIsCountOpen}
            />
            <StockTransferDialog
              product={product}
              onSuccess={onSuccess}
              requireConfirmation={requireTransferConfirmation}
              open={isTransferOpen}
              onOpenChange={setIsTransferOpen}
            />
          </>
        )}

        <div className="mt-auto pt-4 flex flex-wrap items-center gap-4 border-t border-muted/30 text-xs sm:text-sm">
          <span className="text-sm">
            <span className="font-medium">{formatStockQuantity(displayStock, product.unitOfMeasure)}</span> {product.unitOfMeasure}
          </span>
          <Badge variant={badgeVariant} className="text-xs">{badgeText}</Badge>
          {product.type === 'service' && (
            <Badge variant="secondary" className="text-xs">Service</Badge>
          )}
          {product.hasPendingApproval && (
            <Badge variant="outline" className="text-xs border-amber-500 text-amber-500 bg-amber-500/10">
              Pending Approval
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            Reorder at: {formatStockQuantity(product.reorderPoint, product.unitOfMeasure)}
          </span>
          {product.conversionFactors && product.conversionFactors.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">Conversion Factors:</span>
              {product.conversionFactors.map((cf, index) => (
                <Badge key={index} variant="outline" className="text-xs">
                  {cf.unit} ×{cf.factor}
                </Badge>
              ))}
            </>
          )}
          {(!product.conversionFactors || product.conversionFactors.length === 0) && (
            <>
              <span className="text-sm text-muted-foreground">Conversion Factor:</span>
              <Badge variant="outline" className="text-xs">
                ×{product.conversionFactor || 1}
              </Badge>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
