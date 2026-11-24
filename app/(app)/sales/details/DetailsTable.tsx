'use client';

import { Fragment } from 'react';
import { Table as TableInstance, flexRender } from '@tanstack/react-table';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { formatAmount } from './use-details-utils';

type Props = {
  table: TableInstance<any>;
  isLoading: boolean;
  expandedRows: Set<string>;
  onToggleRow: (id: string) => void;
};

function ExpandedDetail({ sale }: { sale: any }) {
  const items: any[] = sale.items || [];
  const siNo = sale.siNumber ? String(sale.siNumber).padStart(6, '0') : (sale.orderNumber ? String(sale.orderNumber).padStart(6, '0') : '-');

  return (
    <div className="p-4 bg-muted/30 border-t space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        {[
          ['SI No.', siNo],
          ['Date', sale.date ? format(new Date(sale.date), 'PPpp') : '-'],
          ['Terminal', sale.terminal || '-'],
          ['Cashier', sale.cashier || '-'],
          ['Customer', sale.customer?.name || 'Walk-in'],
          ['Payment', sale.paymentMethod || '-'],
          ['Amount Paid', formatAmount(sale.amountPaid ?? sale.total)],
          ['Balance', formatAmount(sale.balance)],
          ['Notes', sale.notes || '-'],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-medium">{value}</p>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div className="rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Disc.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell>{item.productName || '-'}</TableCell>
                  <TableCell className="text-right">{formatAmount(item.cost)}</TableCell>
                  <TableCell className="text-right">{formatAmount(item.price)}</TableCell>
                  <TableCell className="text-right">{item.quantity ?? '-'}</TableCell>
                  <TableCell className="text-right">{formatAmount(item.discount)}</TableCell>
                  <TableCell className="text-right font-medium">{formatAmount(item.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function DetailsTable({ table, isLoading, expandedRows, onToggleRow }: Props) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(hg => (
            <TableRow key={hg.id} className="[&>th]:bg-primary [&>th]:text-primary-foreground [&>th]:font-semibold hover:bg-primary">
              {hg.headers.map(header => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={table.getAllColumns().length} className="h-32 text-center">
                <div className="flex justify-center items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-muted-foreground">Loading...</span>
                </div>
              </TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={table.getAllColumns().length} className="h-32 text-center text-muted-foreground">
                No results found.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map(row => {
              const rowId = row.original.posTransactionId || row.original.id;
              const isExpanded = expandedRows.has(rowId);
              return (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onToggleRow(rowId)}
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={row.getVisibleCells().length} className="p-0">
                        <ExpandedDetail sale={row.original} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
