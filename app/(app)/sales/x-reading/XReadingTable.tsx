'use client';

import { Table as ReactTable, ColumnDef, flexRender } from '@tanstack/react-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Columns, AlertCircle } from 'lucide-react';
import type { XReadingData } from './x-reading-preview';

interface Props {
  table: ReactTable<XReadingData>;
  columns: ColumnDef<XReadingData>[];
  isLoading: boolean;
  selectedCashier: string;
  hasQuery: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export function XReadingTable({ table, columns, isLoading, selectedCashier, hasQuery, isError, errorMessage, onRetry }: Props) {
  if (!hasQuery) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="text-muted-foreground">Loading X-readings...</div>
      </div>
    );
  }

  // A failed fetch used to fall through to the empty table below, which reads
  // as "no X-readings found" — users reported the report "not displaying"
  // with no indication anything had gone wrong. Say what failed, and offer a
  // retry, so a transient DB/network problem is recognisable as one.
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-40 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <div>
          <p className="font-medium">Could not load X-readings</p>
          <p className="text-sm text-muted-foreground max-w-md">
            {errorMessage || 'The report request failed.'}
          </p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end mb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Columns className="h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table.getAllColumns().filter(col => col.getCanHide()).map(col => (
              <DropdownMenuCheckboxItem
                key={col.id}
                className="capitalize"
                checked={col.getIsVisible()}
                onCheckedChange={val => col.toggleVisibility(!!val)}
              >
                {col.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(hg => (
            <TableRow key={hg.id}>
              {hg.headers.map(header => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map(row => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map(cell => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center h-24">
                No X-readings found for the selected {selectedCashier !== 'all' ? 'cashier' : 'date'}.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
