'use client';

import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { VoidRecord } from './voids-types';
import { VoidSourceBadge } from './VoidSourceBadge';
import { BackofficeBadge } from '@/components/sales-source';

export function useVoidsTable(records: VoidRecord[]) {
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columns = useMemo<ColumnDef<VoidRecord>[]>(
    () => [
      {
        id: 'select',
        header: '',
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.has(row.original.refNo)}
            onCheckedChange={() => toggleSelectRow(row.original.refNo)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: 'refNo',
        header: ({ column }) => (
          <button className="flex items-center gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
            Ref No.
            {column.getIsSorted() === 'asc' ? <ArrowUp className="h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />}
          </button>
        ),
        cell: ({ row }) => (
          <div className="font-medium text-primary leading-tight flex items-center gap-1">
            {row.original.refNo}
            <BackofficeBadge source={row.original.saleSource} />
          </div>
        ),
      },
      {
        id: 'voidedFrom',
        accessorKey: 'source',
        header: 'Voided From',
        cell: ({ row }) => <VoidSourceBadge source={row.original.source} />,
      },
      {
        accessorKey: 'transDate',
        header: ({ column }) => (
          <button className="flex items-center gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
            Date
            {column.getIsSorted() === 'asc' ? <ArrowUp className="h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />}
          </button>
        ),
        cell: ({ row }) => row.original.transDate ? format(new Date(row.original.transDate), 'MM/dd/yy') : '-',
      },
      {
        accessorKey: 'customer',
        header: 'Customer',
        cell: ({ row }) => (
          <span className="max-w-[100px] truncate block" title={row.original.customer}>{row.original.customer}</span>
        ),
      },
      {
        accessorKey: 'cashier',
        header: 'Cashier',
        cell: ({ row }) => row.original.cashier || '-',
      },
      {
        id: 'voidInfo',
        accessorKey: 'voidDate',
        header: 'Void Info',
        cell: ({ row }) => (
          <div className="leading-tight">
            <div>{row.original.voidDate ? format(new Date(row.original.voidDate), 'MM/dd/yy') : '-'}</div>
            <div className="text-[10px] text-muted-foreground">{row.original.voidedBy || '-'}</div>
          </div>
        ),
      },
      {
        accessorKey: 'salesAmount',
        header: ({ column }) => (
          <button className="flex items-center gap-1 justify-end w-full" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
            Amount
            {column.getIsSorted() === 'asc' ? <ArrowUp className="h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />}
          </button>
        ),
        cell: ({ row }) => <span className="text-right block font-mono">{row.original.salesAmount.toFixed(2)}</span>,
      },
      {
        accessorKey: 'cost',
        header: 'Cost',
        cell: ({ row }) => <span className="text-right block font-mono text-muted-foreground">{row.original.cost.toFixed(2)}</span>,
      },
      {
        accessorKey: 'profit',
        header: ({ column }) => (
          <button className="flex items-center gap-1 justify-end w-full" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
            Profit
            {column.getIsSorted() === 'asc' ? <ArrowUp className="h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />}
          </button>
        ),
        cell: ({ row }) => (
          <span className={cn('text-right block font-mono', row.original.profit >= 0 ? 'text-green-600' : 'text-red-600')}>
            {row.original.profit.toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: 'vatableSales',
        header: 'Vatable',
        cell: ({ row }) => <span className="text-right block font-mono">{row.original.vatableSales.toFixed(2)}</span>,
      },
      {
        accessorKey: 'vatAmount',
        header: 'VAT',
        cell: ({ row }) => <span className="text-right block font-mono">{row.original.vatAmount.toFixed(2)}</span>,
      },
      {
        accessorKey: 'note',
        header: 'Note',
        cell: ({ row }) => (
          <span className="max-w-[80px] truncate block text-muted-foreground" title={row.original.note || ''}>
            {row.original.note || '-'}
          </span>
        ),
      },
    ],
    [selectedIds]
  );

  const table = useReactTable({
    data: records,
    columns,
    state: { sorting, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  return {
    table,
    columns,
    selectedRow, setSelectedRow,
    viewMode, setViewMode,
    globalFilter, setGlobalFilter,
    selectedIds,
  };
}
