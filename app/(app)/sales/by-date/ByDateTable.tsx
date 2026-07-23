import { Fragment } from 'react';
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
import type { SalesData } from './by-date-types';

type Props = {
  table: TanTable<SalesData>;
  isLoading: boolean;
  expandedRows: Set<string>;
  transactionsByDate: Record<string, any[]>;
  loadingTransactions: Record<string, boolean>;
  toggleRowExpansion: (date: string) => void;
  formatDate: (dateString: string) => string;
  formatCurrency: (val: number) => string;
};

const NUMERIC_COLS = [
  'totalDiscount', 'totalRevenue', 'vatableSales', 'vatAmount',
  'vatExemptSales', 'zeroRatedSales', 'nonVatSales', 'cost', 'profit',
];

export function ByDateTable({
  table,
  isLoading,
  expandedRows,
  transactionsByDate,
  loadingTransactions,
  toggleRowExpansion,
  formatDate,
  formatCurrency,
}: Props) {
  return (
    <Table
      className="text-xs whitespace-nowrap w-full"
      wrapperClassName="min-h-[450px] max-h-[600px] overflow-auto border rounded-md"
    >
      <TableHeader className="sticky top-0 z-40">
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="bg-primary hover:bg-primary border-none">
            {hg.headers.map((header) => (
              <TableHead
                key={header.id}
                className={cn(
                  'text-primary-foreground font-semibold h-9 py-2 bg-primary border-none',
                  header.column.id === 'expand' && 'w-8',
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
        {isLoading ? (
          <TableRow>
            <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center">
              <div className="flex justify-center items-center">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading data...
              </div>
            </TableCell>
          </TableRow>
        ) : table.getRowModel().rows.length > 0 ? (
          table.getRowModel().rows.map((row, index) => (
            <Fragment key={row.original.date}>
              <TableRow
                className={cn(
                  'cursor-pointer hover:bg-muted/50',
                  index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                )}
                onClick={() => toggleRowExpansion(row.original.date)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2 px-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>

              {expandedRows.has(row.original.date) && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="p-4">
                    {loadingTransactions[row.original.date] ? (
                      <div className="flex justify-center items-center h-20">
                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                        Loading transactions...
                      </div>
                    ) : transactionsByDate[row.original.date]?.length > 0 ? (
                      <div className="border rounded-md bg-background">
                        <Table className="text-xs">
                          <TableHeader>
                            <TableRow className="bg-muted hover:bg-muted">
                              <TableHead className="h-8 py-1">SI No.</TableHead>
                              <TableHead className="h-8 py-1">Cashier</TableHead>
                              <TableHead className="h-8 py-1">Method</TableHead>
                              <TableHead className="h-8 py-1 text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {transactionsByDate[row.original.date].map((tx: any) => (
                              // Keyed by posTransactionId, not id: `id` is the
                              // sale_id, and a return carries the sale_id of the
                              // sale it reverses, so both rows share it.
                              <TableRow key={tx.posTransactionId ?? tx.id} className="hover:bg-muted/50">
                                <TableCell className="py-1">{tx.siNumber ? String(tx.siNumber).padStart(6, '0') : (tx.orderNumber ? String(tx.orderNumber).padStart(6, '0') : '-')}</TableCell>
                                <TableCell className="py-1">{tx.cashier}</TableCell>
                                <TableCell className="py-1">{tx.paymentMethod}</TableCell>
                                <TableCell className="py-1 text-right">
                                  {formatCurrency(tx.total)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-20 text-muted-foreground bg-background/50 rounded border border-dashed">
                        <span>No detailed transactions found for {formatDate(row.original.date)}.</span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center">
              No sales data found for the selected criteria.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
