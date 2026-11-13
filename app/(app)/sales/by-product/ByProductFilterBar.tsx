import { Search, X, SlidersHorizontal, FileDown, Columns } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Table } from '@tanstack/react-table';
import { SalesSourceFilter as SalesSourceToggle } from '@/components/sales-source';
import type { SalesSourceFilter } from '@/lib/sales-source';

type Props = {
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  setCurrentPage: (v: number) => void;
  activeFilterCount: number;
  dateRange: any;
  terminal: string;
  categoryFilter: string;
  brandFilter: string;
  cashierFilter: string;
  referenceFilter: string;
  sourceFilter: SalesSourceFilter;
  setSourceFilter: (v: SalesSourceFilter) => void;
  resetFilters: () => void;
  exportToCSV: () => void;
  exportToPDF: () => void;
  table: Table<any>;
  onOpenDateRange: () => void;
  onOpenTerminal: () => void;
  onOpenCategory: () => void;
  onOpenBrand: () => void;
  onOpenCashier: () => void;
  onOpenReference: () => void;
};

export function ByProductFilterBar({
  searchTerm, setSearchTerm, setCurrentPage,
  activeFilterCount,
  dateRange, terminal, categoryFilter, brandFilter, cashierFilter, referenceFilter,
  sourceFilter, setSourceFilter,
  resetFilters, exportToCSV, exportToPDF,
  table,
  onOpenDateRange, onOpenTerminal, onOpenCategory, onOpenBrand, onOpenCashier, onOpenReference,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-4 pt-4 mb-4">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search by product name..."
          className="pl-8 sm:w-[300px]"
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
        />
      </div>

      <div className="flex items-center gap-2">
        <SalesSourceToggle value={sourceFilter} onChange={setSourceFilter} />
        {/* Column Visibility */}
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
            {table.getAllColumns().filter((col) => col.getCanHide()).map((col) => (
              <DropdownMenuCheckboxItem
                key={col.id}
                className="capitalize"
                checked={col.getIsVisible()}
                onCheckedChange={(val) => col.toggleVisibility(!!val)}
              >
                {col.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <FileDown className="h-4 w-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportToCSV}>Export to CSV</DropdownMenuItem>
            <DropdownMenuItem onSelect={exportToPDF}>Export to PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Filters */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 px-1.5">{activeFilterCount}</Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onOpenDateRange}>
              Date Range
              {dateRange && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenTerminal}>
              Terminal
              {terminal !== 'all' && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenCategory}>
              Category
              {categoryFilter !== 'all' && <Badge variant="secondary" className="ml-auto text-xs">{categoryFilter}</Badge>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenBrand}>
              Brand
              {brandFilter !== 'all' && <Badge variant="secondary" className="ml-auto text-xs">{brandFilter}</Badge>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenCashier}>
              Cashier
              {cashierFilter !== 'all' && <Badge variant="secondary" className="ml-auto text-xs">{cashierFilter}</Badge>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenReference}>
              Transaction Reference
              {referenceFilter && <Badge variant="secondary" className="ml-auto text-xs">Set</Badge>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetFilters} className="text-destructive">
              Clear All Filters
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {(searchTerm || activeFilterCount > 0) && (
          <Button variant="ghost" onClick={resetFilters} size="sm">
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
