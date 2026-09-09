'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { calculatePurchaseCosts } from '@/lib/purchase-utils';
import { formatQuantity } from '@/lib/utils';
import { type PurchaseOrder } from '@/lib/types';
import { type Product } from '@/lib/types';

interface PoItemsTableProps {
  order: PurchaseOrder;
  products: Product[];
}

export function PoItemsTable({ order, products }: PoItemsTableProps) {
  return (
    // Borders and the sticky header background come from theme tokens in the
    // shared Table primitive, which go dark-on-dark against this white paper
    // sheet. Pin them to fixed zinc values for both themes.
    <div className="border border-zinc-300 rounded-md overflow-hidden [&_th]:bg-zinc-100 [&_tr]:border-zinc-200">
      <Table>
        <TableHeader className="bg-zinc-100">
          <TableRow>
            <TableHead className="font-bold text-zinc-900">Product Description</TableHead>
            <TableHead className="text-center font-bold text-zinc-900 w-[100px]">Remaining QTY</TableHead>
            <TableHead className="text-right font-bold text-zinc-900 w-[120px]">Base Cost</TableHead>
            <TableHead className="text-right font-bold text-zinc-900 w-[100px]">Qty</TableHead>
            <TableHead className="text-right font-bold text-zinc-800 w-[120px] italic">Landed Cost</TableHead>
            <TableHead className="text-right font-bold text-zinc-900 w-[120px]">Total</TableHead>
            <TableHead className="text-right font-bold text-zinc-900 w-[120px] bg-primary/10">Qty Recv</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.items.map((item, index) => {
            const product = products.find((p) => p.id === item.productId);
            const currentStock = product ? product.stock : (item.currentStock || 0);
            const results = calculatePurchaseCosts(order.items as any, order.shippingFee || 0);
            const landedCost = results.items[index]?.landedCostPerUnit || 0;

            return (
              <TableRow key={index} className="hover:bg-zinc-50 border-zinc-300">
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm text-zinc-900">{item.productName}</span>
                    <div className="flex items-center gap-2 text-xs text-zinc-700">
                      <span className="font-mono font-bold">{item.barcode || '-'}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center text-zinc-900 font-bold">
                  <span className={currentStock <= 0 ? 'text-destructive font-black' : ''}>
                    {formatQuantity(currentStock)}
                  </span>
                </TableCell>
                <TableCell className="text-right text-zinc-900 font-bold">
                  ₱{item.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right text-zinc-900 font-bold">
                  {formatQuantity(item.quantity)} <span className="text-xs text-zinc-700">pc</span>
                </TableCell>
                <TableCell className="text-right italic text-zinc-800 bg-zinc-100/50 font-mono text-xs font-bold border-l border-zinc-200">
                  ₱{landedCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right font-black text-zinc-950">
                  ₱{(item.cost * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right bg-primary/10 font-black text-zinc-950">
                  {order.status === 'Received' || order.status === 'Paid'
                    ? item.quantity
                    : order.status === 'Approved'
                    ? '0'
                    : '-'}
                </TableCell>
              </TableRow>
            );
          })}
          {/* Minimum Rows Filler */}
          {Array.from({ length: Math.max(0, 5 - order.items.length) }).map((_, i) => (
            <TableRow key={`empty-${i}`} className="hover:bg-transparent">
              <TableCell colSpan={6} className="h-12" />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
