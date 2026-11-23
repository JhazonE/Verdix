import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { CalendarIcon, SlidersHorizontal, FileDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { SalesSourceFilter as SalesSourceToggle } from '@/components/sales-source';
import type { SalesSourceFilter } from '@/lib/sales-source';

type Props = {
  dateRange: DateRange | undefined;
  setDateRange: (range: DateRange | undefined) => void;
  interval: string;
  setInterval: (value: string) => void;
  sourceFilter: SalesSourceFilter;
  setSourceFilter: (v: SalesSourceFilter) => void;
  hasActiveFilters: boolean;
  resetFilters: () => void;
  onOpenAdvancedFilters: () => void;
  exportToCSV: () => void;
  exportToPDF: () => void;
};

export function AnalysisFilterBar({
  dateRange,
  setDateRange,
  interval,
  setInterval,
  sourceFilter,
  setSourceFilter,
  hasActiveFilters,
  resetFilters,
  onOpenAdvancedFilters,
  exportToCSV,
  exportToPDF,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap bg-muted/20 p-2 rounded-md border">
      <div className="flex items-center gap-2">
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

        <SalesSourceToggle value={sourceFilter} onChange={setSourceFilter} />

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
            <DropdownMenuItem
              onSelect={(e) => { e.preventDefault(); onOpenAdvancedFilters(); }}
            >
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
