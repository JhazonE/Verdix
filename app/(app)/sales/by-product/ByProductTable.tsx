import { Fragment } from 'react';
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
import { flexRender, type Table as TanTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import type { ProductSalesData, TransactionData } from './by-product-types';

type Props = {
  table: TanTable<ProductSalesData>;
  isLoading: boolean;
  expandedRows: Set<string>;
  transactions: Record<string, TransactionData[]>;
  loadingTransactions: Record<string, boolean>;
  toggleRow: (productId: string) => void;
};

const NUMERIC_COLS = ['unitsSold', 'totalDiscount', 'totalRevenue', 'totalCost', 'totalProfit'];

export function ByProductTable({
  table, isLoading, expandedRows, transactions, loadingTransactions, toggleRow,
}: Props) {
  return (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center h-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading sales data...
        </div>
      ) : (
        <Table
          className="text-xs w-full"
          wrapperClassName="max-h-[530px] overflow-auto border rounded-md"
        >
          <TableHeader className="sticky top-0 z-30">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-primary hover:bg-primary border-b-0">
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'bg-primary text-primary-foreground font-semibold',
                      header.column.id === 'expand' && 'w-[50px]',
                      NUMERIC_COLS.includes(header.column.id) && 'text-right'
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row, index) => (
                <Fragment key={row.original.product.id}>
                  <TableRow
                    className={cn(
                      'cursor-pointer hover:bg-accent',
                      index % 2 === 0 ? 'bg-background' : 'bg-muted/50'
                    )}
                    onClick={() => toggleRow(row.original.product.id)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>

                  {expandedRows.has(row.original.product.id) && (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={table.getVisibleLeafColumns().length} className="p-0">
                        <div className="p-4 pl-12">
                          <h4 className="font-semibold mb-2">Transaction History</h4>
                          {loadingTransactions[row.original.product.id] ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading transactions...
                            </div>
                          ) : (
                            <div className="overflow-x-auto border rounded-md bg-background">
                              <Table className="text-xs">
                                <TableHeader>
                                  <TableRow className="bg-muted hover:bg-muted">
                                    <TableHead className="font-semibold">Date</TableHead>
                                    <TableHead className="font-semibold">Order #</TableHead>
                                    <TableHead className="font-semibold">Customer</TableHead>
                                    <TableHead className="font-semibold text-right">Qty</TableHead>
                                    <TableHead className="font-semibold text-right">Price</TableHead>
                                    <TableHead className="font-semibold text-right">Total</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {transactions[row.original.product.id]?.length > 0 ? (
                                    transactions[row.original.product.id].map((tx) => {
                                      const productItem = tx.items.find(
                                        (i: any) => i.productId === row.original.product.id
                                      );
                                      return (
                                        // Keyed by posTransactionId, not id: a
                                        // return carries the sale_id of the sale
                                        // it reverses, so both rows share `id`.
                                        <TableRow key={tx.posTransactionId ?? tx.id} className="hover:bg-muted/50 border-0">
                                          <TableCell>
                                            {format(new Date(tx.date), 'MMM dd, yyyy HH:mm')}
                                          </TableCell>
                                          <TableCell>{tx.orderNumber}</TableCell>
                                          <TableCell>{tx.customer?.name}</TableCell>
                                          <TableCell className="text-right">
                                            {productItem?.quantity || 0}
                                          </TableCell>
                                          <TableCell className="text-right">
                                            {parseFloat(productItem?.price || 0).toFixed(2)}
                                          </TableCell>
                                          <TableCell className="text-right">
                                            {parseFloat(productItem?.total || 0).toFixed(2)}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })
                                  ) : (
                                    <TableRow>
                                      <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
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
                  )}
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="text-center h-24">
                  No products found for the selected criteria.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </>
  );
}
