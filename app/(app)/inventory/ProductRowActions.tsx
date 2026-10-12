'use client';

import { useState } from 'react';
import { CalendarClock, ClipboardCheck, MoreHorizontal, MoveHorizontal, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Product } from '@/lib/types';
import { isService } from '@/lib/product-type';

import { SetExpirationDialog } from './set-expiration-dialog/SetExpirationDialog';
import { StockAdjustmentDialog } from './stock-adjustment-dialog/StockAdjustmentDialog';
import { StockTransferDialog } from './stock-transfer-dialog/StockTransferDialog';

export function ProductRowActions({ product, onSuccess, requireAdjustmentConfirmation, requireTransferConfirmation }: { product: Product, onSuccess?: () => void, requireAdjustmentConfirmation?: boolean, requireTransferConfirmation?: boolean }) {
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [isCountOpen, setIsCountOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isExpirationOpen, setIsExpirationOpen] = useState(false);

  // Services have no stock to adjust, count, or transfer — the API rejects
  // these anyway (defense in depth), but hide the dead-end menu items too.
  const isProductService = isService(product);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
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
              {/* Deliberately NOT gated on is_perishable. The flag follows the
                  date: saving one marks the product perishable (see
                  lib/batch-expiration-write). Gating here instead made the
                  action unreachable for virtually the whole catalogue, and
                  forced a trip through Edit Product just to type a date. */}
              <DropdownMenuItem onSelect={() => setIsExpirationOpen(true)}>
                <CalendarClock className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Set Expiration</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
          <SetExpirationDialog
            product={product}
            onSuccess={onSuccess}
            open={isExpirationOpen}
            onOpenChange={setIsExpirationOpen}
          />
        </>
      )}
    </>
  );
}
