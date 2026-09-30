'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { calculatePurchaseCosts } from '@/lib/purchase-utils';
import { toSafeNumber } from '@/lib/utils';
import { type PurchaseOrder } from '@/lib/types';
import { type ReceivePurchaseOrderController } from './use-receive-purchase-order';
import { lineKey } from './receive-purchase-order-types';

interface ReceiveItemsTableProps {
  order: PurchaseOrder;
  controller: ReceivePurchaseOrderController;
}

export function ReceiveItemsTable({ order, controller }: ReceiveItemsTableProps) {
  const {
    quantities,
    badItems,
    expiryDates,
    allocationStrategy,
    handleQuantityChange,
    handleExpiryDateChange,
    handleBadQtyChange,
    handleBadReasonChange,
    handleBadDescriptionChange,
  } = controller;

  const calculations = calculatePurchaseCosts(
    order.items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      quantity: i.quantity,
      cost: i.cost,
      discount: i.discount || 0,
      discountType: (i.discountType as any) || 'amount',
      vatSubject: i.vatSubject,
      sellingUnitFactor: i.sellingUnitFactor,
    })),
    order.shippingFee || 0,
    12,
    allocationStrategy,
  );

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Product</TableHead>
            <TableHead className="text-right w-[80px]">Ordered</TableHead>
            <TableHead className="text-right w-[100px]">Cost</TableHead>
            <TableHead className="text-right w-[100px]">
              <div className="flex items-center justify-end gap-1">
                Landed Cost (per pc)
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    This is the per-piece inventory cost this receipt will record — it may differ from the per-unit cost shown above when this line is a non-base selling unit.
                  </TooltipContent>
                </Tooltip>
              </div>
            </TableHead>
            <TableHead className="text-right w-[100px]">Good Qty</TableHead>
            <TableHead className="w-[130px]">Expiry Date</TableHead>
            <TableHead className="text-right w-[100px]">Bad Qty</TableHead>
            <TableHead className="w-[120px]">Reason</TableHead>
            <TableHead>Issue Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.items.map((item, index) => {
            // Index-aligned, not productId-matched: `calculations.items` was built from
            // this same `order.items` array in the same order, so position is a safe,
            // unambiguous correspondence even when two lines share a productId (Piece +
            // Case). landedCostPerUnit here is already per-piece (divided by factor).
            const calculated = calculations.items[index];
            const landedCost = calculated?.landedCostPerUnit || item.cost;
            const key = lineKey(item);
            const hasUnit = item.sellingUnitName && item.sellingUnitFactor !== 1;

            return (
              <TableRow key={key}>
                <TableCell>
                  <div className="font-medium text-xs truncate max-w-[170px]" title={item.productName}>
                    {item.productName}
                    {hasUnit && (
                      <span className="ml-1 text-[10px] font-semibold text-blue-600">— {item.sellingUnitName}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right text-xs">
                  {item.quantity} {hasUnit ? item.sellingUnitName : ''}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  ₱{toSafeNumber(item.cost).toFixed(2)}
                </TableCell>
                <TableCell className="text-right text-xs font-bold text-primary">
                  ₱{toSafeNumber(landedCost).toFixed(2)}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="text-right h-8 text-xs"
                    value={quantities[key] ?? ''}
                    onChange={(e) => handleQuantityChange(key, e.target.value)}
                  />
                  {hasUnit && (
                    <span className="text-[10px] text-muted-foreground block text-right">{item.sellingUnitName}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={expiryDates[key] || ''}
                    onChange={(e) => handleExpiryDateChange(key, e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="text-right h-8 text-xs border-destructive/50 focus-visible:ring-destructive"
                    value={badItems[key]?.quantity || ''}
                    onChange={(e) => handleBadQtyChange(key, e.target.value)}
                  />
                  {hasUnit && (
                    <span className="text-[10px] text-muted-foreground block text-right">{item.sellingUnitName}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={badItems[key]?.reason || 'Damaged'}
                    onValueChange={(val) => handleBadReasonChange(key, val)}
                    disabled={!(badItems[key]?.quantity > 0)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Damaged">Damaged</SelectItem>
                      <SelectItem value="Defective">Defective</SelectItem>
                      <SelectItem value="Expired">Expired</SelectItem>
                      <SelectItem value="Wrong Item">Wrong Item</SelectItem>
                      <SelectItem value="Missing">Missing</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    placeholder="Optional notes..."
                    className="h-8 text-xs"
                    value={badItems[key]?.description || ''}
                    onChange={(e) => handleBadDescriptionChange(key, e.target.value)}
                    disabled={!(badItems[key]?.quantity > 0)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
