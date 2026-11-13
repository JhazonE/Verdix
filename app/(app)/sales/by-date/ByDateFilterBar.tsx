import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { Search, X, SlidersHorizontal, CalendarIcon, FileDown, Columns } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Table } from '@tanstack/react-table';
import { SalesSourceFilter as SalesSourceToggle } from '@/components/sales-source';
import type { SalesSourceFilter } from '@/lib/sales-source';

type Props = {
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  dateRange: DateRange | undefined;
  setDateRange: (v: DateRange | undefined) => void;
  interval: string;
  setInterval: (v: string) => void;
  hasActiveFilters: boolean;
  resetFilters: () => void;
  sourceFilter: SalesSourceFilter;
  setSourceFilter: (v: SalesSourceFilter) => void;
  onOpenAdvancedFilters: () => void;
  exportToCSV: () => void;
  exportToPDF: () => void;
  table: Table<any>;
};

export function ByDateFilterBar({
  searchTerm, setSearchTerm,
  dateRange, setDateRange,
  interval, setInterval,
  hasActiveFilters, resetFilters,
  sourceFilter, setSourceFilter,
  onOpenAdvancedFilters,
  exportToCSV, exportToPDF,
  table,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap bg-muted/20 p-2 rounded-md border">
      {/* Search */}
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search..."
          className="pl-8 w-full h-8"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <SalesSourceToggle value={sourceFilter} onChange={setSourceFilter} />
        {/* Column Visibility */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
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
            <Button variant="outline" size="sm" className="h-8">
              <FileDown className="h-4 w-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportToCSV}>Export to CSV</DropdownMenuItem>
            <DropdownMenuItem onSelect={exportToPDF}>Export to PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Date Range Picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn('h-8 justify-start text-left font-normal', !dateRange && 'text-muted-foreground')}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>{format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}</>
                ) : (
                  format(dateRange.from, 'LLL dd, y')
                )
              ) : (
                <span>Pick a date range</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        {/* Filters Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filters
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-2 px-1 rounded-sm">!</Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Filter Options</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Time Interval ({interval})</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={interval} onValueChange={setInterval}>
                  <DropdownMenuRadioItem value="daily">Daily</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="hourly">Hourly</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="monthly">Monthly</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onOpenAdvancedFilters(); }}>
              Advanced Filters...
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetFilters} className="text-destructive">
              Reset Filters
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
            <span className="sr-only">Reset</span>
          </Button>
        )}
      </div>
    </div>
  );
}
