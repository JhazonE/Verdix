'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { getApiUrl } from '@/lib/api-config';

type TransactionItem = {
  productId: string;
  quantity: number;
  /** Per selling unit, to sit beside `cost` on the same footing. */
  price: number;
  /** Line total for this item — net of any line discount. */
  total: number;
  /**
   * Cost per SELLING unit, NOT per line: the API resolves it through
   * lib/cost-of-sale so a case is never costed as a bottle. Multiply by
   * `quantity` before comparing it against `total`.
   */
  cost: number;
};

type Transaction = {
  /**
   * The sale ID. NOT unique across rows: a return carries the sale_id of the
   * sale it reverses, so a sale and its return share this value.
   */
  id: string;
  /** Unique per transaction row — a sale and its return differ here. */
  posTransactionId: string;
  orderNumber: string;
  /** BIR sales invoice number. Nullable on historical rows. */
  siNumber: string | null;
  date: string;
  customer: { name: string } | null;
  items: TransactionItem[];
};

type Props = {
  productId: string;
  /** yyyy-MM-dd; omitted when the caller has no date filter. */
  startDate?: string;
  endDate?: string;
  /** Pass only when a terminal filter is active; 'all' is treated as unset. */
  terminalId?: string;
  /** Columns in the parent table, so the detail row spans the full width. */
  colSpan: number;
};

const money = (n: number) =>
  n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The expanded detail row under a product in a sales-by-product table: every
 * transaction that sold this product in range, with the cost and profit of
 * each line. The Total Cost and Profit columns sum to the Cost and Profit
 * shown on the product row above, which is the point of showing them.
 */
export function ProductTransactionHistory({
  productId, startDate, endDate, terminalId, colSpan,
}: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.append('productId', productId);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        if (terminalId && terminalId !== 'all') params.append('terminalId', terminalId);

        const res = await fetch(getApiUrl(`/sales/transactions?${params.toString()}`));
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const result = await res.json();
        if (cancelled) return;
        // A 200 carrying success:false is how this API reports its own errors;
        // falling through would read as "this product has no transactions".
        if (!result.success) throw new Error(result.error || 'Could not load transactions.');
        setTransactions(Array.isArray(result.data) ? result.data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load transactions.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [productId, startDate, endDate, terminalId]);

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="p-0">
        <div className="p-4 pl-12">
          <h4 className="font-semibold mb-2 text-xs">Transaction History</h4>

          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading transactions...
            </div>
          ) : error ? (
            <div className="text-xs text-red-600 py-2">{error}</div>
          ) : (
            <div className="overflow-x-auto border rounded-md bg-background">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="font-semibold">Date</TableHead>
                    <TableHead className="font-semibold">Order # / SI No.</TableHead>
                    <TableHead className="font-semibold">Customer</TableHead>
                    <TableHead className="font-semibold text-right">Qty</TableHead>
                    <TableHead className="font-semibold text-right">Price</TableHead>
                    <TableHead className="font-semibold text-right">Cost Price</TableHead>
                    <TableHead className="font-semibold text-right">Total</TableHead>
                    <TableHead className="font-semibold text-right">Total Cost</TableHead>
                    <TableHead className="font-semibold text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length > 0 ? (
                    transactions.map((tx) => {
                      const item = tx.items?.find((i) => i.productId === productId);
                      // Cost arrives per selling unit, which is what Cost Price
                      // shows beside Price. Scaling it by quantity gives Total
                      // Cost, so these columns sum to the product row above.
                      const qty = Number(item?.quantity) || 0;
                      const unitPrice = Number(item?.price) || 0;
                      const unitCost = Number(item?.cost) || 0;
                      const lineTotal = Number(item?.total) || 0;
                      const lineCost = unitCost * qty;
                      // Discount is already deducted from `total`; subtracting
                      // it again would double-count it against the product
                      // row's own Sales Discount figure.
                      const lineProfit = lineTotal - lineCost;

                      return (
                        // Keyed by posTransactionId, not id: a return carries
                        // the sale_id of the sale it reverses, so both rows
                        // would otherwise share a key.
                        <TableRow key={tx.posTransactionId ?? tx.id} className="hover:bg-muted/50 border-0">
                          <TableCell>{format(new Date(tx.date), 'MMM dd, yyyy HH:mm')}</TableCell>
                          {/* Both numbers, not one: an SI number can repeat
                              across orders, so the order number is what
                              identifies the row. */}
                          <TableCell>
                            {tx.orderNumber}
                            {tx.siNumber ? (
                              <span className="text-muted-foreground"> / {tx.siNumber}</span>
                            ) : null}
                          </TableCell>
                          <TableCell>{tx.customer?.name || '—'}</TableCell>
                          <TableCell className="text-right">{qty}</TableCell>
                          <TableCell className="text-right">{money(unitPrice)}</TableCell>
                          <TableCell className="text-right">{money(unitCost)}</TableCell>
                          <TableCell className="text-right">{money(lineTotal)}</TableCell>
                          <TableCell className="text-right">{money(lineCost)}</TableCell>
                          <TableCell
                            className={cn(
                              'text-right font-medium',
                              lineProfit < 0 ? 'text-red-600' : 'text-green-600'
                            )}
                          >
                            {money(lineProfit)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-4">
                        No transaction details available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
