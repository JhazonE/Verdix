'use client';

import { useMemo, useState } from 'react';
import {
  ColumnDef, SortingState, VisibilityState,
  getCoreRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { formatAmount } from './use-details-utils';
import { BackofficeBadge } from '@/components/sales-source';

function SortBtn({ column, label }: { column: any; label: string }) {
  return (
    <Button
      variant="ghost" size="sm"
      className="h-8 -ml-3 text-primary-foreground hover:text-primary-foreground hover:bg-primary/80 font-semibold"
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
    >
      {label}
      {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> :
       column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 h-3 w-3" /> :
       <ArrowUpDown className="ml-1 h-3 w-3 opacity-60" />}
    </Button>
  );
}

type TableParams = {
  filteredSales: any[];
  totalPages: number;
  expandedRows: Set<string>;
};

export function useDetailsTable({ filteredSales, totalPages, expandedRows }: TableParams) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const columns = useMemo<ColumnDef<any>[]>(() => [
    {
      id: 'expand',
      enableSorting: false,
      enableHiding: false,
      header: () => null,
      cell: ({ row }) => {
        const rowId = row.original.posTransactionId || row.original.id;
        return expandedRows.has(rowId)
          ? <ChevronUp className="h-4 w-4 text-primary" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />;
      },
    },
    {
      accessorKey: 'siNumber',
      header: ({ column }) => <SortBtn column={column} label="SI No." />,
      cell: ({ row }) => {
        const siNo = row.original.siNumber ? String(row.original.siNumber).padStart(6, '0') : (row.original.orderNumber ? String(row.original.orderNumber).padStart(6, '0') : '-');
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="font-medium text-primary">{siNo}</span>
            <BackofficeBadge source={row.original.transactionSource} />
          </span>
        );
      },
    },
    {
      accessorKey: 'date',
      header: ({ column }) => <SortBtn column={column} label="Date" />,
      cell: ({ row }) => {
        const d = row.original.date;
        return <span className="whitespace-nowrap">{d ? format(new Date(d), 'MMM dd, yyyy HH:mm') : '-'}</span>;
      },
    },
    {
      accessorKey: 'terminal',
      header: ({ column }) => <SortBtn column={column} label="Terminal" />,
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.terminal || '-'}</span>,
    },
    {
      accessorKey: 'cashier',
      header: ({ column }) => <SortBtn column={column} label="Cashier" />,
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.cashier || '-'}</span>,
    },
    {
      id: 'customer',
      accessorFn: (row) => row.customer?.name || 'Walk-in',
      header: ({ column }) => <SortBtn column={column} label="Customer" />,
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.customer?.name || 'Walk-in'}</span>,
    },
    {
      accessorKey: 'total',
      header: ({ column }) => <div className="text-right"><SortBtn column={column} label="Amount" /></div>,
      cell: ({ row }) => <div className="text-right font-medium whitespace-nowrap">{formatAmount(row.original.total)}</div>,
    },
    {
      accessorKey: 'paymentMethod',
      header: ({ column }) => <SortBtn column={column} label="Payment" />,
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.paymentMethod || '-'}</span>,
    },
    {
      id: 'status',
      accessorFn: (row) => row.paymentStatus || row.status,
      header: ({ column }) => <SortBtn column={column} label="Status" />,
      cell: ({ row }) => {
        const isPaid = row.original.paymentStatus === 'completed' || row.original.status === 'Paid';
        return <Badge variant={isPaid ? 'default' : 'destructive'} className="font-normal">{isPaid ? 'Paid' : row.original.status || 'Pending'}</Badge>;
      },
    },
  ], [expandedRows]);

  const table = useReactTable({
    data: filteredSales,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  return { table, columns };
}
