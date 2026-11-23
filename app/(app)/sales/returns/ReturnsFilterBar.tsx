'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, FileDown, Undo } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { SalesSourceFilter as SalesSourceToggle } from '@/components/sales-source';
import type { SalesSourceFilter } from '@/lib/sales-source';

interface Props {
  fromDate: Date | undefined;
  setFromDate: (date: Date | undefined) => void;
  toDate: Date | undefined;
  setToDate: (date: Date | undefined) => void;
  sourceFilter: SalesSourceFilter;
  setSourceFilter: (v: SalesSourceFilter) => void;
  isLoading: boolean;
  recordCount: number;
  onShowReport: () => void;
  onExportPDF: () => void;
}

export function ReturnsFilterBar({ fromDate, setFromDate, toDate, setToDate, sourceFilter, setSourceFilter, isLoading, recordCount, onShowReport, onExportPDF }: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Undo className="h-5 w-5 text-green-600" />
              Merchandise Credit Report
            </CardTitle>
            <CardDescription>View and analyze all returned sales transactions</CardDescription>
          </div>
          <Badge variant="outline" className="text-sm border-green-600 text-green-600">
            {recordCount} Return{recordCount !== 1 ? 's' : ''}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">From Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-[210px] justify-start text-left font-normal', !fromDate && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {fromDate ? format(fromDate, 'PPP') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">To Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-[210px] justify-start text-left font-normal', !toDate && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {toDate ? format(toDate, 'PPP') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Source</label>
            <SalesSourceToggle value={sourceFilter} onChange={setSourceFilter} className="h-10" />
          </div>

          <Button onClick={onShowReport} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Show Report'}
          </Button>

          <Button onClick={onExportPDF} disabled={isLoading || recordCount === 0} variant="outline" className="border-green-600 text-green-600 hover:bg-green-50">
            <FileDown className="mr-2 h-4 w-4" />
            Export to PDF
          </Button>
        </div>
        {/* Returns are taken only at a till (/api/sales/returns and
            /api/sales/exchanges are POS-only), so this is always empty —
            say why rather than leave it looking broken. */}
        {sourceFilter === 'backoffice' && (
          <p className="mt-3 text-sm text-muted-foreground">
            Merchandise credits are issued only at the POS, so there are no back-office records.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
