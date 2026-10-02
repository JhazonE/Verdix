'use client';

import { Table as ReactTable } from '@tanstack/react-table';
import { Search, Filter, X, Columns, PlusCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import type { Sale, SalesPerson, Customer } from '@/lib/types';
import type { OrderFilters, OrderFilterDialogOpen } from './use-orders-filters';

type Props = {
  searchTerm: string;
  onSearchChange: (val: string) => void;
  filters: OrderFilters;
  activeFilterCount: number;
  setDialogOpen: React.Dispatch<React.SetStateAction<OrderFilterDialogOpen>>;
  handleFilterChange: (key: keyof OrderFilters, value: string) => void;
  clearFilters: () => void;
  table: ReactTable<Sale>;
  salesPersons: SalesPerson[];
  customers: Customer[];
};

export function OrdersFilterBar({
  searchTerm, onSearchChange, filters, activeFilterCount,
  setDialogOpen, handleFilterChange, clearFilters, table,
  salesPersons, customers,
}: Props) {
  return (
    <>
      {/* Toolbar */}
      <div className="flex gap-2 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search orders..."
            className="pl-8 w-[200px]"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 relative">
              <Filter className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex justify-center items-center rounded-full text-[10px]">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuLabel>Filter By</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDialogOpen(p => ({ ...p, status: true }))}>Status {filters.status && '✓'}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialogOpen(p => ({ ...p, date: true }))}>Date Range {filters.startDate && '✓'}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialogOpen(p => ({ ...p, salesPerson: true }))}>Sales Person {filters.salesPersonId && '✓'}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialogOpen(p => ({ ...p, salesArea: true }))}>Sales Area {filters.salesArea && '✓'}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialogOpen(p => ({ ...p, customer: true }))}>Customer {filters.customerId && '✓'}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialogOpen(p => ({ ...p, reference: true }))}>Reference # {filters.reference && '✓'}</DropdownMenuItem>
            {activeFilterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={clearFilters}>
                  <X className="mr-2 h-4 w-4" /> Clear All Filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

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

        <Button size="sm" asChild>
          <Link href="/sales/orders/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            New Sales Order
          </Link>
        </Button>
      </div>

      {/* Active Filter Chips */}
      {activeFilterCount > 0 && (
        <div className="px-6 pb-2 flex flex-wrap gap-2 non-printable">
          {filters.status && <Badge variant="outline" className="gap-1">Status: {filters.status} <X className="h-3 w-3 cursor-pointer" onClick={() => handleFilterChange('status', '')} /></Badge>}
          {filters.startDate && <Badge variant="outline" className="gap-1">From: {filters.startDate} <X className="h-3 w-3 cursor-pointer" onClick={() => handleFilterChange('startDate', '')} /></Badge>}
          {filters.endDate && <Badge variant="outline" className="gap-1">To: {filters.endDate} <X className="h-3 w-3 cursor-pointer" onClick={() => handleFilterChange('endDate', '')} /></Badge>}
          {filters.salesPersonId && <Badge variant="outline" className="gap-1">Person: {salesPersons.find(s => s.id.toString() === filters.salesPersonId)?.name || filters.salesPersonId} <X className="h-3 w-3 cursor-pointer" onClick={() => handleFilterChange('salesPersonId', '')} /></Badge>}
          {filters.salesArea && <Badge variant="outline" className="gap-1">Area: {filters.salesArea} <X className="h-3 w-3 cursor-pointer" onClick={() => handleFilterChange('salesArea', '')} /></Badge>}
          {filters.customerId && <Badge variant="outline" className="gap-1">Customer: {customers.find(c => c.id === filters.customerId)?.name || 'Selected'} <X className="h-3 w-3 cursor-pointer" onClick={() => handleFilterChange('customerId', '')} /></Badge>}
          {filters.reference && <Badge variant="outline" className="gap-1">Ref: {filters.reference} <X className="h-3 w-3 cursor-pointer" onClick={() => handleFilterChange('reference', '')} /></Badge>}
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={clearFilters}>Clear all</Button>
        </div>
      )}
    </>
  );
}
