'use client';

import { useMemo } from 'react';
import {
  ColumnDef, SortingState, VisibilityState, PaginationState,
  getCoreRowModel, getSortedRowModel, getPaginationRowModel, useReactTable,
} from '@tanstack/react-table';
import { format } from 'date-fns';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Printer, MoreHorizontal, X, ArrowUp, ArrowDown, ArrowUpDown, Loader2 } from 'lucide-react';
import type { Sale } from '@/lib/types';
import { useUser } from '@/hooks/use-user';
import { formatAmount, getStatusInfo } from './use-invoices-utils';

function SortBtn({ column, children }: { column: any; children: React.ReactNode }) {
  return (
    <button
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      className="flex items-center gap-1 text-primary-foreground hover:bg-primary/80 px-1 py-0.5 rounded"
    >
      {children}
      {column.getIsSorted() === 'asc' ? <ArrowUp className="h-3 w-3" /> :
       column.getIsSorted() === 'desc' ? <ArrowDown className="h-3 w-3" /> :
       <ArrowUpDown className="h-3 w-3 opacity-50" />}
    </button>
  );
}

type TableParams = {
  relevantSales: Sale[];
  expandedRows: Set<string>;
  pagination: PaginationState;
  setPagination: React.Dispatch<React.SetStateAction<PaginationState>>;
  voidDialogOpen: string | null;
  setVoidDialogOpen: (id: string | null) => void;
  voidMutationPending: boolean;
  handlePrint: (sale: Sale, title?: string) => void;
};

export function useInvoicesTable({
  relevantSales, expandedRows, pagination, setPagination,
  voidDialogOpen, setVoidDialogOpen, voidMutationPending, handlePrint,
}: TableParams) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const { user } = useUser();
  const canVoid = !!user?.permissions?.includes('void_invoices');

  const columns = useMemo<ColumnDef<Sale>[]>(() => [
    {
      id: 'expand',
      header: '',
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {expandedRows.has(row.original.id) ? '▲' : '▼'}
        </span>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: 'user',
      accessorFn: (row) => row.salesPerson || 'admin',
      header: ({ column }) => <SortBtn column={column}>User</SortBtn>,
    },
    {
      id: 'customer',
      accessorFn: (row) => row.customer?.name || 'Unknown',
      header: ({ column }) => <SortBtn column={column}>Customer</SortBtn>,
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      id: 'reference',
      header: 'Reference',
      cell: ({ row }) => {
        const s = row.original;
        if (!s.reference) return s.id.substring(0, 8);
        const refNum = s.reference.toString().replace(/\D/g, '').replace(/^0+/, '') || '0';
        if (s.orderNumber) return `${refNum}|SO#${s.orderNumber}`;
        return refNum;
      },
      enableSorting: false,
    },
    {
      id: 'siNumber',
      header: 'SI No',
      cell: ({ row }) => {
        const siNo = (row.original as any).siNumber ? String((row.original as any).siNumber).padStart(6, '0') : (row.original.orderNumber ? String(row.original.orderNumber).padStart(6, '0') : '');
        return (
          <span className="text-primary font-medium">
            {siNo}
          </span>
        );
      },
      enableSorting: false,
    },
    {
      id: 'transSource',
      accessorFn: (row) => row.transactionSource || 'POS',
      header: 'Trans Ref',
      cell: ({ getValue }) => {
        const src = getValue() as string;
        return (
          <Badge variant="outline" className={src === 'Backoffice' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-orange-50 text-orange-700 border-orange-200'}>
            {src}
          </Badge>
        );
      },
      enableSorting: false,
    },
    { id: 'type', header: 'Type', cell: () => 'Sales Invoice', enableSorting: false },
    {
      id: 'invoiceDate',
      accessorFn: (row) => row.invoiceDate || row.date || '',
      header: ({ column }) => <SortBtn column={column}>Invoice Date</SortBtn>,
      cell: ({ getValue }) => { const v = getValue() as string; return v ? format(new Date(v), 'PP') : 'N/A'; },
    },
    {
      id: 'dueDate',
      accessorFn: (row) => row.dueDate || '',
      header: ({ column }) => <SortBtn column={column}>Due Date</SortBtn>,
      cell: ({ getValue }) => { const v = getValue() as string; return v ? format(new Date(v), 'PP') : 'N/A'; },
    },
    {
      id: 'total',
      accessorKey: 'total',
      header: ({ column }) => <SortBtn column={column}>Total</SortBtn>,
      cell: ({ getValue }) => <span className="text-right block font-medium">₱{formatAmount(getValue())}</span>,
    },
    {
      id: 'amountPaid',
      accessorFn: (row) => (row.status === 'Paid' ? row.total : 0),
      header: ({ column }) => <SortBtn column={column}>Amount Paid</SortBtn>,
      cell: ({ getValue }) => <span className="text-right block">₱{formatAmount(getValue())}</span>,
    },
    {
      id: 'balance',
      accessorFn: (row) => row.total - (row.status === 'Paid' ? row.total : 0),
      header: ({ column }) => <SortBtn column={column}>Balance</SortBtn>,
      cell: ({ getValue }) => <span className="text-right block">₱{formatAmount(getValue())}</span>,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: ({ column }) => <SortBtn column={column}>Status</SortBtn>,
      cell: ({ row }) => {
        const info = getStatusInfo(row.original);
        return <Badge variant={info.variant} className="whitespace-nowrap">{info.text}</Badge>;
      },
    },
    {
      id: 'actions',
      header: () => <span className="text-right block pr-2">Action</span>,
      cell: ({ row }) => {
        const sale = row.original;
        return (
          <div className="text-right" onClick={e => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handlePrint(sale, 'Sales Invoice')}>
                  <Printer className="mr-2 h-4 w-4" /> Print Invoice
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlePrint(sale, 'Delivery Note')}>
                  <Printer className="mr-2 h-4 w-4" /> Delivery Note
                </DropdownMenuItem>
                {sale.status !== 'Voided' && canVoid && (
                  <DropdownMenuItem onClick={() => setVoidDialogOpen(sale.id)} className="text-destructive focus:text-destructive">
                    <X className="mr-2 h-4 w-4" /> Void
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
  ], [expandedRows, handlePrint, setVoidDialogOpen, canVoid]);

  const table = useReactTable({
    data: relevantSales,
    columns,
    state: { sorting, columnVisibility, pagination },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return { table };
}
