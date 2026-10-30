'use client';

import { Table as ReactTable, ColumnDef, flexRender } from '@tanstack/react-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import type { ZReadingData } from './z-reading-preview';

interface Props {
  table: ReactTable<ZReadingData>;
  columns: ColumnDef<ZReadingData>[];
  isLoading: boolean;
  hasQuery: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export function ZReadingTable({ table, columns, isLoading, hasQuery, isError, errorMessage, onRetry }: Props) {
  if (!hasQuery) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="text-muted-foreground">Loading Z-readings...</div>
      </div>
    );
  }

  // Z-readings are BIR filing documents, so "the report is empty" and "the
  // report failed to load" must never look the same — an operator who cannot
  // tell them apart may conclude there were no sales to file.
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-40 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <div>
          <p className="font-medium">Could not load Z-readings</p>
          <p className="text-sm text-muted-foreground max-w-md">
            {errorMessage || 'The report request failed.'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            This is a loading failure, not a report showing zero sales.
          </p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
        )}
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden">
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
                No Z-readings found for the selected date and terminal.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
