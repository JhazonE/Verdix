'use client';

import { useMemo } from 'react';
import {
  ColumnDef, SortingState, VisibilityState,
  getCoreRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { UseMutationResult } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  MoreHorizontal, FileText, Truck, Edit, Ban,
  ClipboardList, FileCheck2, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Sale } from '@/lib/types';
import type { OrderDialogMode } from './order-details/order-details-dialog';

function getStatusVariant(status: string) {
  switch (status) {
    case 'Invoiced': return 'default';
    case 'Delivered': return 'outline';
    case 'Pending': return 'secondary';
    case 'Cancelled':
    case 'Returned': return 'destructive';
    default: return 'secondary';
  }
}

type Props = {
  sales: Sale[];
  sorting: SortingState;
  setSorting: (s: SortingState | ((prev: SortingState) => SortingState)) => void;
  columnVisibility: VisibilityState;
  setColumnVisibility: (v: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => void;
  totalPages: number;
  onViewDetails: (sale: Sale, mode: OrderDialogMode) => void;
  onEdit: (sale: Sale) => void;
  onDelete: (id: string) => void;
  onMakeInvoice: (sale: Sale) => void;
  makeDeliveryMutation: UseMutationResult<any, Error, Sale, unknown>;
  makeInvoiceMutation: UseMutationResult<any, Error, string, unknown>;
};

export function useOrdersTable({
  sales, sorting, setSorting, columnVisibility, setColumnVisibility,
  totalPages, onViewDetails, onEdit, onDelete, onMakeInvoice, makeDeliveryMutation, makeInvoiceMutation,
}: Props) {
  const columns = useMemo<ColumnDef<Sale>[]>(() => [
    {
      accessorKey: 'salesPerson',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Sales Person
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 h-3 w-3" /> : <ArrowUpDown className="ml-1 h-3 w-3 opacity-60" />}
        </Button>
      ),
      cell: ({ row }) => <span className="font-medium text-xs text-muted-foreground">{row.original.salesPerson || 'N/A'}</span>,
    },
    {
      id: 'customer',
      accessorFn: (row) => row.customer?.name,
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Customer
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 h-3 w-3" /> : <ArrowUpDown className="ml-1 h-3 w-3 opacity-60" />}
        </Button>
      ),
      cell: ({ row }) => <span className="font-medium">{row.original.customer.name}</span>,
    },
    {
      accessorKey: 'reference',
      header: 'Reference',
      cell: ({ row }) => <span className="text-xs">{row.original.reference || '-'}</span>,
    },
    {
      id: 'orderDate',
      accessorFn: (row) => row.orderDate || row.date,
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Order Date
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 h-3 w-3" /> : <ArrowUpDown className="ml-1 h-3 w-3 opacity-60" />}
        </Button>
      ),
      cell: ({ row }) => { const d = row.original.orderDate || row.original.date; return d ? format(new Date(d), 'PP') : 'N/A'; },
    },
    {
      accessorKey: 'deliveryDate',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Delivery Date
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 h-3 w-3" /> : <ArrowUpDown className="ml-1 h-3 w-3 opacity-60" />}
        </Button>
      ),
      cell: ({ row }) => { const d = row.original.deliveryDate; return d ? format(new Date(d), 'PP') : '-'; },
    },
    {
      accessorKey: 'total',
      header: ({ column }) => (
        <div className="text-right">
          <Button variant="ghost" size="sm" className="-mr-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
            Total
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 h-3 w-3" /> : <ArrowUpDown className="ml-1 h-3 w-3 opacity-60" />}
          </Button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="text-right font-medium">{row.original.formattedTotal || `₱${row.original.total.toFixed(2)}`}</div>
      ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <div className="text-center">
          <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
            Status
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 h-3 w-3" /> : <ArrowUpDown className="ml-1 h-3 w-3 opacity-60" />}
          </Button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="text-center">
          <Badge variant={getStatusVariant(row.original.status) as any} className="my-[-4px] mx-[-8px] py-1">
            {row.original.status}
          </Badge>
        </div>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      enableHiding: false,
      header: () => <div className="text-right non-printable" />,
      cell: ({ row }) => {
        const sale = row.original;
        const isPending = sale.status === 'Pending';
        const isDelivered = sale.status === 'Delivered';
        const isInvoiced = sale.status === 'Invoiced';
        return (
          <div className="text-right non-printable">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onViewDetails(sale, 'order')}>
                  <FileText className="mr-2 h-4 w-4" /> Order Detail
                </DropdownMenuItem>

                {/* Step 1: deliver a pending order (deducts stock) */}
                {isPending && (
                  <DropdownMenuItem onClick={() => makeDeliveryMutation.mutate(sale)}>
                    <Truck className="mr-2 h-4 w-4" /> Make Delivery
                  </DropdownMenuItem>
                )}

                {/* Step 2: once delivered/invoiced, a delivery note is available */}
                {(isDelivered || isInvoiced) && (
                  <DropdownMenuItem onClick={() => onViewDetails(sale, 'delivery-note')}>
                    <ClipboardList className="mr-2 h-4 w-4" /> Delivery Note
                  </DropdownMenuItem>
                )}

                {/* Step 3: invoice a delivered order, exactly once */}
                {isDelivered && !sale.hasInvoice && (
                  <DropdownMenuItem onClick={() => onMakeInvoice(sale)}>
                    <FileCheck2 className="mr-2 h-4 w-4" /> Make Invoice
                  </DropdownMenuItem>
                )}

                {/* Edit / cancel only while still pending */}
                {isPending && (
                  <>
                    <DropdownMenuItem onClick={() => onEdit(sale)}>
                      <Edit className="mr-2 h-4 w-4" /> Edit Order
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(sale.id)}>
                      <Ban className="mr-2 h-4 w-4" /> Cancel Order
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ], [makeDeliveryMutation, makeInvoiceMutation, onViewDetails, onEdit, onDelete, onMakeInvoice]);

  const table = useReactTable({
    data: sales,
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
