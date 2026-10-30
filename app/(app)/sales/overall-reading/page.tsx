'use client';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Search, FileText, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { TerminalSelector } from '@/components/TerminalSelector';
import { useOverallReadingPage } from './use-overall-reading-page';
import { OverallReadingShiftsTable } from './OverallReadingShiftsTable';
import { OverallReadingSummaryCards } from './OverallReadingSummaryCards';
import { OverallReadingBreakdown } from './OverallReadingBreakdown';
import { OverallReadingActions } from './OverallReadingActions';
import { OverallReadingPreviewModal } from './OverallReadingPreviewModal';

export default function OverallReadingPage() {
  const p = useOverallReadingPage();

  return (
    <div className="space-y-6 p-6 bg-muted/30 min-h-full rounded-xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-xl shadow-sm border border-border">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Overall Reading</h1>
          <p className="text-sm text-muted-foreground mt-1">View overall reading per completed shift</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-muted/50 p-1.5 rounded-lg border border-border">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" className={cn('w-[240px] justify-start text-left font-normal hover:bg-transparent', !p.dateRange && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                  {p.dateRange?.from ? (
                    p.dateRange.to ? (
                      <>{format(p.dateRange.from, 'yyyy-MM-dd')} - {format(p.dateRange.to, 'yyyy-MM-dd')}</>
                    ) : format(p.dateRange.from, 'yyyy-MM-dd')
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="range" selected={p.dateRange} onSelect={p.setDateRange} initialFocus numberOfMonths={2} />
              </PopoverContent>
            </Popover>
          </div>

          <div className="w-[180px]">
            <TerminalSelector terminalId={p.terminal} onTerminalChange={p.setTerminal} showAllOption={true} />
          </div>

          <Button onClick={p.handleSearchShifts} disabled={p.isLoading} className="bg-primary hover:bg-primary/90 text-white shadow-sm gap-2">
            <Search className="h-4 w-4" />
            {p.isLoading ? 'Loading...' : 'Search Shifts'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <OverallReadingShiftsTable
            shifts={p.shifts}
            isLoading={p.shiftsLoading}
            selectedShift={p.selectedShift}
            setSelectedShift={p.setSelectedShift}
          />
        </div>

        <div className="lg:col-span-2 space-y-6">
          {p.isError ? (
            /* A failed request used to fall through to the "No Shift Selected"
               placeholder below, which told the user nothing had gone wrong —
               the report simply never appeared. */
            <div className="flex flex-col items-center justify-center h-[400px] bg-card rounded-xl shadow-sm border border-border text-center gap-3">
              <div className="bg-destructive/10 p-4 rounded-full">
                <AlertCircle size={40} className="text-destructive" />
              </div>
              <p className="text-lg font-medium text-foreground">Could not load the reading</p>
              <p className="text-sm text-muted-foreground max-w-md px-6">
                {p.errorMessage || 'The report request failed.'}
              </p>
              <Button variant="outline" size="sm" onClick={p.retry}>Try again</Button>
            </div>
          ) : p.readingData ? (
            <div className="space-y-6">
              <OverallReadingSummaryCards readingData={p.readingData} />
              <OverallReadingBreakdown
                readingData={p.readingData}
                maxTerminalSales={p.maxTerminalSales}
                maxCashierSales={p.maxCashierSales}
              />
              <OverallReadingActions
                printerFormat={p.printerFormat}
                setPrinterFormat={p.setPrinterFormat}
                setModalMode={p.setModalMode}
                setIsPreviewOpen={p.setIsPreviewOpen}
                handleExportPDF={p.handleExportPDF}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[400px] bg-card rounded-xl shadow-sm border border-border text-muted-foreground">
              <div className="bg-muted p-4 rounded-full mb-4">
                <FileText size={40} className="text-muted-foreground/60" />
              </div>
              <p className="text-lg font-medium text-foreground">No Shift Selected</p>
              <p className="text-sm text-muted-foreground mt-1">Select a shift from the list to view its overall reading.</p>
            </div>
          )}
        </div>
      </div>

      {p.readingData && (
        <OverallReadingPreviewModal
          isOpen={p.isPreviewOpen}
          onClose={() => p.setIsPreviewOpen(false)}
          readingData={p.readingData}
          printerFormat={p.printerFormat}
          setPrinterFormat={p.setPrinterFormat}
          modalMode={p.modalMode}
          previewRef={p.previewRef}
          handlePrint={p.handleReactToPrintFn}
        />
      )}
    </div>
  );
}
