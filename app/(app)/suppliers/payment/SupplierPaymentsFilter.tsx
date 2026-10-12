'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Filter, X, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';

type Props = {
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  dateRange: DateRange | undefined;
  setDateRange: (r: DateRange | undefined) => void;
  paymentMethod: string;
  setPaymentMethod: (m: string) => void;
};

const PAYMENT_METHODS = ['Cash', 'Check', 'Bank Transfer'];

export function SupplierPaymentsFilter({
  searchTerm, setSearchTerm,
  dateRange, setDateRange,
  paymentMethod, setPaymentMethod,
}: Props) {
  const hasFilters = !!(dateRange?.from || dateRange?.to || paymentMethod !== 'All');
  const filterCount = (dateRange?.from || dateRange?.to ? 1 : 0) + (paymentMethod !== 'All' ? 1 : 0);

  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card text-card-foreground p-4 rounded-lg border shadow-sm mb-6">
      <div className="flex flex-1 items-center gap-2 w-full">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by supplier or reference..."
            className="pl-8 text-sm h-9"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="relative h-9">
              <Filter className="mr-2 h-4 w-4" />
              Filter
              {hasFilters && (
                <Badge variant="default" className="ml-2 h-4 min-w-4 rounded-full p-0 px-1 flex items-center justify-center bg-primary text-primary-foreground text-[10px]">
                  {filterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4" align="start">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2 mb-2">
                <h4 className="font-semibold text-sm">Filters</h4>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setDateRange(undefined); setPaymentMethod('All'); }}
                    className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <X className="mr-1 h-3 w-3" /> Clear all
                  </Button>
                )}
              </div>
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Date Range</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        id="date"
                        variant="outline"
                        size="sm"
                        className={cn('w-full justify-start text-left font-normal h-9', !dateRange && 'text-muted-foreground')}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateRange?.from ? (
                          dateRange.to ? (
                            <>{format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}</>
                          ) : format(dateRange.from, 'LLL dd, y')
                        ) : (
                          <span>Pick a date range</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
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
                </div>
                <div className="grid gap-1.5">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Payment Method</label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="All Methods" />
                    </SelectTrigger>
                    <SelectContent side="bottom">
                      <SelectItem value="All">All Methods</SelectItem>
                      {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
