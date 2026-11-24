'use client';

import { Fragment } from 'react';
import { Table as ReactTable, flexRender } from '@tanstack/react-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Sale } from './sales-types';

interface Props {
  table: ReactTable<Sale>;
  isLoading: boolean;
  expandedRows: Set<string>;
  toggleRowExpansion: (id: string) => void;
  salesCount: number;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  limit: number;
  setLimit: (l: number) => void;
  totalPages: number;
}

function renderPaginationItems(currentPage: number, totalPages: number, onPageChange: (p: number) => void) {
  const items = [];
  const maxVisible = 5;
  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i++) {
      items.push(<PaginationItem key={i}><PaginationLink isActive={currentPage === i} onClick={() => onPageChange(i)}>{i}</PaginationLink></PaginationItem>);
    }
  } else {
    items.push(<PaginationItem key={1}><PaginationLink isActive={currentPage === 1} onClick={() => onPageChange(1)}>1</PaginationLink></PaginationItem>);
    if (currentPage > 3) items.push(<PaginationItem key="ellipsis-start"><PaginationEllipsis /></PaginationItem>);
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) {
      items.push(<PaginationItem key={i}><PaginationLink isActive={currentPage === i} onClick={() => onPageChange(i)}>{i}</PaginationLink></PaginationItem>);
    }
    if (currentPage < totalPages - 2) items.push(<PaginationItem key="ellipsis-end"><PaginationEllipsis /></PaginationItem>);
    items.push(<PaginationItem key={totalPages}><PaginationLink isActive={currentPage === totalPages} onClick={() => onPageChange(totalPages)}>{totalPages}</PaginationLink></PaginationItem>);
  }
  return items;
}

export function SalesTable({ table, isLoading, expandedRows, toggleRowExpansion, salesCount, currentPage, setCurrentPage, limit, setLimit, totalPages }: Props) {
  const handlePageChange = (page: number) => { if (page >= 1 && page <= totalPages) setCurrentPage(page); };
  const formatAmount = (val: any) => Number(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <div className="border rounded-md overflow-hidden">
        <Table className="text-xs" wrapperClassName="max-h-[500px] overflow-auto">
          <TableHeader className="sticky top-0 z-20 bg-primary">
            {table.getHeaderGroups().map(hg => (
              <TableRow key={hg.id} className="bg-primary hover:bg-primary border-0">
                {hg.headers.map(header => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'text-primary-foreground font-semibold py-2 px-2 bg-primary sticky top-0',
                      header.column.id === 'expand' && 'w-8',
                      header.column.id === 'total' && 'text-right',
                      header.column.id === 'paymentStatus' && 'pr-4',
                    )}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={table.getAllColumns().length} className="h-24 text-center">
                  <div className="flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin mr-2" />Loading transactions...</div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row, index) => {
                const sale = row.original;
                const rowId = sale.posTransactionId || sale.id;
                const isExpanded = expandedRows.has(rowId);
                return (
                  <Fragment key={rowId}>
                    <TableRow
                      className={`${index % 2 === 0 ? 'bg-background' : 'bg-muted/50'} cursor-pointer hover:bg-accent`}
                      onClick={() => toggleRowExpansion(rowId)}
                    >
                      {row.getVisibleCells().map(cell => (
                        <TableCell key={cell.id} className="py-2 px-2">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${rowId}-details`} className="bg-muted/30">
                        <TableCell colSpan={row.getVisibleCells().length} className="py-3 px-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-10 gap-4 text-xs">
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Discount</span><span className="font-semibold">{formatAmount(sale.discount)}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Amount Paid</span><span className="font-semibold">{formatAmount(sale.amountPaid ?? sale.total)}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Balance</span><span className="font-semibold">{formatAmount(sale.balance)}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Cost</span><span className="font-semibold">{formatAmount(sale.cost)}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Profit</span><span className="font-semibold">{formatAmount(sale.profit)}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Vatable Sales</span><span className="font-semibold">{formatAmount(sale.vatableSales)}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">VAT Amount</span><span className="font-semibold">{formatAmount(sale.taxAmount)}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Non-Vat Sales</span><span className="font-semibold">{formatAmount(sale.nonVatSales)}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Payment Ref.</span><span className="font-semibold">{sale.paymentReference || '-'}</span></div>
                            <div className="flex flex-col"><span className="text-muted-foreground font-medium">Note</span><span className="font-semibold">{sale.notes || '-'}</span></div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={table.getAllColumns().length} className="h-24 text-center">
                  No transactions found for the selected criteria.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {!isLoading && salesCount > 0 && (
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-auto sm:mr-0 whitespace-nowrap">
            <Label htmlFor="rows-per-page" className="text-sm font-normal">Rows per page:</Label>
            <Select value={limit.toString()} onValueChange={(val) => { setLimit(Number(val)); setCurrentPage(1); }}>
              <SelectTrigger id="rows-per-page" className="h-8 w-[70px]"><SelectValue placeholder={limit.toString()} /></SelectTrigger>
              <SelectContent>
                {[5, 10, 20, 50, 100].map(v => <SelectItem key={v} value={v.toString()}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Pagination className="justify-center sm:justify-end">
            <PaginationContent>
              <PaginationItem><PaginationPrevious onClick={() => handlePageChange(currentPage - 1)} aria-disabled={currentPage === 1} className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
              {renderPaginationItems(currentPage, totalPages, handlePageChange)}
              <PaginationItem><PaginationNext onClick={() => handlePageChange(currentPage + 1)} aria-disabled={currentPage === totalPages} className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </>
  );
}
