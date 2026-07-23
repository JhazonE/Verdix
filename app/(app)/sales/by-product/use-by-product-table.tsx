'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getApiUrl } from '@/lib/api-config';
import type { ProductSalesData, TransactionData } from './by-product-types';

type TableParams = {
  productSales: ProductSalesData[];
  totalPages: number;
  dateRange: DateRange | undefined;
  terminal: string;
};

function SortBtn({ column, children }: { column: any; children: React.ReactNode }) {
  return (
    <button
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      className="flex items-center gap-1 text-primary-foreground hover:bg-primary/80 px-1 py-0.5 rounded"
    >
      {children}
      {column.getIsSorted() === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : column.getIsSorted() === 'desc' ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      )}
    </button>
  );
}

export { SortBtn };

export function useByProductTable({ productSales, totalPages, dateRange, terminal }: TableParams) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [transactions, setTransactions] = useState<Record<string, TransactionData[]>>({});
  const [loadingTransactions, setLoadingTransactions] = useState<Record<string, boolean>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const fetchTransactionsForProduct = async (productId: string) => {
    setLoadingTransactions((prev) => ({ ...prev, [productId]: true }));
    try {
      const params = new URLSearchParams();
      params.append('productId', productId);
      if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
      if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
      if (terminal && terminal !== 'all') params.append('terminalId', terminal);
      const res = await fetch(getApiUrl(`/sales/transactions?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (result.success) {
        setTransactions((prev) => ({ ...prev, [productId]: result.data }));
      }
    } catch {
      // noop
    } finally {
      setLoadingTransactions((prev) => ({ ...prev, [productId]: false }));
    }
  };

  const toggleRow = async (productId: string) => {
    const next = new Set(expandedRows);
    if (next.has(productId)) {
      next.delete(productId);
    } else {
      next.add(productId);
      if (!transactions[productId]) {
        await fetchTransactionsForProduct(productId);
      }
    }
    setExpandedRows(next);
  };

  const columns = useMemo<ColumnDef<ProductSalesData>[]>(
    () => [
      {
        id: 'expand',
        header: '',
        cell: ({ row }) => (
          <button
            onClick={() => toggleRow(row.original.product.id)}
            className="text-muted-foreground hover:text-primary"
          >
            {expandedRows.has(row.original.product.id) ? (
              <ChevronDown className="h-4 w-4 text-primary" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: 'barcode',
        accessorFn: (row) => row.product.barcode,
        header: 'Barcode',
        enableSorting: false,
        // Barcode is nullable — services and hand-entered products often have
        // none, so fall back to a dash rather than rendering an empty cell.
        cell: ({ getValue }) => (
          <span className="font-medium">{(getValue() as string) || '—'}</span>
        ),
      },
      {
        id: 'name',
        accessorFn: (row) => row.product.name,
        header: ({ column }) => <SortBtn column={column}>Description</SortBtn>,
      },
      {
        id: 'categoryBrand',
        accessorFn: (row) => `${row.product.category} / ${row.product.brand}`,
        header: 'Category/Brand',
        enableSorting: false,
      },
      {
        id: 'unitsSold',
        accessorKey: 'unitsSold',
        header: ({ column }) => <SortBtn column={column}>Quantity</SortBtn>,
        cell: ({ getValue }) => (
          <span className="text-right block">{(getValue() as number).toLocaleString()}</span>
        ),
      },
      {
        id: 'totalDiscount',
        accessorKey: 'totalDiscount',
        header: ({ column }) => <SortBtn column={column}>Sales Discount</SortBtn>,
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span className={cn('text-right block', v > 0 && 'text-red-500')}>
              {v > 0
                ? `(${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                : '0.00'}
            </span>
          );
        },
      },
      {
        id: 'totalRevenue',
        accessorKey: 'totalRevenue',
        header: ({ column }) => <SortBtn column={column}>Sales Amount</SortBtn>,
        cell: ({ getValue }) => (
          <span className="text-right block font-bold">
            {(getValue() as number).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        ),
      },
      {
        id: 'totalCost',
        accessorKey: 'totalCost',
        header: ({ column }) => <SortBtn column={column}>Cost</SortBtn>,
        cell: ({ getValue }) => (
          <span className="text-right block">
            {(getValue() as number).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        ),
      },
      {
        id: 'totalProfit',
        accessorKey: 'totalProfit',
        header: ({ column }) => <SortBtn column={column}>Profit</SortBtn>,
        cell: ({ getValue }) => (
          <span className="text-right block font-bold text-green-600">
            {(getValue() as number).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        ),
      },
    ],
    [expandedRows]
  );

  const table = useReactTable({
    data: productSales,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  return { table, expandedRows, transactions, loadingTransactions, toggleRow };
}
