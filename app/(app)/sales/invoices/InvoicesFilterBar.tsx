'use client';

import { Table } from '@tanstack/react-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { Search, SlidersHorizontal, Columns, PlusCircle } from 'lucide-react';

type Props = {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  statusFilter: string;
  dateRangeFilter: any;
  salesPersonFilter: string;
  customerFilter: string;
  transactionSourceFilter: string;
  referenceTypeFilter: string;
  referenceNumberFilter: string;
  receiptNumberFilter: string;
  hasActiveFilters: boolean;
  resetFilters: () => void;
  onOpenStatus: () => void;
  onOpenDateRange: () => void;
  onOpenSalesPerson: () => void;
  onOpenCustomer: () => void;
  onOpenTransactionSource: () => void;
  onOpenReferenceType: () => void;
  onOpenReferenceNumber: () => void;
  onOpenReceiptNumber: () => void;
  table: Table<any>;
};

export function InvoicesFilterBar({
  searchQuery, setSearchQuery,
  statusFilter, dateRangeFilter, salesPersonFilter, customerFilter,
  transactionSourceFilter, referenceTypeFilter, referenceNumberFilter, receiptNumberFilter,
  hasActiveFilters, resetFilters,
  onOpenStatus, onOpenDateRange, onOpenSalesPerson, onOpenCustomer,
  onOpenTransactionSource, onOpenReferenceType, onOpenReferenceNumber, onOpenReceiptNumber,
  table,
}: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative w-64">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search invoices..." className="pl-8" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Columns className="h-4 w-4 mr-2" />
            Columns
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {table.getAllColumns().filter(col => col.getCanHide()).map(col => (
            <DropdownMenuCheckboxItem key={col.id} className="capitalize" checked={col.getIsVisible()} onCheckedChange={val => col.toggleVisibility(!!val)}>
              {col.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <SlidersHorizontal className="h-4 w-4 mr-2" />
            Filters
            {hasActiveFilters && <Badge variant="secondary" className="ml-2 h-5 px-1.5">!</Badge>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={onOpenStatus}>
            Status {statusFilter !== 'all' && <Badge variant="secondary" className="ml-auto text-xs">{statusFilter}</Badge>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenDateRange}>
            Date Range {dateRangeFilter && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenSalesPerson}>
            Sales Person {salesPersonFilter !== 'all' && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenCustomer}>
            Customer {customerFilter && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenTransactionSource}>
            Transaction From {transactionSourceFilter !== 'all' && <Badge variant="secondary" className="ml-auto text-xs">{transactionSourceFilter}</Badge>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenReferenceType}>
            Reference Type {referenceTypeFilter !== 'all' && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenReferenceNumber}>
            Reference # {referenceNumberFilter && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenReceiptNumber}>
            Receipt # {receiptNumberFilter && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={resetFilters} className="text-destructive">
            Clear All Filters
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" asChild>
        <Link href="/sales/invoices/new">
          <PlusCircle className="mr-2 h-4 w-4" />
          New Sales Invoice
        </Link>
      </Button>
    </div>
  );
}
