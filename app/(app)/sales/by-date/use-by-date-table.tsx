'use client';

import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { SalesData } from './by-date-types';

type TableParams = {
  filteredSalesData: SalesData[];
  totalPages: number;
  formatDate: (dateString: string) => string;
  formatCurrency: (val: number) => string;
  terminal: string;
  interval: string;
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

export function useByDateTable({ filteredSalesData, totalPages, formatDate, formatCurrency, terminal, interval }: TableParams) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [transactionsByDate, setTransactionsByDate] = useState<Record<string, any[]>>({});
  const [loadingTransactions, setLoadingTransactions] = useState<Record<string, boolean>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const fetchTransactionsForDate = async (dateStr: string) => {
    if (transactionsByDate[dateStr]) return;
    setLoadingTransactions((prev) => ({ ...prev, [dateStr]: true }));
    try {
      const { format } = await import('date-fns');
      const formattedDate = format(new Date(dateStr), 'yyyy-MM-dd');
      const res = await fetch(`/api/sales/transactions?startDate=${formattedDate}&endDate=${formattedDate}`);
      const result = await res.json();
      if (result.success) {
        setTransactionsByDate((prev) => ({ ...prev, [dateStr]: result.data }));
      }
    } catch {
      // noop
    } finally {
      setLoadingTransactions((prev) => ({ ...prev, [dateStr]: false }));
    }
  };

  const toggleRowExpansion = (date: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
        fetchTransactionsForDate(date);
      }
      return next;
    });
  };

  const columns = useMemo<ColumnDef<SalesData>[]>(
    () => [
      {
        id: 'expand',
        header: '',
        cell: ({ row }) => (
          <button
            onClick={() => toggleRowExpansion(row.original.date)}
            className="text-muted-foreground hover:text-primary"
          >
            {expandedRows.has(row.original.date) ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: 'date',
        accessorKey: 'date',
        header: ({ column }) => <SortBtn column={column}>Date</SortBtn>,
        cell: ({ getValue }) => (
          <span className="font-medium">{formatDate(getValue() as string)}</span>
        ),
      },
      {
        id: 'terminal',
        header: 'Terminal',
        cell: () => terminal === 'all' ? 'All' : terminal,
        enableSorting: false,
      },
      {
        id: 'orRange',
        header: 'SI No. Range',
        cell: ({ row }) =>
          row.original.startOR && row.original.endOR ? (
            <div className="flex flex-col text-xs text-muted-foreground">
              <span>{row.original.startOR}</span>
              <span>{row.original.endOR}</span>
            </div>
          ) : '-',
        enableSorting: false,
      },
      {
        id: 'totalDiscount',
        accessorKey: 'totalDiscount',
        header: ({ column }) => <SortBtn column={column}>Discount</SortBtn>,
        cell: ({ getValue }) => <span className="text-right block">{formatCurrency(getValue() as number)}</span>,
      },
      {
        id: 'totalRevenue',
        accessorKey: 'totalRevenue',
        header: ({ column }) => <SortBtn column={column}>Revenue</SortBtn>,
        cell: ({ getValue }) => <span className="text-right block font-bold">{formatCurrency(getValue() as number)}</span>,
      },
      {
        id: 'vatableSales',
        accessorKey: 'vatableSales',
        header: ({ column }) => <SortBtn column={column}>Vatable</SortBtn>,
        cell: ({ getValue }) => <span className="text-right block">{formatCurrency(getValue() as number)}</span>,
      },
      {
        id: 'vatAmount',
        accessorKey: 'vatAmount',
        header: ({ column }) => <SortBtn column={column}>VAT</SortBtn>,
        cell: ({ getValue }) => <span className="text-right block">{formatCurrency(getValue() as number)}</span>,
      },
      {
        id: 'vatExemptSales',
        accessorKey: 'vatExemptSales',
        header: ({ column }) => <SortBtn column={column}>Exempt</SortBtn>,
        cell: ({ getValue }) => <span className="text-right block">{formatCurrency(getValue() as number)}</span>,
      },
      {
        id: 'zeroRatedSales',
        accessorKey: 'zeroRatedSales',
        header: ({ column }) => <SortBtn column={column}>Zero</SortBtn>,
        cell: ({ getValue }) => <span className="text-right block">{formatCurrency(getValue() as number)}</span>,
      },
      {
        id: 'nonVatSales',
        accessorKey: 'nonVatSales',
        header: ({ column }) => <SortBtn column={column}>Non-VAT</SortBtn>,
        cell: ({ getValue }) => <span className="text-right block">{formatCurrency(getValue() as number)}</span>,
      },
      {
        id: 'cost',
        accessorKey: 'cost',
        header: ({ column }) => <SortBtn column={column}>Cost</SortBtn>,
        cell: ({ getValue }) => <span className="text-right block">{formatCurrency(getValue() as number)}</span>,
      },
      {
        id: 'profit',
        accessorKey: 'profit',
        header: ({ column }) => <SortBtn column={column}>Profit</SortBtn>,
        cell: ({ getValue }) => (
          <span className="text-right block font-bold text-green-600">
            {formatCurrency(getValue() as number)}
          </span>
        ),
      },
    ],
    [expandedRows, interval, terminal]
  );

  const table = useReactTable({
    data: filteredSalesData,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  return {
    table,
    expandedRows,
    transactionsByDate,
    loadingTransactions,
    toggleRowExpansion,
  };
}
